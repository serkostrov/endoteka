-- Удаление вложения заказа: запись в журнале, строка вложения, аудит.

create or replace function public.delete_order_attachment(target_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_attachments%rowtype;
  stored_name text;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для удаления файла.';
  end if;

  select * into current_row
  from public.order_attachments
  where id = target_attachment_id
  for update;

  if current_row.id is null then
    raise exception 'Файл не найден.';
  end if;

  stored_name := coalesce(nullif(btrim(current_row.file_name), ''), nullif(btrim(current_row.caption), ''), 'файл');

  delete from public.order_attachments
  where id = target_attachment_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'attachment',
    auth.uid(),
    'Удалён файл: ' || left(stored_name, 120),
    jsonb_build_object(
      'attachment_id', current_row.id,
      'kind', current_row.kind,
      'file_name', current_row.file_name,
      'deleted', true
    )
  );

  perform public.record_audit(
    'orders.attachment_deleted',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'attachment_id', current_row.id,
      'file_name', current_row.file_name
    )
  );
end;
$$;

revoke all on function public.delete_order_attachment(uuid) from public, anon;
grant execute on function public.delete_order_attachment(uuid) to authenticated;

notify pgrst, 'reload schema';
