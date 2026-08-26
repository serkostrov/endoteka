-- Эндотека: документы и шаблоны печатных форм. Плейсхолдеры только из явного набора полей.

create sequence if not exists public.document_number_seq;

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  kind text not null,
  page_size text not null default 'a4',
  body jsonb not null default '[]'::jsonb,
  is_system boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_templates_code_present check (btrim(code) <> ''),
  constraint document_templates_name_present check (btrim(name) <> ''),
  constraint document_templates_kind_check check (
    kind in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom')
  ),
  constraint document_templates_page_size_check check (page_size in ('a4', 'label')),
  constraint document_templates_body_array check (jsonb_typeof(body) = 'array')
);

create unique index if not exists document_templates_code_unique
  on public.document_templates (code);

create index if not exists document_templates_kind_idx
  on public.document_templates (kind, name);

create trigger document_templates_set_updated_at
  before update on public.document_templates
  for each row execute procedure public.set_updated_at();

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  template_id uuid not null references public.document_templates (id) on delete restrict,
  title text not null,
  kind text not null,
  source_type text not null default 'none',
  source_id uuid,
  status text not null default 'draft',
  body jsonb not null default '[]'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  constraint documents_number_present check (btrim(number) <> ''),
  constraint documents_title_present check (btrim(title) <> ''),
  constraint documents_kind_check check (
    kind in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom')
  ),
  constraint documents_source_type_check check (source_type in ('order', 'sale', 'item', 'none')),
  constraint documents_source_required check (
    (source_type = 'none' and source_id is null)
    or (source_type <> 'none' and source_id is not null)
  ),
  constraint documents_status_check check (status in ('draft', 'issued')),
  constraint documents_issued_at_check check (
    (status = 'issued' and issued_at is not null)
    or (status = 'draft' and issued_at is null)
  ),
  constraint documents_body_array check (jsonb_typeof(body) = 'array')
);

create unique index if not exists documents_number_unique
  on public.documents (number);

create index if not exists documents_created_at_idx
  on public.documents (created_at desc);

create index if not exists documents_kind_idx
  on public.documents (kind, created_at desc);

create index if not exists documents_source_idx
  on public.documents (source_type, source_id);

create or replace function public.assert_documents_access()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('documents:read')
    or public.has_permission('documents:create')
    or public.has_permission('documents:print')
    or public.has_permission('documents:edit_templates')
  ) then
    raise exception 'Недостаточно прав для документов.';
  end if;
end;
$$;

create or replace function public.assert_documents_create()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('documents:create') then
    raise exception 'Недостаточно прав для создания документа.';
  end if;
end;
$$;

create or replace function public.assert_templates_edit()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('documents:edit_templates') then
    raise exception 'Недостаточно прав для изменения шаблонов.';
  end if;
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
begin
  doc_values := doc_values || jsonb_build_object(
    'document.number', coalesce(p_document_number, ''),
    'document.issuedAt', coalesce(p_issued_at, '')
  );

  if p_source_type = 'order' then
    if not public.has_permission('orders:read') then
      raise exception 'Недостаточно прав для данных заказа.';
    end if;

    select doc_values || jsonb_build_object(
      'order.number', o.number,
      'order.createdAt', to_char(o.created_at, 'DD.MM.YYYY'),
      'order.status', coalesce(st.name, ''),
      'order.claimedMalfunction', o.claimed_malfunction,
      'order.completeness', o.completeness,
      'order.externalCondition', o.external_condition,
      'order.deadline', coalesce(to_char(o.deadline, 'DD.MM.YYYY'), ''),
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
    )
    into doc_values
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
        trim(to_char(abs(m.quantity), '999999990.999')) as quantity,
        coalesce(u.name, '') as unit_name,
        trim(to_char(m.unit_price, '999999990.99')) as unit_price,
        m.created_at
      from public.inventory_movements m
      join public.inventory_items i on i.id = m.item_id
      left join public.reference_items u on u.id = i.unit_id
      where m.reference_type = 'order'
        and m.reference_id = p_source_id
        and m.movement_type = 'repair_consumption'
    ) x;

    first_part := parts -> 0;
    if first_part is not null then
      doc_values := doc_values || first_part;
    end if;
  elsif p_source_type = 'sale' then
    if not public.has_permission('sales:read') then
      raise exception 'Недостаточно прав для данных продажи.';
    end if;

    select doc_values || jsonb_build_object(
      'sale.invoiceNumber', s.invoice_number,
      'sale.date', to_char(s.sale_date, 'DD.MM.YYYY'),
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
    )
    into doc_values
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.id = p_source_id;

    if doc_values is null then
      raise exception 'Продажа не найдена.';
    end if;

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

create or replace function public.get_document_context(
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_documents_access();
  return public.build_document_context(p_source_type, p_source_id, '', '');
end;
$$;

create or replace function public.list_document_templates(
  kind_filter text default '',
  search_query text default ''
)
returns table (
  id uuid,
  code text,
  name text,
  kind text,
  page_size text,
  is_system boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  kind_value text;
begin
  perform public.assert_documents_access();

  kind_value := coalesce(nullif(btrim(kind_filter), ''), '');
  if kind_value <> '' and kind_value not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип шаблона.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    t.id,
    t.code,
    t.name,
    t.kind,
    t.page_size,
    t.is_system,
    t.updated_at
  from public.document_templates t
  where (kind_value = '' or t.kind = kind_value)
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.name ilike term escape '\'
      or t.code ilike term escape '\'
    )
  order by t.is_system desc, t.name;
end;
$$;

create or replace function public.get_document_template(target_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_documents_access();

  select jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'name', t.name,
    'kind', t.kind,
    'page_size', t.page_size,
    'body', t.body,
    'is_system', t.is_system,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
  into payload
  from public.document_templates t
  where t.id = target_template_id;

  if payload is null then
    raise exception 'Шаблон не найден.';
  end if;

  return payload;
end;
$$;

create or replace function public.create_document_template(
  template_name text,
  template_kind text,
  template_page_size text default 'a4',
  template_body jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
begin
  perform public.assert_templates_edit();

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите название шаблона.';
  end if;

  if template_kind is null or template_kind not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип шаблона.';
  end if;

  if coalesce(template_page_size, 'a4') not in ('a4', 'label') then
    raise exception 'Неизвестный формат страницы.';
  end if;

  if jsonb_typeof(coalesce(template_body, '[]'::jsonb)) <> 'array' then
    raise exception 'Тело шаблона должно быть списком блоков.';
  end if;

  next_code := 'custom-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  insert into public.document_templates (code, name, kind, page_size, body, is_system, created_by)
  values (
    next_code,
    btrim(template_name),
    template_kind,
    coalesce(template_page_size, 'a4'),
    coalesce(template_body, '[]'::jsonb),
    false,
    auth.uid()
  )
  returning id into result_id;

  perform public.record_audit(
    'document.template_created',
    'document_template',
    result_id::text,
    jsonb_build_object('name', btrim(template_name), 'kind', template_kind)
  );

  return result_id;
end;
$$;

create or replace function public.update_document_template(
  target_template_id uuid,
  template_name text,
  template_kind text,
  template_page_size text,
  template_body jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.document_templates%rowtype;
begin
  perform public.assert_templates_edit();

  select * into current_row
  from public.document_templates
  where id = target_template_id
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите название шаблона.';
  end if;

  if jsonb_typeof(coalesce(template_body, '[]'::jsonb)) <> 'array' then
    raise exception 'Тело шаблона должно быть списком блоков.';
  end if;

  if current_row.is_system then
    update public.document_templates
    set name = btrim(template_name),
        page_size = case when template_page_size in ('a4', 'label') then template_page_size else page_size end,
        body = coalesce(template_body, body)
    where id = target_template_id;
  else
    if template_kind is null or template_kind not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
      raise exception 'Неизвестный тип шаблона.';
    end if;

    if template_page_size is null or template_page_size not in ('a4', 'label') then
      raise exception 'Неизвестный формат страницы.';
    end if;

    update public.document_templates
    set name = btrim(template_name),
        kind = template_kind,
        page_size = template_page_size,
        body = coalesce(template_body, body)
    where id = target_template_id;
  end if;

  perform public.record_audit(
    'document.template_updated',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', btrim(template_name))
  );
end;
$$;

create or replace function public.delete_document_template(target_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.document_templates%rowtype;
begin
  perform public.assert_templates_edit();

  select * into current_row
  from public.document_templates
  where id = target_template_id
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  if current_row.is_system then
    raise exception 'Системный шаблон нельзя удалить.';
  end if;

  if exists (select 1 from public.documents where template_id = target_template_id) then
    raise exception 'Шаблон уже использован в документах.';
  end if;

  delete from public.document_templates
  where id = target_template_id;

  perform public.record_audit(
    'document.template_deleted',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

create or replace function public.list_documents(
  search_query text default '',
  kind_filter text default '',
  source_type_filter text default '',
  source_id_filter uuid default null,
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  number text,
  title text,
  kind text,
  source_type text,
  source_id uuid,
  source_label text,
  status text,
  created_by_name text,
  created_at timestamptz,
  issued_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  kind_value text;
  source_value text;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_documents_access();

  kind_value := coalesce(nullif(btrim(kind_filter), ''), '');
  if kind_value <> '' and kind_value not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип документа.';
  end if;

  source_value := coalesce(nullif(btrim(source_type_filter), ''), '');
  if source_value <> '' and source_value not in ('order', 'sale', 'item', 'none') then
    raise exception 'Неизвестный источник.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    d.id,
    d.number,
    d.title,
    d.kind,
    d.source_type,
    d.source_id,
    case d.source_type
      when 'order' then coalesce(o.number, '')
      when 'sale' then coalesce(s.invoice_number, '')
      when 'item' then coalesce(i.name, '')
      else ''
    end as source_label,
    d.status,
    coalesce(p.full_name, '') as created_by_name,
    d.created_at,
    d.issued_at,
    count(*) over() as total_count
  from public.documents d
  left join public.orders o on d.source_type = 'order' and o.id = d.source_id
  left join public.sales s on d.source_type = 'sale' and s.id = d.source_id
  left join public.inventory_items i on d.source_type = 'item' and i.id = d.source_id
  left join public.profiles p on p.id = d.created_by
  where (kind_value = '' or d.kind = kind_value)
    and (source_value = '' or d.source_type = source_value)
    and (source_id_filter is null or d.source_id = source_id_filter)
    and (
      btrim(coalesce(search_query, '')) = ''
      or d.number ilike term escape '\'
      or d.title ilike term escape '\'
      or o.number ilike term escape '\'
      or s.invoice_number ilike term escape '\'
      or i.name ilike term escape '\'
    )
  order by d.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_document(target_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_documents_access();

  select jsonb_build_object(
    'id', d.id,
    'number', d.number,
    'title', d.title,
    'kind', d.kind,
    'status', d.status,
    'source_type', d.source_type,
    'source_id', d.source_id,
    'source_label', case d.source_type
      when 'order' then coalesce(o.number, '')
      when 'sale' then coalesce(s.invoice_number, '')
      when 'item' then coalesce(i.name, '')
      else ''
    end,
    'template_id', d.template_id,
    'template_name', t.name,
    'page_size', t.page_size,
    'body', case when d.status = 'issued' then d.body else t.body end,
    'context', d.context,
    'created_by', d.created_by,
    'created_by_name', coalesce(p.full_name, ''),
    'created_at', d.created_at,
    'issued_at', d.issued_at
  )
  into payload
  from public.documents d
  join public.document_templates t on t.id = d.template_id
  left join public.orders o on d.source_type = 'order' and o.id = d.source_id
  left join public.sales s on d.source_type = 'sale' and s.id = d.source_id
  left join public.inventory_items i on d.source_type = 'item' and i.id = d.source_id
  left join public.profiles p on p.id = d.created_by
  where d.id = target_document_id;

  if payload is null then
    raise exception 'Документ не найден.';
  end if;

  return payload;
end;
$$;

create or replace function public.create_document(
  target_template_id uuid,
  p_source_type text default 'none',
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row public.document_templates%rowtype;
  result_id uuid;
  next_number text;
  source_type text;
  context jsonb;
begin
  perform public.assert_documents_create();

  select * into template_row
  from public.document_templates
  where id = target_template_id;

  if template_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  source_type := coalesce(nullif(btrim(p_source_type), ''), 'none');
  if source_type not in ('order', 'sale', 'item', 'none') then
    raise exception 'Неизвестный источник.';
  end if;

  if source_type = 'none' then
    p_source_id := null;
  elsif p_source_id is null then
    raise exception 'Укажите объект документа.';
  end if;

  next_number := 'ДОК-' || lpad(nextval('public.document_number_seq')::text, 6, '0');
  context := public.build_document_context(source_type, p_source_id, next_number, '');

  insert into public.documents (
    number, template_id, title, kind, source_type, source_id, status, body, context, created_by
  )
  values (
    next_number,
    template_row.id,
    template_row.name,
    template_row.kind,
    source_type,
    p_source_id,
    'draft',
    template_row.body,
    context,
    auth.uid()
  )
  returning id into result_id;

  perform public.record_audit(
    'document.created',
    'document',
    result_id::text,
    jsonb_build_object('number', next_number, 'template_id', template_row.id, 'source_type', source_type)
  );

  return result_id;
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

  issued_label := to_char(now(), 'DD.MM.YYYY HH24:MI');
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

insert into public.document_templates (code, name, kind, page_size, is_system, body)
values
(
  'act_acceptance',
  'Акт приёма-передачи',
  'act_acceptance',
  'a4',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":1,"text":"Акт приёма-передачи"},
    {"id":"p0","type":"paragraph","text":"{{company.name}}"},
    {"id":"p1","type":"paragraph","text":"Заказ {{order.number}} от {{order.createdAt}}. Статус: {{order.status}}."},
    {"id":"f1","type":"placeholder","key":"customer.name"},
    {"id":"f2","type":"placeholder","key":"customer.phone"},
    {"id":"f3","type":"placeholder","key":"device.serialNumber"},
    {"id":"f4","type":"placeholder","key":"device.model"},
    {"id":"p2","type":"paragraph","text":"Заявленная неисправность: {{order.claimedMalfunction}}"},
    {"id":"p3","type":"paragraph","text":"Комплектность: {{order.completeness}}"},
    {"id":"p4","type":"paragraph","text":"Внешний вид: {{order.externalCondition}}"},
    {"id":"qr1","type":"qr","value":"{{order.number}}"},
    {"id":"h2","type":"heading","level":2,"text":"Подписи"},
    {"id":"t1","type":"table","source":"manual","headers":["Сдал","Принял"],"columns":["",""],"cells":[["________________","________________"]]}
  ]
  $json$::jsonb
),
(
  'act_completed_work',
  'Акт выполненных работ',
  'act_completed_work',
  'a4',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":1,"text":"Акт выполненных работ"},
    {"id":"p0","type":"paragraph","text":"{{company.name}}"},
    {"id":"p1","type":"paragraph","text":"Заказ {{order.number}} от {{order.createdAt}}."},
    {"id":"p2","type":"paragraph","text":"Клиент: {{customer.name}}, тел. {{customer.phone}}"},
    {"id":"p3","type":"paragraph","text":"Прибор: {{device.brand}} {{device.model}}, СН {{device.serialNumber}}"},
    {"id":"h2","type":"heading","level":2,"text":"Выполненные работы и запчасти"},
    {"id":"t1","type":"table","source":"order.parts","headers":["Наименование","Код","Кол-во","Ед."],"columns":["{{part.name}}","{{part.code}}","{{part.quantity}}","{{part.unitName}}"],"cells":[]},
    {"id":"p4","type":"paragraph","text":"Ответственный: {{order.responsible}}"},
    {"id":"qr1","type":"qr","value":"{{order.number}}"}
  ]
  $json$::jsonb
),
(
  'waybill',
  'Накладная',
  'waybill',
  'a4',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":1,"text":"Накладная {{sale.invoiceNumber}}"},
    {"id":"p0","type":"paragraph","text":"{{company.name}}"},
    {"id":"p1","type":"paragraph","text":"Дата: {{sale.date}}. Статус: {{sale.status}}."},
    {"id":"f1","type":"placeholder","key":"customer.name"},
    {"id":"f2","type":"placeholder","key":"customer.inn"},
    {"id":"h2","type":"heading","level":2,"text":"Товар"},
    {"id":"t1","type":"table","source":"sale.lines","headers":["Наименование","Кол-во","Цена","Сумма"],"columns":["{{line.name}}","{{line.quantity}} {{line.unitName}}","{{line.price}}","{{line.amount}}"],"cells":[]},
    {"id":"p2","type":"paragraph","text":"Итого: {{sale.total}}"},
    {"id":"bc1","type":"barcode","value":"{{sale.invoiceNumber}}"}
  ]
  $json$::jsonb
),
(
  'label_order',
  'Этикетка заказа',
  'label',
  'label',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":2,"text":"{{order.number}}"},
    {"id":"qr1","type":"qr","value":"{{order.number}}"},
    {"id":"p1","type":"text","text":"{{customer.name}}"},
    {"id":"p2","type":"text","text":"{{device.serialNumber}}"}
  ]
  $json$::jsonb
),
(
  'label_part',
  'Этикетка запчасти',
  'label',
  'label',
  true,
  $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.code}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
  $json$::jsonb
)
on conflict (code) do nothing;

alter table public.document_templates enable row level security;
alter table public.documents enable row level security;

drop policy if exists document_templates_select on public.document_templates;
create policy document_templates_select
  on public.document_templates
  for select
  to authenticated
  using (
    public.has_permission('documents:read')
    or public.has_permission('documents:create')
    or public.has_permission('documents:print')
    or public.has_permission('documents:edit_templates')
  );

drop policy if exists documents_select on public.documents;
create policy documents_select
  on public.documents
  for select
  to authenticated
  using (
    public.has_permission('documents:read')
    or public.has_permission('documents:create')
    or public.has_permission('documents:print')
    or public.has_permission('documents:edit_templates')
  );

revoke all on function public.assert_documents_access() from public;
revoke all on function public.assert_documents_create() from public;
revoke all on function public.assert_templates_edit() from public;
revoke all on function public.empty_document_values() from public;
revoke all on function public.build_document_context(text, uuid, text, text) from public;
revoke all on function public.get_document_context(text, uuid) from public;
revoke all on function public.list_document_templates(text, text) from public;
revoke all on function public.get_document_template(uuid) from public;
revoke all on function public.create_document_template(text, text, text, jsonb) from public;
revoke all on function public.update_document_template(uuid, text, text, text, jsonb) from public;
revoke all on function public.delete_document_template(uuid) from public;
revoke all on function public.list_documents(text, text, text, uuid, integer, integer) from public;
revoke all on function public.get_document(uuid) from public;
revoke all on function public.create_document(uuid, text, uuid) from public;
revoke all on function public.issue_document(uuid) from public;

grant execute on function public.get_document_context(text, uuid) to authenticated;
grant execute on function public.list_document_templates(text, text) to authenticated;
grant execute on function public.get_document_template(uuid) to authenticated;
grant execute on function public.create_document_template(text, text, text, jsonb) to authenticated;
grant execute on function public.update_document_template(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.delete_document_template(uuid) to authenticated;
grant execute on function public.list_documents(text, text, text, uuid, integer, integer) to authenticated;
grant execute on function public.get_document(uuid) to authenticated;
grant execute on function public.create_document(uuid, text, uuid) to authenticated;
grant execute on function public.issue_document(uuid) to authenticated;
