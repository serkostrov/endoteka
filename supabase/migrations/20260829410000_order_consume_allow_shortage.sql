-- Allow order write-offs even when warehouse stock is insufficient.
-- Missing qty is covered by a temporary shortage batch (net stock stays correct).

drop function if exists public.consume_inventory_fifo(uuid, numeric, text, text, uuid);

create function public.consume_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid,
  allow_shortage boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  available numeric;
  remaining numeric;
  take numeric;
  batch_row public.inventory_batches%rowtype;
  shortage_batch_id uuid;
  movement_id uuid;
  lines jsonb := '[]'::jsonb;
begin
  if consume_quantity is null or consume_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  select coalesce(sum(remaining_quantity), 0)
    into available
  from public.inventory_batches
  where item_id = target_item_id;

  if available < consume_quantity and not coalesce(allow_shortage, false) then
    raise exception 'Недостаточно остатка. Доступно: %, запрошено: %.', available, consume_quantity;
  end if;

  remaining := consume_quantity;

  for batch_row in
    select *
    from public.inventory_batches
    where item_id = target_item_id
      and remaining_quantity > 0
    order by receipt_date asc, created_at asc, id asc
    for update
  loop
    exit when remaining <= 0;

    take := least(batch_row.remaining_quantity, remaining);

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      batch_row.id,
      -take,
      batch_row.purchase_price,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', batch_row.id,
      'quantity', take,
      'unit_price', batch_row.purchase_price,
      'receipt_date', batch_row.receipt_date
    ));

    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    if not coalesce(allow_shortage, false) then
      raise exception 'Недостаточно остатка.';
    end if;

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      target_item_id,
      null,
      'Недостача',
      current_date,
      0,
      remaining,
      remaining
    )
    returning id into shortage_batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      shortage_batch_id,
      -remaining,
      0,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', shortage_batch_id,
      'quantity', remaining,
      'unit_price', 0,
      'receipt_date', current_date,
      'shortage', true
    ));

    remaining := 0;
  end if;

  return jsonb_build_object(
    'item_id', target_item_id,
    'quantity', consume_quantity,
    'lines', lines
  );
end;
$$;

revoke all on function public.consume_inventory_fifo(uuid, numeric, text, text, uuid, boolean)
  from public, anon;
grant execute on function public.consume_inventory_fifo(uuid, numeric, text, text, uuid, boolean)
  to authenticated;

create or replace function public.consume_inventory_for_order(
  target_order_id uuid,
  target_item_id uuid,
  consume_quantity numeric,
  line_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  next_price numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания в ремонт.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  next_price := line_unit_price;
  if next_price is null then
    select repair_price into next_price
    from public.inventory_items
    where id = target_item_id;
  end if;

  if next_price is null or next_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  result := public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'repair_consumption',
    'order',
    target_order_id,
    true
  );

  insert into public.order_part_lines (order_id, item_id, quantity, unit_price, created_by)
  values (target_order_id, target_item_id, consume_quantity, next_price, auth.uid())
  on conflict (order_id, item_id) do update
    set quantity = public.order_part_lines.quantity + excluded.quantity;

  perform public.record_audit(
    'inventory.consumed_repair',
    'order',
    target_order_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity, 'unit_price', next_price)
  );

  return result;
end;
$$;

create or replace function public.set_order_part_line(
  target_line_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  delta numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  delta := line_quantity - current_row.quantity;

  if delta > 0 then
    perform public.consume_inventory_fifo(
      current_row.item_id,
      delta,
      'repair_consumption',
      'order',
      current_row.order_id,
      true
    );
  elsif delta < 0 then
    perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
  end if;

  update public.order_part_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  perform public.record_audit(
    'inventory.order_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;
