-- Журнал заказа: любое изменение состава работ (запчасти и услуги) → order_journal_events.

create or replace function public.remove_order_part_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  line_name text;
begin
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is null then
    if not (
      public.has_permission('inventory:write_off')
      or public.has_permission('orders:update')
    ) then
      raise exception 'Недостаточно прав для удаления запчасти из заказа.';
    end if;
  elsif not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для удаления запчасти из заказа.';
  end if;

  line_name := coalesce(
    nullif(btrim(current_row.name), ''),
    (select i.name from public.inventory_items i where i.id = current_row.item_id),
    'позиция'
  );

  if current_row.item_id is not null then
    perform public.return_inventory_from_order(
      current_row.order_id,
      current_row.item_id,
      current_row.quantity
    );
  end if;

  delete from public.order_part_lines
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'part_removed',
    auth.uid(),
    'Удалена позиция: ' || line_name || ' × ' || public.format_quantity_label(current_row.quantity),
    jsonb_build_object(
      'line_id', target_line_id,
      'item_id', current_row.item_id,
      'name', line_name,
      'quantity', current_row.quantity,
      'unit_price', current_row.unit_price,
      'custom', current_row.item_id is null
    )
  );

  perform public.record_audit(
    'inventory.returned_repair',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', current_row.quantity,
      'custom', current_row.item_id is null
    )
  );
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
  line_name text;
begin
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is null then
    if not (
      public.has_permission('inventory:write_off')
      or public.has_permission('orders:update')
    ) then
      raise exception 'Недостаточно прав для изменения запчастей заказа.';
    end if;
  elsif not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
  end if;

  delta := line_quantity - current_row.quantity;

  if current_row.item_id is not null then
    if delta > 0 then
      perform public.consume_inventory_fifo(
        current_row.item_id,
        delta,
        'repair_consumption',
        'order',
        current_row.order_id,
        false
      );
    elsif delta < 0 then
      perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
    end if;
  end if;

  line_name := coalesce(
    nullif(btrim(current_row.name), ''),
    (select i.name from public.inventory_items i where i.id = current_row.item_id),
    'позиция'
  );

  update public.order_part_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'part_updated',
    auth.uid(),
    'Изменена позиция: ' || line_name
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'item_id', current_row.item_id,
      'name', line_name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price,
      'custom', current_row.item_id is null
    )
  );

  perform public.record_audit(
    'inventory.order_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price,
      'custom', current_row.item_id is null
    )
  );
end;
$$;

create or replace function public.update_order_custom_part_line(
  target_line_id uuid,
  line_name text,
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
  clean_name text := btrim(coalesce(line_name, ''));
begin
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is not null then
    raise exception 'Эта позиция из справочника. Измените карточку товара.';
  end if;

  if not (
    public.has_permission('inventory:write_off')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if current_row.name = clean_name
     and current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
  end if;

  update public.order_part_lines
  set
    name = clean_name,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'part_updated',
    auth.uid(),
    'Изменена позиция: ' || clean_name
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'from_name', current_row.name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price,
      'custom', true
    )
  );

  perform public.record_audit(
    'inventory.order_custom_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

create or replace function public.set_order_service_line(
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
  current_row public.order_service_lines%rowtype;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги не найдена.';
  end if;

  if current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
  end if;

  update public.order_service_lines
  set quantity = line_quantity, unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'service_updated',
    auth.uid(),
    'Изменена услуга: ' || coalesce(current_row.name, 'услуга')
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', current_row.name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object('line_id', target_line_id, 'quantity', line_quantity, 'unit_price', line_unit_price)
  );
end;
$$;

create or replace function public.update_order_custom_service_line(
  target_line_id uuid,
  line_name text,
  line_description text,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_service_lines%rowtype;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
    and template_id is null
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги не найдена или это шаблон из справочника.';
  end if;

  if current_row.name = clean_name
     and coalesce(current_row.description, '') = clean_description
     and current_row.quantity = line_quantity
     and current_row.unit_price = line_unit_price then
    return;
  end if;

  update public.order_service_lines
  set
    name = clean_name,
    description = clean_description,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'service_updated',
    auth.uid(),
    'Изменена услуга: ' || clean_name
      || ' · '
      || public.format_quantity_label(current_row.quantity) || ' × '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || public.format_quantity_label(line_quantity) || ' × '
      || trim(to_char(line_unit_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'from_name', current_row.name,
      'from_quantity', current_row.quantity,
      'to_quantity', line_quantity,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', line_unit_price
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.custom_service_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

create or replace function public.update_order_service_line_for_order(
  target_line_id uuid,
  line_name text,
  line_description text default '',
  line_unit_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_service_lines%rowtype;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
  clean_price numeric := coalesce(line_unit_price, 0);
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги в заказе не найдена.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if clean_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if current_row.name = clean_name
     and coalesce(current_row.description, '') = clean_description
     and current_row.unit_price = clean_price
     and current_row.template_id is null then
    return;
  end if;

  update public.order_service_lines
  set
    template_id = null,
    name = clean_name,
    description = clean_description,
    unit_price = clean_price
  where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'service_updated',
    auth.uid(),
    'Изменена услуга: ' || clean_name
      || ' · '
      || trim(to_char(current_row.unit_price, 'FM999999990.00'))
      || ' → '
      || trim(to_char(clean_price, 'FM999999990.00')),
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'from_name', current_row.name,
      'from_unit_price', current_row.unit_price,
      'to_unit_price', clean_price,
      'previous_template_id', current_row.template_id
    )
  );

  perform public.record_audit(
    'orders.service_line_updated_local',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'previous_template_id', current_row.template_id,
      'name', clean_name,
      'unit_price', clean_price
    )
  );
end;
$$;

-- Добавление кастомной позиции: тип события как у остальных правок состава.
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
    'part_added',
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

notify pgrst, 'reload schema';
