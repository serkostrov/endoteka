-- Акт диагностики: вложенный токен поля «Прочие дефекты» внутри «Коннектор»
-- затирал значение при печати (внешний konnektor → «Норма»).
-- Разворачиваем вложенность в макетах 02/03, оставляя leaf-токен prochie_defekty.

do $$
declare
  tpl record;
  html text;
  fixed text;
  next_body jsonb;
begin
  for tpl in
    select t.id, t.body
    from public.document_templates t
    where t.id in (
      '91be6ba9-3d7f-4e0e-ab68-e507195f22a5', -- 02. Акт диагностики
      '6c5c864c-d8e2-425b-8c5a-33a8cee42382'  -- 03. Акт диагностики (с печатью)
    )
  loop
    if jsonb_typeof(tpl.body) <> 'array' or jsonb_array_length(tpl.body) = 0 then
      continue;
    end if;

    html := tpl.body -> 0 ->> 'html';
    if html is null or position('prochie_defekty' in html) = 0 then
      continue;
    end if;

    fixed := regexp_replace(
      html,
      '<span(?=[^>]*class="doc-field")(?=[^>]*data-field="field\.diagnostics\.konnektor")[^>]*>\s*'
        || '<span(?=[^>]*class="doc-field")(?=[^>]*data-field="field\.diagnostics\.prochie_defekty")[^>]*>'
        || '(.*?)</span>\s*(?:&nbsp;|<br\s*/?>|\s)*</span>',
      '<span class="doc-field" data-field="field.diagnostics.prochie_defekty">\1</span>',
      'gi'
    );

    if fixed is distinct from html then
      next_body := jsonb_set(tpl.body, '{0,html}', to_jsonb(fixed));
      update public.document_templates t
      set body = next_body,
          updated_at = now()
      where t.id = tpl.id;
    end if;
  end loop;
end;
$$;
