-- Восстановить системную этикетку запчасти: без неё печать наклеек из карточки склада недоступна.

update public.document_templates
set
  deleted_at = null,
  name = 'Этикетка запчасти',
  kind = 'label',
  page_size = 'label',
  is_system = true,
  body = $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.barcode}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
  $json$::jsonb
where id = (
  select t.id
  from public.document_templates t
  where t.code = 'label_part'
    and t.deleted_at is not null
    and not exists (
      select 1
      from public.document_templates active
      where active.code = 'label_part'
        and active.deleted_at is null
    )
  order by t.updated_at desc nulls last, t.created_at desc
  limit 1
);

insert into public.document_templates (code, name, kind, page_size, is_system, body)
select
  'label_part',
  'Этикетка запчасти',
  'label',
  'label',
  true,
  $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.barcode}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
  $json$::jsonb
where not exists (
  select 1
  from public.document_templates t
  where t.code = 'label_part'
    and t.deleted_at is null
);
