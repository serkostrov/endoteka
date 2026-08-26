-- Вложения заказа: пустые файлы допустимы, лимит 5 ГБ.
-- integer не вмещает 5 ГБ, поэтому размер хранится как bigint.

alter table public.order_attachments
  alter column file_size type bigint;

update storage.buckets
set file_size_limit = 5368709120
where id = 'order-attachments';

drop function if exists public.register_order_file(uuid, text, text, text, integer, text);
drop function if exists public.register_order_file(uuid, text, text, text, bigint, text);

create or replace function public.register_order_file(
  target_order_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  caption text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  kind text;
  normalized_path text;
  stored_name text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для добавления файла.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  normalized_path := btrim(coalesce(file_path, ''));
  if normalized_path ~ '\.\.|//' or normalized_path not like target_order_id::text || '/%' then
    raise exception 'Некорректный путь файла.';
  end if;
  if strpos(substr(normalized_path, length(target_order_id::text) + 2), '/') > 0 then
    raise exception 'Некорректный путь файла.';
  end if;

  if file_size is null or file_size < 0 or file_size > 5368709120 then
    raise exception 'Размер файла превышает допустимый.';
  end if;

  if mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/jpg') then
    kind := 'photo';
  elsif mime_type = 'application/pdf' then
    kind := 'pdf';
  else
    raise exception 'Можно загрузить только фото или PDF. Видео добавляйте ссылкой.';
  end if;

  stored_name := left(btrim(coalesce(file_name, 'file')), 200);

  insert into public.order_attachments (
    order_id, kind, file_path, file_name, mime_type, file_size, caption, created_by
  )
  values (
    target_order_id,
    kind,
    normalized_path,
    stored_name,
    mime_type,
    file_size,
    btrim(coalesce(caption, '')),
    auth.uid()
  )
  returning id into result_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'attachment',
    auth.uid(),
    'Добавлен файл: ' || left(stored_name, 120),
    jsonb_build_object(
      'attachment_id', result_id,
      'kind', kind,
      'file_name', stored_name,
      'mime_type', mime_type
    )
  );

  return result_id;
end;
$$;

revoke all on function public.register_order_file(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.register_order_file(uuid, text, text, text, bigint, text) to authenticated;
