-- Системная «Этикетка запчасти»: HTML-макет как на карточке склада (58×40 мм).

update public.document_templates
set
  name = 'Этикетка запчасти',
  kind = 'label',
  page_size = 'label',
  body = $json$
  [
    {
      "id": "label-part-html",
      "type": "html",
      "margins": { "top": 2.5, "right": 2.5, "bottom": 2.5, "left": 2.5 },
      "html": "<div class=\"item-label-layout\" style=\"display: flex; flex-direction: column; box-sizing: border-box; height: 100%; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #000;\"><p class=\"item-label-title\" style=\"margin: 0; padding: 0; font-size: 8pt; font-weight: 600; line-height: 1.15; word-break: break-word;\"><span class=\"doc-field\" data-field=\"item.name\">Уплотнитель канала</span></p><p class=\"item-label-meta\" style=\"margin: 0.6mm 0 0; padding: 0; font-size: 6.5pt; font-weight: 400; line-height: 1.15; color: #404040; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\"><span class=\"doc-field\" data-field=\"item.labelMeta\">Код INV-000001 · Арт. ART-100</span></p><div class=\"item-label-barcode\" style=\"display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; min-height: 0; margin: 1.5mm 0 0; padding: 0;\"><span class=\"doc-barcode\" data-code=\"{{item.barcode}}\">Штрихкод</span></div></div>"
    }
  ]
  $json$::jsonb,
  updated_at = now()
where code = 'label_part'
  and deleted_at is null;

insert into public.document_templates (code, name, kind, page_size, is_system, body)
select
  'label_part',
  'Этикетка запчасти',
  'label',
  'label',
  true,
  $json$
  [
    {
      "id": "label-part-html",
      "type": "html",
      "margins": { "top": 2.5, "right": 2.5, "bottom": 2.5, "left": 2.5 },
      "html": "<div class=\"item-label-layout\" style=\"display: flex; flex-direction: column; box-sizing: border-box; height: 100%; text-align: center; font-family: Arial, Helvetica, sans-serif; color: #000;\"><p class=\"item-label-title\" style=\"margin: 0; padding: 0; font-size: 8pt; font-weight: 600; line-height: 1.15; word-break: break-word;\"><span class=\"doc-field\" data-field=\"item.name\">Уплотнитель канала</span></p><p class=\"item-label-meta\" style=\"margin: 0.6mm 0 0; padding: 0; font-size: 6.5pt; font-weight: 400; line-height: 1.15; color: #404040; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\"><span class=\"doc-field\" data-field=\"item.labelMeta\">Код INV-000001 · Арт. ART-100</span></p><div class=\"item-label-barcode\" style=\"display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; justify-content: center; min-height: 0; margin: 1.5mm 0 0; padding: 0;\"><span class=\"doc-barcode\" data-code=\"{{item.barcode}}\">Штрихкод</span></div></div>"
    }
  ]
  $json$::jsonb
where not exists (
  select 1
  from public.document_templates t
  where t.code = 'label_part'
    and t.deleted_at is null
);
