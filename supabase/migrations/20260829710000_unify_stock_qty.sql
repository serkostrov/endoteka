-- Единый источник остатка: remaining_quantity = сумма движений по партии.
-- inventory_item_stock_qty считает так же, как список склада.

do $$
declare
  batch_row record;
  mov_sum numeric;
  adj_id uuid;
  cover numeric;
begin
  for batch_row in
    select b.id, b.item_id, b.remaining_quantity, b.purchase_price
    from public.inventory_batches b
    order by b.created_at, b.id
    for update
  loop
    select coalesce(sum(m.quantity), 0)
      into mov_sum
    from public.inventory_movements m
    where m.batch_id = batch_row.id;

    if mov_sum < 0 then
      cover := -mov_sum;
      insert into public.inventory_adjustments (reason, created_by)
      values ('Синхронизация остатка партии', auth.uid())
      returning id into adj_id;

      insert into public.inventory_movements (
        item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
      )
      values (
        batch_row.item_id,
        batch_row.id,
        cover,
        coalesce(batch_row.purchase_price, 0),
        'inventory_adjustment',
        'inventory_adjustment',
        adj_id,
        auth.uid()
      );
    end if;

    select coalesce(sum(m.quantity), 0)
      into mov_sum
    from public.inventory_movements m
    where m.batch_id = batch_row.id;

    if mov_sum < 0 then
      mov_sum := 0;
    end if;

    if batch_row.remaining_quantity is distinct from mov_sum then
      update public.inventory_batches
      set remaining_quantity = mov_sum
      where id = batch_row.id;
    end if;
  end loop;
end;
$$;

create or replace function public.inventory_item_stock_qty(target_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(b.remaining_quantity), 0)
  from public.inventory_batches b
  where b.item_id = target_item_id;
$$;

revoke all on function public.inventory_item_stock_qty(uuid) from public;
grant execute on function public.inventory_item_stock_qty(uuid) to authenticated;
