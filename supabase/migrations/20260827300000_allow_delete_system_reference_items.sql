-- Системные записи справочника можно удалять, если они нигде не используются.

create or replace function public.delete_reference_item(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  usage_count integer;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  usage_count := public.reference_item_usage_count(target_id);
  if usage_count > 0 then
    raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
  end if;

  delete from public.reference_items where id = target_id;

  perform public.record_audit(
    'references.item_deleted',
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id, 'name', current_row.name)
  );
end;
$$;
