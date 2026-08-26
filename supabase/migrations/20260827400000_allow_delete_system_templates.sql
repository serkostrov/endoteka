-- Системные шаблоны можно удалять и менять тип, как обычные.

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
