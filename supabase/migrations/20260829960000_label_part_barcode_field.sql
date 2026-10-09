-- Этикетка запчасти: в штрихкод только item.barcode.
-- Код и артикул остаются текстовыми полями, без подмены в barcode.

update public.document_templates t
set
  body = (
    select coalesce(
      jsonb_agg(
        case
          when block->>'type' = 'barcode'
            and btrim(coalesce(block->>'value', '')) in ('{{item.code}}', '{{ item.code }}')
          then jsonb_set(block, '{value}', '"{{item.barcode}}"')
          when block->>'type' = 'html' and coalesce(block->>'html', '') <> '' then
            jsonb_set(
              block,
              '{html}',
              to_jsonb(
                replace(
                  replace(block->>'html', 'data-code="{{item.code}}"', 'data-code="{{item.barcode}}"'),
                  'data-code=''{{item.code}}''',
                  'data-code=''{{item.barcode}}'''
                )
              )
            )
          else block
        end
        order by ordinality
      ),
      t.body
    )
    from jsonb_array_elements(t.body) with ordinality as x(block, ordinality)
  ),
  updated_at = now()
where t.code = 'label_part'
  and t.is_system = true
  and t.deleted_at is null
  and jsonb_typeof(t.body) = 'array';

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
