-- Возврат на склад при удалении/уменьшении позиции в заказе:
-- всегда создаём repair_return на полный объём (остаток + история карточки),
-- без тихого no-op, из‑за которого строка пропадала из заказа, а склад не менялся.

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
  capacity numeric;
  unit_price numeric;
  new_batch_id uuid;
  rows_inserted integer;
begin
  if return_quantity is null or return_quantity <= 0 then
    return;
  end if;

  if target_order_id is null or target_item_id is null then
    raise exception 'Не указан заказ или позиция для возврата на склад.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  remaining := return_quantity;

  -- 1) Откат по партиям, с которых это заказ реально списывал (с учётом ёмкости партии).
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

    select
      greatest(b.quantity - b.remaining_quantity, 0),
      b.purchase_price
    into capacity, unit_price
    from public.inventory_batches b
    where b.id = rec.batch_id;

    if capacity is null or capacity <= 0 then
      continue;
    end if;

    take := least(rec.net_qty, remaining, capacity);
    if take <= 0 then
      continue;
    end if;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      rec.batch_id,
      take,
      coalesce(unit_price, 0),
      'repair_return',
      'order',
      target_order_id,
      auth.uid()
    );

    get diagnostics rows_inserted = row_count;
    if rows_inserted <> 1 then
      raise exception 'Не удалось записать возврат на склад.';
    end if;

    remaining := remaining - take;
  end loop;

  -- 2) Остаток (импорт без списания / нет ёмкости в исходных партиях) —
  -- свободное место в других партиях позиции.
  if remaining > 0 then
    for rec in
      select
        b.id as batch_id,
        greatest(b.quantity - b.remaining_quantity, 0) as capacity,
        b.purchase_price
      from public.inventory_batches b
      where b.item_id = target_item_id
        and b.quantity > b.remaining_quantity
      order by b.receipt_date asc, b.created_at asc, b.id asc
    loop
      exit when remaining <= 0;

      take := least(rec.capacity, remaining);
      if take <= 0 then
        continue;
      end if;

      insert into public.inventory_movements (
        item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
      )
      values (
        target_item_id,
        rec.batch_id,
        take,
        coalesce(rec.purchase_price, 0),
        'repair_return',
        'order',
        target_order_id,
        auth.uid()
      );

      get diagnostics rows_inserted = row_count;
      if rows_inserted <> 1 then
        raise exception 'Не удалось записать возврат на склад.';
      end if;

      remaining := remaining - take;
    end loop;
  end if;

  -- 3) Всё ещё осталось — новая партия «Возврат из заказа» + движение repair_return.
  if remaining > 0 then
    select coalesce(i.purchase_price, 0)
    into unit_price
    from public.inventory_items i
    where i.id = target_item_id;

    if unit_price is null then
      raise exception 'Позиция склада не найдена.';
    end if;

    insert into public.inventory_batches (
      item_id,
      receipt_id,
      supplier,
      receipt_date,
      purchase_price,
      quantity,
      remaining_quantity
    )
    values (
      target_item_id,
      null,
      'Возврат из заказа',
      current_date,
      unit_price,
      remaining,
      0
    )
    returning id into new_batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      new_batch_id,
      remaining,
      unit_price,
      'repair_return',
      'order',
      target_order_id,
      auth.uid()
    );

    get diagnostics rows_inserted = row_count;
    if rows_inserted <> 1 then
      raise exception 'Не удалось записать возврат на склад.';
    end if;

    remaining := 0;
  end if;
end;
$$;

notify pgrst, 'reload schema';
