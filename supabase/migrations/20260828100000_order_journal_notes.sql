-- Комментарии в журнале заказа. Файлы и внешние ссылки тоже пишутся в журнал.

create or replace function public.add_order_journal_note(
  target_order_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  body text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для записи в журнал.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  body := btrim(coalesce(p_body, ''));
  if body = '' then
    raise exception 'Введите текст события.';
  end if;
  if char_length(body) > 4000 then
    raise exception 'Текст события не должен превышать 4000 символов.';
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'comment',
    auth.uid(),
    body,
    jsonb_build_object('body', body)
  )
  returning id into result_id;

  perform public.record_audit(
    'orders.journal_note',
    'order',
    target_order_id::text,
    jsonb_build_object('event_id', result_id)
  );

  return result_id;
end;
$$;

create or replace function public.add_order_attachment_url(
  target_order_id uuid,
  target_url text,
  caption text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  normalized text;
  note text;
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для добавления файла.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  normalized := btrim(coalesce(target_url, ''));
  if normalized !~* '^https?://' then
    raise exception 'Укажите ссылку, начинающуюся с http:// или https://.';
  end if;

  note := btrim(coalesce(caption, ''));

  insert into public.order_attachments (order_id, kind, url, caption, created_by)
  values (target_order_id, 'url', normalized, note, auth.uid())
  returning id into result_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'attachment',
    auth.uid(),
    case when note = '' then 'Добавлена ссылка' else 'Добавлена ссылка: ' || left(note, 120) end,
    jsonb_build_object(
      'attachment_id', result_id,
      'kind', 'url',
      'url', normalized
    )
  );

  return result_id;
end;
$$;

create or replace function public.register_order_file(
  target_order_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
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

  if file_size is null or file_size < 1 or file_size > 10485760 then
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

revoke all on function public.add_order_journal_note(uuid, text) from public, anon;
revoke all on function public.add_order_attachment_url(uuid, text, text) from public, anon;
revoke all on function public.register_order_file(uuid, text, text, text, integer, text) from public, anon;

grant execute on function public.add_order_journal_note(uuid, text) to authenticated;
grant execute on function public.add_order_attachment_url(uuid, text, text) to authenticated;
grant execute on function public.register_order_file(uuid, text, text, text, integer, text) to authenticated;
