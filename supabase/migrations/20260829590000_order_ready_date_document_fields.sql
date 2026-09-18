-- Дата готовности заказа + значения полей карточек в контексте документов.

alter table public.orders
  add column if not exists ready_date date;

update public.dynamic_fields
set sort_order = 4
where entity_code = 'orders' and code = 'responsible' and sort_order < 4;

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
values
  ('orders', 'ready_date', 'Дата готовности', 'date', false, 3, 'Заказ')
on conflict (entity_code, code) do update
set
  name = excluded.name,
  field_type = excluded.field_type,
  group_name = case
    when public.dynamic_fields.group_name = '' then excluded.group_name
    else public.dynamic_fields.group_name
  end;

create or replace function public.is_order_card_field(p_entity text, p_code text)
returns boolean
language sql
immutable
as $$
  select p_entity = 'orders'
    and p_code in (
      'claimed_malfunction',
      'completeness',
      'deadline',
      'ready_date',
      'responsible'
    );
$$;

create or replace function public.document_field_value_text(
  p_field_type text,
  p_value jsonb,
  p_field_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw_text text;
  option_label text;
  employee_name text;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return '';
  end if;

  if p_field_type = 'checkbox' then
    if p_value = 'true'::jsonb then
      return 'Да';
    end if;
    if p_value = 'false'::jsonb then
      return 'Нет';
    end if;
    return '';
  end if;

  if p_field_type = 'number' then
    if jsonb_typeof(p_value) = 'number' then
      return trim(to_char((p_value #>> '{}')::numeric, '999999990.999'));
    end if;
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    return raw_text;
  end if;

  if p_field_type = 'date' then
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    if raw_text = '' then
      return '';
    end if;
    begin
      return to_char(raw_text::date, 'YYYY-MM-DD');
    exception
      when others then
        return raw_text;
    end;
  end if;

  if p_field_type = 'select' then
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    if raw_text = '' or p_field_id is null then
      return raw_text;
    end if;
    select o.label into option_label
    from public.dynamic_field_options o
    where o.field_id = p_field_id
      and o.code = raw_text
    limit 1;
    return coalesce(option_label, raw_text);
  end if;

  if p_field_type = 'employee' then
    raw_text := btrim(coalesce(p_value #>> '{}', ''));
    if raw_text = '' then
      return '';
    end if;
    begin
      select coalesce(nullif(p.full_name, ''), p.email, '') into employee_name
      from public.profiles p
      where p.id = raw_text::uuid;
    exception
      when others then
        return raw_text;
    end;
    return coalesce(employee_name, raw_text);
  end if;

  return btrim(coalesce(p_value #>> '{}', ''));
end;
$$;

create or replace function public.document_dynamic_field_values(
  p_entity text,
  p_record_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb := '{}'::jsonb;
  field_row record;
  text_value text;
  key text;
begin
  if p_record_id is null then
    return result;
  end if;

  for field_row in
    select f.id, f.code, f.field_type, v.value
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id
     and v.record_id = p_record_id
    where f.entity_code = p_entity
      and f.is_active = true
      and not public.is_order_card_field(f.entity_code, f.code)
  loop
    text_value := public.document_field_value_text(field_row.field_type, field_row.value, field_row.id);
    key := 'field.' || p_entity || '.' || field_row.code;
    result := result || jsonb_build_object(key, coalesce(text_value, ''));
  end loop;

  return result;
end;
$$;

create or replace function public.empty_document_values()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'company.name', 'Эндотека',
    'document.number', '',
    'document.issuedAt', '',
    'order.number', '',
    'order.createdAt', '',
    'order.status', '',
    'order.claimedMalfunction', '',
    'order.completeness', '',
    'order.externalCondition', '',
    'order.deadline', '',
    'order.readyDate', '',
    'order.responsible', '',
    'customer.name', '',
    'customer.phone', '',
    'customer.email', '',
    'customer.inn', '',
    'customer.city', '',
    'customer.contactName', '',
    'device.serialNumber', '',
    'device.model', '',
    'device.brand', '',
    'device.group', '',
    'device.label', '',
    'sale.invoiceNumber', '',
    'sale.date', '',
    'sale.total', '',
    'sale.customerName', '',
    'sale.status', '',
    'item.name', '',
    'item.code', '',
    'item.article', '',
    'item.barcode', '',
    'part.name', '',
    'part.code', '',
    'part.article', '',
    'part.quantity', '',
    'part.unitName', '',
    'part.price', '',
    'line.name', '',
    'line.code', '',
    'line.article', '',
    'line.quantity', '',
    'line.unitName', '',
    'line.price', '',
    'line.amount', ''
  );
$$;

drop function if exists public.create_order(uuid, uuid, text, text, text, date, uuid);

create or replace function public.create_order(
  target_customer_id uuid,
  target_device_id uuid,
  claimed_malfunction text,
  completeness text default '',
  external_condition text default '',
  target_deadline date default null,
  target_responsible_id uuid default null,
  target_ready_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  v_number text;
  v_seq integer;
  device_serial text;
  initial_status uuid;
  malfunction text;
begin
  if not public.has_permission('orders:create') then
    raise exception 'Недостаточно прав для создания заказа.';
  end if;

  malfunction := btrim(coalesce(claimed_malfunction, ''));

  if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
    raise exception 'Клиент не найден.';
  end if;

  select serial_number into device_serial from public.devices where id = target_device_id;
  if device_serial is null then
    raise exception 'Прибор не найден.';
  end if;

  select m.status_id into initial_status
  from public.order_status_meta m
  join public.reference_items i on i.id = m.status_id
  where m.is_initial = true and i.is_active = true
  order by i.sort_order
  limit 1;

  if initial_status is null then
    raise exception 'Не задан начальный статус заказа.';
  end if;

  if target_responsible_id is not null
     and not exists (select 1 from public.profiles where id = target_responsible_id and is_active = true) then
    raise exception 'Ответственный сотрудник не найден.';
  end if;

  select n.order_number, n.seq into v_number, v_seq from public.next_order_number() as n;

  insert into public.orders (
    number, number_seq, customer_id, device_id, serial_number,
    claimed_malfunction, completeness, external_condition,
    deadline, ready_date, responsible_id, status_id, created_by
  )
  values (
    v_number, v_seq, target_customer_id, target_device_id, device_serial,
    malfunction, btrim(coalesce(completeness, '')), btrim(coalesce(external_condition, '')),
    target_deadline, target_ready_date, target_responsible_id, initial_status, auth.uid()
  )
  returning id into result_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (result_id, null, initial_status, auth.uid(), jsonb_build_object('source', 'create'));

  perform public.record_audit(
    'orders.created',
    'order',
    result_id::text,
    jsonb_build_object('number', v_number)
  );

  if target_responsible_id is not null then
    perform public.record_audit(
      'orders.assigned',
      'order',
      result_id::text,
      jsonb_build_object('responsible_id', target_responsible_id, 'number', v_number)
    );

    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      result_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', result_id,
        'order_number', v_number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || v_number
      )
    );
  end if;

  return result_id;
end;
$$;

drop function if exists public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean
);

create or replace function public.update_order(
  target_order_id uuid,
  claimed_malfunction text default null,
  completeness text default null,
  external_condition text default null,
  target_deadline date default null,
  clear_deadline boolean default false,
  target_responsible_id uuid default null,
  change_responsible boolean default false,
  target_customer_id uuid default null,
  change_customer boolean default false,
  target_device_id uuid default null,
  change_device boolean default false,
  target_ready_date date default null,
  clear_ready_date boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
  field_changed boolean;
  assigned boolean;
  device_serial text;
  next_malfunction text := claimed_malfunction;
  next_completeness text := completeness;
  next_external text := external_condition;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if next_malfunction is not null or next_completeness is not null or next_external is not null
     or target_deadline is not null or clear_deadline
     or target_ready_date is not null or clear_ready_date
     or change_customer or change_device then
    if not public.has_permission('orders:update') then
      raise exception 'Недостаточно прав для изменения заказа.';
    end if;
  end if;

  if change_responsible and not (public.has_permission('orders:assign') or public.has_permission('orders:update')) then
    raise exception 'Недостаточно прав для назначения ответственного.';
  end if;

  if change_customer then
    if target_customer_id is null then
      raise exception 'Укажите клиента.';
    end if;
    if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
      raise exception 'Клиент не найден.';
    end if;
  end if;

  if change_device then
    if target_device_id is null then
      raise exception 'Укажите прибор.';
    end if;
    select d.serial_number into device_serial from public.devices d where d.id = target_device_id;
    if device_serial is null then
      raise exception 'Прибор не найден.';
    end if;
  end if;

  previous_responsible := current_row.responsible_id;
  field_changed := next_malfunction is not null
    or next_completeness is not null
    or next_external is not null
    or target_deadline is not null
    or clear_deadline
    or target_ready_date is not null
    or clear_ready_date
    or change_customer
    or change_device;
  assigned := change_responsible and target_responsible_id is distinct from previous_responsible;

  update public.orders
  set
    claimed_malfunction = case
      when next_malfunction is not null then btrim(next_malfunction)
      else orders.claimed_malfunction
    end,
    completeness = case
      when next_completeness is not null then btrim(next_completeness)
      else orders.completeness
    end,
    external_condition = case
      when next_external is not null then btrim(next_external)
      else orders.external_condition
    end,
    deadline = case
      when clear_deadline then null
      when target_deadline is not null then target_deadline
      else orders.deadline
    end,
    ready_date = case
      when clear_ready_date then null
      when target_ready_date is not null then target_ready_date
      else orders.ready_date
    end,
    responsible_id = case
      when change_responsible then target_responsible_id
      else orders.responsible_id
    end,
    customer_id = case
      when change_customer then target_customer_id
      else orders.customer_id
    end,
    device_id = case
      when change_device then target_device_id
      else orders.device_id
    end,
    serial_number = case
      when change_device then device_serial
      else orders.serial_number
    end
  where id = target_order_id;

  if assigned then
    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', target_order_id,
        'order_number', current_row.number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || current_row.number
      )
    );

    perform public.record_audit(
      'orders.assigned',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'previous_responsible_id', previous_responsible,
        'responsible_id', target_responsible_id,
        'number', current_row.number
      )
    );
  end if;

  if field_changed then
    perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.build_document_context(
  p_source_type text,
  p_source_id uuid,
  p_document_number text default '',
  p_issued_at text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  doc_values jsonb := public.empty_document_values();
  parts jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  first_part jsonb;
  first_line jsonb;
  order_customer_id uuid;
  order_device_id uuid;
begin
  doc_values := doc_values || jsonb_build_object(
    'document.number', coalesce(p_document_number, ''),
    'document.issuedAt', coalesce(p_issued_at, '')
  );

  if p_source_type = 'order' then
    if not public.has_permission('orders:read') then
      raise exception 'Недостаточно прав для данных заказа.';
    end if;

    select
      doc_values || jsonb_build_object(
        'order.number', o.number,
        'order.createdAt', to_char(o.created_at, 'YYYY-MM-DD'),
        'order.status', coalesce(st.name, ''),
        'order.claimedMalfunction', o.claimed_malfunction,
        'order.completeness', o.completeness,
        'order.externalCondition', o.external_condition,
        'order.deadline', coalesce(to_char(o.deadline, 'YYYY-MM-DD'), ''),
        'order.readyDate', coalesce(to_char(o.ready_date, 'YYYY-MM-DD'), ''),
        'order.responsible', coalesce(resp.full_name, ''),
        'customer.name', coalesce(c.name, ''),
        'customer.phone', coalesce(c.phone, ''),
        'customer.email', coalesce(c.email, ''),
        'customer.inn', coalesce(c.inn, ''),
        'customer.city', coalesce(c.city, ''),
        'customer.contactName', coalesce(c.contact_name, ''),
        'device.serialNumber', coalesce(o.serial_number, ''),
        'device.model', coalesce(model.name, ''),
        'device.brand', coalesce(brand.name, ''),
        'device.group', coalesce(grp.name, ''),
        'device.label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), o.serial_number))
      ),
      o.customer_id,
      o.device_id
    into doc_values, order_customer_id, order_device_id
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join public.devices d on d.id = o.device_id
    left join public.reference_items st on st.id = o.status_id
    left join public.reference_items grp on grp.id = d.group_id
    left join public.reference_items brand on brand.id = d.brand_id
    left join public.reference_items model on model.id = d.model_id
    left join public.profiles resp on resp.id = o.responsible_id
    where o.id = p_source_id;

    if doc_values is null then
      raise exception 'Заказ не найден.';
    end if;

    doc_values := doc_values
      || public.document_dynamic_field_values('orders', p_source_id)
      || public.document_dynamic_field_values('customers', order_customer_id)
      || public.document_dynamic_field_values('devices', order_device_id)
      || public.document_dynamic_field_values('diagnostics', p_source_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'part.name', x.item_name,
      'part.code', x.item_code,
      'part.article', x.item_article,
      'part.quantity', x.quantity,
      'part.unitName', x.unit_name,
      'part.price', x.unit_price
    ) order by x.created_at), '[]'::jsonb)
    into parts
    from (
      select
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        trim(to_char(l.quantity, '999999990.999')) as quantity,
        coalesce(u.name, '') as unit_name,
        trim(to_char(l.unit_price, '999999990.99')) as unit_price,
        l.created_at
      from public.order_part_lines l
      join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      where l.order_id = p_source_id
    ) x;

    first_part := parts -> 0;
    if first_part is not null then
      doc_values := doc_values || first_part;
    end if;
  elsif p_source_type = 'sale' then
    if not public.has_permission('sales:read') then
      raise exception 'Недостаточно прав для данных продажи.';
    end if;

    select
      doc_values || jsonb_build_object(
        'sale.invoiceNumber', s.invoice_number,
        'sale.date', to_char(s.sale_date, 'YYYY-MM-DD'),
        'sale.total', trim(to_char(s.total, '999999990.99')),
        'sale.customerName', coalesce(c.name, ''),
        'sale.status', case s.status
          when 'draft' then 'Черновик'
          when 'confirmed' then 'Подтверждена'
          when 'cancelled' then 'Отменена'
          else s.status
        end,
        'customer.name', coalesce(c.name, ''),
        'customer.phone', coalesce(c.phone, ''),
        'customer.email', coalesce(c.email, ''),
        'customer.inn', coalesce(c.inn, ''),
        'customer.city', coalesce(c.city, ''),
        'customer.contactName', coalesce(c.contact_name, '')
      ),
      s.customer_id
    into doc_values, order_customer_id
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.id = p_source_id;

    if doc_values is null then
      raise exception 'Продажа не найдена.';
    end if;

    doc_values := doc_values || public.document_dynamic_field_values('customers', order_customer_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'line.name', i.name,
      'line.code', i.code,
      'line.article', i.article,
      'line.quantity', trim(to_char(l.quantity, '999999990.999')),
      'line.unitName', coalesce(u.name, ''),
      'line.price', trim(to_char(l.unit_price, '999999990.99')),
      'line.amount', trim(to_char(l.amount, '999999990.99'))
    ) order by l.sort_order, l.created_at), '[]'::jsonb)
    into lines
    from public.sale_lines l
    join public.inventory_items i on i.id = l.item_id
    left join public.reference_items u on u.id = i.unit_id
    where l.sale_id = p_source_id;

    first_line := lines -> 0;
    if first_line is not null then
      doc_values := doc_values || first_line;
    end if;
  elsif p_source_type = 'item' then
    if not (
      public.can_read_inventory()
      or public.has_permission('orders:read')
      or public.has_permission('sales:read')
    ) then
      raise exception 'Недостаточно прав для данных номенклатуры.';
    end if;

    select doc_values || jsonb_build_object(
      'item.name', i.name,
      'item.code', i.code,
      'item.article', i.article,
      'item.barcode', i.barcode,
      'part.name', i.name,
      'part.code', i.code,
      'part.article', i.article
    )
    into doc_values
    from public.inventory_items i
    where i.id = p_source_id;

    if doc_values is null then
      raise exception 'Позиция не найдена.';
    end if;

    doc_values := doc_values || public.document_dynamic_field_values('inventory', p_source_id);
  elsif p_source_type <> 'none' then
    raise exception 'Неизвестный источник документа.';
  end if;

  return jsonb_build_object(
    'values', doc_values,
    'parts', coalesce(parts, '[]'::jsonb),
    'lines', coalesce(lines, '[]'::jsonb)
  );
end;
$$;

create or replace function public.issue_document(target_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.documents%rowtype;
  template_body jsonb;
  issued_label text;
  context jsonb;
  updated_id uuid;
begin
  perform public.assert_documents_create();

  select * into current_row
  from public.documents
  where id = target_document_id
  for update;

  if current_row.id is null then
    raise exception 'Документ не найден.';
  end if;

  if current_row.status = 'issued' then
    raise exception 'Документ уже выпущен.';
  end if;

  select body into template_body
  from public.document_templates
  where id = current_row.template_id;

  issued_label := to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS');
  context := public.build_document_context(
    current_row.source_type,
    current_row.source_id,
    current_row.number,
    issued_label
  );

  update public.documents
  set status = 'issued',
      issued_at = now(),
      body = coalesce(template_body, body),
      context = context
  where id = target_document_id
    and status = 'draft'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Документ уже выпущен.';
  end if;

  perform public.record_audit(
    'document.issued',
    'document',
    target_document_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

revoke all on function public.document_field_value_text(text, jsonb, uuid) from public, anon;
revoke all on function public.document_dynamic_field_values(text, uuid) from public, anon;
revoke all on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) from public, anon;
revoke all on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean
) from public, anon;

grant execute on function public.create_order(uuid, uuid, text, text, text, date, uuid, date) to authenticated;
grant execute on function public.update_order(
  uuid, text, text, text, date, boolean, uuid, boolean, uuid, boolean, uuid, boolean, date, boolean
) to authenticated;

notify pgrst, 'reload schema';
