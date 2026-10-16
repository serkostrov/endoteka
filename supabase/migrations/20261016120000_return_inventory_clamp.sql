-- Возврат на склад при уменьшении состава: не больше фактически списанного,
-- без ошибки — лишнее просто не возвращаем (остаток не уходит ниже нуля).

create or replace function public.return_inventory_from_order(
  target_order_id uuid,
  target_item_id uuid,
  return_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining numeric;
  rec record;
  take numeric;
begin
  if return_quantity is null or return_quantity <= 0 then
    return;
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  remaining := return_quantity;

  for rec in
    select
      m.batch_id,
      -sum(m.quantity) as net_qty
    from public.inventory_movements m
    where m.reference_type = 'order'
      and m.reference_id = target_order_id
      and m.item_id = target_item_id
      and m.movement_type in ('repair_consumption', 'repair_return')
    group by m.batch_id
    having -sum(m.quantity) > 0
    order by max(m.created_at) desc, m.batch_id desc
  loop
    exit when remaining <= 0;
    take := least(rec.net_qty, remaining);
    if take <= 0 then
      continue;
    end if;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    select
      target_item_id,
      rec.batch_id,
      take,
      b.purchase_price,
      'repair_return',
      'order',
      target_order_id,
      auth.uid()
    from public.inventory_batches b
    where b.id = rec.batch_id;

    remaining := remaining - take;
  end loop;

  -- Если списаний меньше запрошенного возврата (импорт, shortage и т.п.) —
  -- молча ограничиваем возврат доступным количеством.
end;
$$;
