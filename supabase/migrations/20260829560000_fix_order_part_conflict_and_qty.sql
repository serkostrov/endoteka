-- После partial unique index (order_id, item_id) WHERE item_id IS NOT NULL
-- обычный ON CONFLICT (order_id, item_id) падает:
-- «there is no unique or exclusion constraint matching the ON CONFLICT specification».

create or replace function public.format_quantity_label(value numeric)
returns text
language plpgsql
immutable
as $$
declare
  n numeric := round(coalesce(value, 0), 3);
  negative boolean := n < 0;
  abs_n numeric := abs(n);
  whole bigint := trunc(abs_n);
  frac numeric := abs_n - whole;
  grouped text;
  raw text;
  frac_text text;
begin
  grouped := reverse(regexp_replace(reverse(whole::text), '(\d{3})(?=\d)', '\1 ', 'g'));
  if frac = 0 then
    return case when negative then '-' else '' end || grouped;
  end if;
  raw := trim(to_char(abs_n, 'FM999999990.999'));
  frac_text := split_part(raw, '.', 2);
  return case when negative then '-' else '' end || grouped || '.' || frac_text;
end;
$$;

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
  on conflict (order_id, item_id) where item_id is not null
  do update
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

-- Журнал: количества без лишних «.000», тысячи через пробел.
create or replace function public.write_order_journal_on_parts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.reference_type <> 'order'
     or new.movement_type not in ('repair_consumption', 'repair_return') then
    return new;
  end if;

  select name into item_name from public.inventory_items where id = new.item_id;

  if new.movement_type = 'repair_return' then
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_returned',
      auth.uid(),
      'Возвращено на склад: ' || coalesce(item_name, 'позиция') || ' × ' || public.format_quantity_label(abs(new.quantity)),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  else
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_consumed',
      auth.uid(),
      'Списано: ' || coalesce(item_name, 'позиция') || ' × ' || public.format_quantity_label(abs(new.quantity)),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  end if;

  return new;
end;
$$;

create or replace function public.add_order_custom_part_line(
  target_order_id uuid,
  line_name text,
  line_quantity numeric default 1,
  line_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text := btrim(coalesce(line_name, ''));
  qty numeric := coalesce(line_quantity, 1);
begin
  if not (
    public.has_permission('inventory:write_off')
    or public.has_permission('inventory:receive')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if qty <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.order_part_lines (
    order_id, item_id, name, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    null,
    clean_name,
    qty,
    coalesce(line_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'parts_consumed',
    auth.uid(),
    'Добавлена позиция: ' || clean_name || ' × ' || public.format_quantity_label(qty),
    jsonb_build_object(
      'line_id', new_id,
      'custom', true,
      'quantity', qty,
      'unit_price', coalesce(line_unit_price, 0)
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'inventory.order_part_custom_added',
    'order',
    target_order_id::text,
    jsonb_build_object('line_id', new_id, 'name', clean_name, 'custom', true)
  );

  return new_id;
end;
$$;
