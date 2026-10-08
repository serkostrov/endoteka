-- Шаблоны документов можно удалять даже если по ним уже есть документы.
-- Удаление мягкое: строка остаётся для истории документов, из списков пропадает.

alter table public.document_templates
  add column if not exists deleted_at timestamptz;

create index if not exists document_templates_active_idx
  on public.document_templates (kind, name)
  where deleted_at is null;

drop index if exists document_templates_code_unique;
create unique index document_templates_code_unique
  on public.document_templates (code)
  where deleted_at is null;

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
  where t.deleted_at is null
    and (kind_value = '' or t.kind = kind_value)
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
  where t.id = target_template_id
    and t.deleted_at is null;

  if payload is null then
    raise exception 'Шаблон не найден.';
  end if;

  return payload;
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
    and deleted_at is null
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
  where id = target_template_id
    and deleted_at is null;

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
    and deleted_at is null
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  update public.document_templates
  set deleted_at = now()
  where id = target_template_id
    and deleted_at is null;

  perform public.record_audit(
    'document.template_deleted',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', current_row.name)
  );
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
  where id = target_template_id
    and deleted_at is null;

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

revoke all on function public.list_document_templates(text, text) from public, anon;
grant execute on function public.list_document_templates(text, text) to authenticated;

revoke all on function public.get_document_template(uuid) from public, anon;
grant execute on function public.get_document_template(uuid) to authenticated;

revoke all on function public.update_document_template(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.update_document_template(uuid, text, text, text, jsonb) to authenticated;

revoke all on function public.delete_document_template(uuid) from public, anon;
grant execute on function public.delete_document_template(uuid) to authenticated;

revoke all on function public.create_document(uuid, text, uuid) from public, anon;
grant execute on function public.create_document(uuid, text, uuid) to authenticated;
