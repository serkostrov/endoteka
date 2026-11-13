-- Раздел «Сборка заказов»: позиции ЗЧ, отдельный журнал/файлы, context задач.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.order_assembly_parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  name text not null,
  qty_required numeric not null default 0 check (qty_required >= 0),
  qty_collected numeric not null default 0 check (qty_collected >= 0),
  comment text not null default '',
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_assembly_parts_name_check check (btrim(name) <> '')
);

create index if not exists order_assembly_parts_order_idx
  on public.order_assembly_parts (order_id, sort_order, created_at);

create table if not exists public.order_assembly_journal_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_assembly_journal_events_order_idx
  on public.order_assembly_journal_events (order_id, created_at desc);

drop trigger if exists order_assembly_journal_events_no_update on public.order_assembly_journal_events;
create trigger order_assembly_journal_events_no_update
  before update or delete on public.order_assembly_journal_events
  for each row execute procedure public.forbid_order_journal_mutation();

create table if not exists public.order_assembly_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('photo', 'pdf', 'url')),
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  url text,
  caption text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_assembly_attachments_payload check (
    (kind = 'url' and url is not null and file_path is null)
    or (kind in ('photo', 'pdf') and file_path is not null)
  )
);

create index if not exists order_assembly_attachments_order_idx
  on public.order_assembly_attachments (order_id, created_at desc);

alter table public.tasks
  add column if not exists context text not null default 'order';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_context_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_context_check check (context in ('order', 'assembly'));
  end if;
end;
$$;

create index if not exists tasks_order_context_idx
  on public.tasks (order_id, context);

-- -----------------------------------------------------------------------------
-- Completeness helper + list view
-- -----------------------------------------------------------------------------

create or replace function public.order_assembly_completeness(target_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(sum(p.qty_required), 0) <= 0 then 0
    else least(
      100,
      round(
        100 * sum(least(p.qty_collected, p.qty_required)) / sum(p.qty_required),
        2
      )
    )
  end
  from public.order_assembly_parts p
  where p.order_id = target_order_id;
$$;

create or replace view public.order_assembly_list_items
with (security_invoker = true) as
select
  o.id,
  o.number,
  o.number_seq,
  o.customer_id,
  o.customer_name,
  o.device_id,
  o.serial_number,
  o.device_group_id,
  o.device_brand_id,
  o.device_model_id,
  o.device_brand,
  o.device_model,
  o.device_label,
  o.status_id,
  o.status_code,
  o.status_name,
  o.is_terminal,
  o.responsible_id,
  o.responsible_name,
  o.deadline,
  o.deadline_state,
  o.created_at,
  o.updated_at,
  coalesce(public.order_assembly_completeness(o.id), 0) as completeness_pct
from public.order_list_items o
where o.status_code in ('repair', 'quality_check');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table public.order_assembly_parts enable row level security;
alter table public.order_assembly_journal_events enable row level security;
alter table public.order_assembly_attachments enable row level security;

drop policy if exists order_assembly_parts_select on public.order_assembly_parts;
create policy order_assembly_parts_select
  on public.order_assembly_parts
  for select
  to authenticated
  using (public.has_permission('orders:read'));

drop policy if exists order_assembly_journal_select on public.order_assembly_journal_events;
create policy order_assembly_journal_select
  on public.order_assembly_journal_events
  for select
  to authenticated
  using (public.has_permission('orders:read'));

drop policy if exists order_assembly_attachments_select on public.order_assembly_attachments;
create policy order_assembly_attachments_select
  on public.order_assembly_attachments
  for select
  to authenticated
  using (public.has_permission('orders:read'));

revoke all on table public.order_assembly_parts from public, anon, authenticated;
revoke all on table public.order_assembly_journal_events from public, anon, authenticated;
revoke all on table public.order_assembly_attachments from public, anon, authenticated;

grant select on table public.order_assembly_parts to authenticated;
grant select on table public.order_assembly_journal_events to authenticated;
grant select on table public.order_assembly_attachments to authenticated;
grant select on table public.order_assembly_list_items to authenticated;

-- -----------------------------------------------------------------------------
-- Storage bucket
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-assembly-attachments',
  'order-assembly-attachments',
  false,
  5368709120,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists order_assembly_attachments_storage_select on storage.objects;
create policy order_assembly_attachments_storage_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'order-assembly-attachments'
    and public.has_permission('orders:read')
  );

drop policy if exists order_assembly_attachments_storage_insert on storage.objects;
create policy order_assembly_attachments_storage_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'order-assembly-attachments'
    and (public.has_permission('orders:create') or public.has_permission('orders:update'))
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 1
  );

drop policy if exists order_assembly_attachments_storage_delete on storage.objects;
create policy order_assembly_attachments_storage_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'order-assembly-attachments'
    and public.has_permission('orders:update')
  );

-- -----------------------------------------------------------------------------
-- Parts CRUD
-- -----------------------------------------------------------------------------

create or replace function public.list_order_assemblies(
  tab_filter text default 'active',
  search_query text default '',
  page_number integer default 1,
  page_size integer default 30
)
returns table (
  id uuid,
  number text,
  number_seq integer,
  customer_id uuid,
  customer_name text,
  device_id uuid,
  serial_number text,
  device_label text,
  device_brand text,
  device_model text,
  status_id uuid,
  status_code text,
  status_name text,
  created_at timestamptz,
  updated_at timestamptz,
  completeness_pct numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tab_value text := coalesce(nullif(btrim(tab_filter), ''), 'active');
  term text;
  safe_page integer;
  safe_size integer;
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  if tab_value not in ('active', 'done') then
    raise exception 'Неизвестная вкладка сборки.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    a.id,
    a.number,
    a.number_seq,
    a.customer_id,
    a.customer_name,
    a.device_id,
    a.serial_number,
    a.device_label,
    a.device_brand,
    a.device_model,
    a.status_id,
    a.status_code,
    a.status_name,
    a.created_at,
    a.updated_at,
    a.completeness_pct,
    count(*) over() as total_count
  from public.order_assembly_list_items a
  where (
      (tab_value = 'active' and a.completeness_pct < 100)
      or (tab_value = 'done' and a.completeness_pct >= 100)
    )
    and (
      btrim(coalesce(search_query, '')) = ''
      or a.number ilike term escape '\'
      or a.customer_name ilike term escape '\'
      or a.serial_number ilike term escape '\'
      or a.device_label ilike term escape '\'
    )
  order by a.number_seq desc, a.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_order_assembly(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  select jsonb_build_object(
    'id', o.id,
    'number', o.number,
    'customer_id', o.customer_id,
    'customer_name', o.customer_name,
    'device_id', o.device_id,
    'serial_number', o.serial_number,
    'device_label', o.device_label,
    'device_brand', o.device_brand,
    'device_model', o.device_model,
    'status_id', o.status_id,
    'status_code', o.status_code,
    'status_name', o.status_name,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'conclusion', coalesce(d.conclusion, ''),
    'completeness_pct', coalesce(public.order_assembly_completeness(o.id), 0),
    'parts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'qty_required', p.qty_required,
          'qty_collected', p.qty_collected,
          'comment', p.comment,
          'sort_order', p.sort_order,
          'created_at', p.created_at,
          'updated_at', p.updated_at
        )
        order by p.sort_order, p.created_at, p.id
      )
      from public.order_assembly_parts p
      where p.order_id = o.id
    ), '[]'::jsonb)
  )
  into payload
  from public.order_list_items o
  left join public.order_diagnostics d on d.order_id = o.id
  where o.id = target_order_id;

  if payload is null then
    raise exception 'Заказ не найден.';
  end if;

  return payload;
end;
$$;

create or replace function public.add_order_assembly_part(
  target_order_id uuid,
  part_name text,
  part_qty_required numeric default 1,
  part_qty_collected numeric default 0,
  part_comment text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text := btrim(coalesce(part_name, ''));
  qty_req numeric := coalesce(part_qty_required, 1);
  qty_col numeric := coalesce(part_qty_collected, 0);
  next_sort integer;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения сборки.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование запасной части.';
  end if;

  if qty_req < 0 or qty_col < 0 then
    raise exception 'Количество не может быть отрицательным.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  select coalesce(max(p.sort_order), -1) + 1
  into next_sort
  from public.order_assembly_parts p
  where p.order_id = target_order_id;

  insert into public.order_assembly_parts (
    order_id, name, qty_required, qty_collected, comment, sort_order, created_by
  )
  values (
    target_order_id,
    clean_name,
    qty_req,
    qty_col,
    btrim(coalesce(part_comment, '')),
    next_sort,
    auth.uid()
  )
  returning id into new_id;

  insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'assembly_part_added',
    auth.uid(),
    'Добавлена позиция: ' || clean_name,
    jsonb_build_object(
      'part_id', new_id,
      'name', clean_name,
      'qty_required', qty_req,
      'qty_collected', qty_col
    )
  );

  return new_id;
end;
$$;

create or replace function public.update_order_assembly_part(
  target_part_id uuid,
  part_name text default null,
  part_qty_required numeric default null,
  part_qty_collected numeric default null,
  part_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_assembly_parts%rowtype;
  next_name text;
  next_req numeric;
  next_col numeric;
  next_comment text;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения сборки.';
  end if;

  select * into current_row
  from public.order_assembly_parts
  where id = target_part_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция сборки не найдена.';
  end if;

  next_name := case
    when part_name is null then current_row.name
    else btrim(part_name)
  end;
  next_req := coalesce(part_qty_required, current_row.qty_required);
  next_col := coalesce(part_qty_collected, current_row.qty_collected);
  next_comment := case
    when part_comment is null then current_row.comment
    else btrim(part_comment)
  end;

  if next_name = '' then
    raise exception 'Укажите наименование запасной части.';
  end if;
  if next_req < 0 or next_col < 0 then
    raise exception 'Количество не может быть отрицательным.';
  end if;

  update public.order_assembly_parts
  set name = next_name,
      qty_required = next_req,
      qty_collected = next_col,
      comment = next_comment,
      updated_at = now()
  where id = target_part_id;

  insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'assembly_part_updated',
    auth.uid(),
    'Обновлена позиция: ' || next_name,
    jsonb_build_object(
      'part_id', target_part_id,
      'name', next_name,
      'qty_required', next_req,
      'qty_collected', next_col
    )
  );
end;
$$;

create or replace function public.remove_order_assembly_part(target_part_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_assembly_parts%rowtype;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения сборки.';
  end if;

  select * into current_row
  from public.order_assembly_parts
  where id = target_part_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция сборки не найдена.';
  end if;

  delete from public.order_assembly_parts where id = target_part_id;

  insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    current_row.order_id,
    'assembly_part_removed',
    auth.uid(),
    'Удалена позиция: ' || current_row.name,
    jsonb_build_object('part_id', current_row.id, 'name', current_row.name)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Journal + attachments
-- -----------------------------------------------------------------------------

create or replace function public.get_order_assembly_journal(target_order_id uuid)
returns table (
  id uuid,
  event_type text,
  summary text,
  actor_id uuid,
  actor_name text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return query
  select
    e.id,
    e.event_type,
    e.summary,
    e.actor_id,
    coalesce(p.full_name, p.email, '')::text as actor_name,
    e.payload,
    e.created_at
  from public.order_assembly_journal_events e
  left join public.profiles p on p.id = e.actor_id
  where e.order_id = target_order_id
  order by e.created_at desc, e.id desc;
end;
$$;

create or replace function public.add_order_assembly_journal_note(
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
    raise exception 'Недостаточно прав для записи в журнал сборки.';
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

  insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'comment',
    auth.uid(),
    body,
    jsonb_build_object('body', body)
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.add_order_assembly_attachment_url(
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

  insert into public.order_assembly_attachments (order_id, kind, url, caption, created_by)
  values (target_order_id, 'url', normalized, note, auth.uid())
  returning id into result_id;

  insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
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

create or replace function public.register_order_assembly_file(
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

  insert into public.order_assembly_attachments (
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

  insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
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

create or replace function public.delete_order_assembly_attachment(target_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_assembly_attachments%rowtype;
  stored_name text;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для удаления файла.';
  end if;

  select * into current_row
  from public.order_assembly_attachments
  where id = target_attachment_id
  for update;

  if current_row.id is null then
    raise exception 'Файл не найден.';
  end if;

  stored_name := coalesce(nullif(btrim(current_row.file_name), ''), nullif(btrim(current_row.caption), ''), 'файл');

  delete from public.order_assembly_attachments
  where id = target_attachment_id;

  insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
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
end;
$$;

-- -----------------------------------------------------------------------------
-- Task journal routing by context
-- -----------------------------------------------------------------------------

create or replace function public.write_task_context_journal(
  target_order_id uuid,
  p_context text,
  p_event_type text,
  p_summary text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx text := coalesce(nullif(btrim(p_context), ''), 'order');
begin
  if target_order_id is null then
    return;
  end if;

  if ctx = 'assembly' then
    insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
    values (target_order_id, p_event_type, auth.uid(), p_summary, coalesce(p_payload, '{}'::jsonb));
  else
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (target_order_id, p_event_type, auth.uid(), p_summary, coalesce(p_payload, '{}'::jsonb));
  end if;
end;
$$;

create or replace function public.task_json(target_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  select jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'body', t.body,
    'assignee_id', t.assignee_id,
    'assignee_name', coalesce(a.full_name, a.email, ''),
    'due_date', t.due_date,
    'priority', t.priority,
    'completed', t.completed,
    'order_id', t.order_id,
    'order_number', coalesce(o.number, ''),
    'customer_name', coalesce(cu.name, ''),
    'context', t.context,
    'created_by', t.created_by,
    'created_by_name', coalesce(c.full_name, c.email, ''),
    'created_at', t.created_at,
    'completed_at', t.completed_at
  )
  into payload
  from public.tasks t
  left join public.profiles a on a.id = t.assignee_id
  left join public.profiles c on c.id = t.created_by
  left join public.orders o on o.id = t.order_id
  left join public.customers cu on cu.id = o.customer_id
  where t.id = target_task_id;

  return payload;
end;
$$;

drop function if exists public.list_tasks(text, text, text, text, text, text, uuid, integer, integer);

create or replace function public.list_tasks(
  search_query text default '',
  assignee_filter text default 'all',
  status_filter text default 'open',
  priority_filter text default 'all',
  due_filter text default 'all',
  linked_filter text default 'all',
  order_id_filter uuid default null,
  page_number integer default 1,
  page_size integer default 30,
  context_filter text default 'all'
)
returns table (
  id uuid,
  title text,
  body text,
  assignee_id uuid,
  assignee_name text,
  due_date timestamptz,
  priority text,
  completed boolean,
  order_id uuid,
  order_number text,
  customer_name text,
  context text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  completed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  assignee_value text;
  status_value text;
  priority_value text;
  due_value text;
  linked_value text;
  context_value text;
  assignee_uuid uuid;
  safe_page integer;
  safe_size integer;
  today_local date := (now() at time zone 'Europe/Moscow')::date;
  manage_others boolean := public.has_tasks_manage_others();
begin
  perform public.assert_tasks_read();

  assignee_value := coalesce(nullif(btrim(assignee_filter), ''), 'all');
  status_value := coalesce(nullif(btrim(status_filter), ''), 'open');
  priority_value := coalesce(nullif(btrim(priority_filter), ''), 'all');
  due_value := coalesce(nullif(btrim(due_filter), ''), 'all');
  linked_value := coalesce(nullif(btrim(linked_filter), ''), 'all');
  context_value := coalesce(nullif(btrim(context_filter), ''), 'all');

  if status_value not in ('open', 'completed', 'all') then
    raise exception 'Неизвестный статус.';
  end if;
  if priority_value not in ('all', 'low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;
  if due_value not in ('all', 'overdue', 'today', 'upcoming', 'none') then
    raise exception 'Неизвестный фильтр срока.';
  end if;
  if linked_value not in ('all', 'with', 'none') then
    raise exception 'Неизвестный фильтр заказа.';
  end if;
  if context_value not in ('all', 'order', 'assembly') then
    raise exception 'Неизвестный контекст задачи.';
  end if;

  if not manage_others and assignee_value = 'unassigned' then
    raise exception 'Недостаточно прав для просмотра общих задач.';
  end if;

  if assignee_value not in ('all', 'unassigned') then
    begin
      assignee_uuid := assignee_value::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Некорректный исполнитель.';
    end;
    if not manage_others and assignee_uuid is distinct from auth.uid() then
      raise exception 'Недостаточно прав для просмотра чужих задач.';
    end if;
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    t.id,
    t.title,
    left(coalesce(t.body, ''), 280) as body,
    t.assignee_id,
    coalesce(a.full_name, a.email, '') as assignee_name,
    t.due_date,
    t.priority,
    t.completed,
    t.order_id,
    coalesce(o.number, '') as order_number,
    coalesce(cu.name, '') as customer_name,
    t.context,
    t.created_by,
    coalesce(c.full_name, c.email, '') as created_by_name,
    t.created_at,
    t.completed_at,
    count(*) over() as total_count
  from public.tasks t
  left join public.profiles a on a.id = t.assignee_id
  left join public.profiles c on c.id = t.created_by
  left join public.orders o on o.id = t.order_id
  left join public.customers cu on cu.id = o.customer_id
  where public.can_view_task(t.assignee_id, t.created_by)
    and (status_value = 'all' or (status_value = 'open' and not t.completed) or (status_value = 'completed' and t.completed))
    and (priority_value = 'all' or t.priority = priority_value)
    and (
      assignee_value = 'all'
      or (assignee_value = 'unassigned' and t.assignee_id is null)
      or t.assignee_id = assignee_uuid
    )
    and (
      due_value = 'all'
      or (due_value = 'overdue' and t.due_date is not null and t.due_date < now())
      or (
        due_value = 'today'
        and t.due_date is not null
        and (t.due_date at time zone 'Europe/Moscow')::date = today_local
      )
      or (
        due_value = 'upcoming'
        and t.due_date is not null
        and (t.due_date at time zone 'Europe/Moscow')::date > today_local
      )
      or (due_value = 'none' and t.due_date is null)
    )
    and (
      order_id_filter is not null
      or linked_value = 'all'
      or (linked_value = 'with' and t.order_id is not null)
      or (linked_value = 'none' and t.order_id is null)
    )
    and (order_id_filter is null or t.order_id = order_id_filter)
    and (context_value = 'all' or t.context = context_value)
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.title ilike term escape '\'
      or t.body ilike term escape '\'
      or o.number ilike term escape '\'
    )
  order by
    t.completed asc,
    case
      when not t.completed and t.assignee_id = auth.uid() then 0
      else 1
    end,
    t.due_date asc nulls last,
    t.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

drop function if exists public.create_task(text, text, uuid, timestamptz, text, uuid);

create or replace function public.create_task(
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date timestamptz default null,
  p_priority text default 'normal',
  p_order_id uuid default null,
  p_context text default 'order'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  title_value text := btrim(coalesce(p_title, ''));
  body_value text := coalesce(p_body, '');
  priority_value text := coalesce(nullif(btrim(p_priority), ''), 'normal');
  context_value text := coalesce(nullif(btrim(p_context), ''), 'order');
  order_number text;
  journal_summary text;
begin
  perform public.assert_tasks_create();

  if title_value = '' then
    raise exception 'Укажите задачу.';
  end if;

  if priority_value not in ('low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;

  if context_value not in ('order', 'assembly') then
    raise exception 'Неизвестный контекст задачи.';
  end if;

  if context_value = 'assembly' and p_order_id is null then
    raise exception 'Для задачи сборки укажите заказ.';
  end if;

  if p_assignee_id is not null and not exists (select 1 from public.profiles where id = p_assignee_id) then
    raise exception 'Сотрудник не найден.';
  end if;

  if p_order_id is not null and not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.tasks (
    title, body, assignee_id, due_date, priority, order_id, context, created_by
  )
  values (
    title_value, body_value, p_assignee_id, p_due_date, priority_value, p_order_id, context_value, auth.uid()
  )
  returning id into result_id;

  if p_order_id is not null then
    select number into order_number from public.orders where id = p_order_id;
    journal_summary := case
      when context_value = 'assembly' then
        'Создана задача по сборке заказа ' || coalesce(order_number, '') || ': «' || left(title_value, 120) || '»'
      else
        'Создана задача «' || left(title_value, 120) || '»'
    end;
    perform public.write_task_context_journal(
      p_order_id,
      context_value,
      'task_created',
      journal_summary,
      jsonb_build_object('task_id', result_id, 'title', title_value, 'context', context_value)
    );
  end if;

  perform public.record_audit(
    'task.created',
    'task',
    result_id::text,
    jsonb_build_object('title', title_value, 'order_id', p_order_id, 'context', context_value)
  );

  if p_assignee_id is not null then
    perform public.emit_domain_event(
      'task_assigned',
      'task',
      result_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'task_id', result_id,
        'task_title', title_value,
        'assignee_id', p_assignee_id,
        'order_id', p_order_id,
        'order_number', order_number,
        'context', context_value,
        'title', 'Назначена задача',
        'body', 'Вам назначена задача «' || left(title_value, 120) || '»'
          || case
            when context_value = 'assembly' and order_number is not null then ' (сборка заказа ' || order_number || ')'
            when order_number is not null then ' (заказ ' || order_number || ')'
            else ''
          end
      )
    );
  end if;

  return result_id;
end;
$$;

create or replace function public.set_task_completed(
  target_task_id uuid,
  p_completed boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tasks%rowtype;
  next_completed boolean := coalesce(p_completed, false);
begin
  perform public.assert_tasks_update();

  select * into current_row
  from public.tasks
  where id = target_task_id
  for update;

  if current_row.id is null then
    raise exception 'Задача не найдена.';
  end if;

  if not public.can_mutate_task(current_row.assignee_id, current_row.created_by) then
    raise exception 'Недостаточно прав для изменения чужой или общей задачи.';
  end if;

  if current_row.completed is not distinct from next_completed then
    return;
  end if;

  if next_completed then
    update public.tasks
    set completed = true,
        completed_at = now()
    where id = target_task_id;

    if current_row.order_id is not null then
      perform public.write_task_context_journal(
        current_row.order_id,
        current_row.context,
        'task_completed',
        'Задача «' || left(current_row.title, 120) || '» выполнена',
        jsonb_build_object('task_id', current_row.id, 'title', current_row.title, 'context', current_row.context)
      );
    end if;
  else
    update public.tasks
    set completed = false,
        completed_at = null
    where id = target_task_id;
  end if;

  perform public.record_audit(
    case when next_completed then 'task.completed' else 'task.reopened' end,
    'task',
    target_task_id::text,
    jsonb_build_object('order_id', current_row.order_id, 'context', current_row.context)
  );
end;
$$;

create or replace function public.delete_task(target_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tasks%rowtype;
begin
  perform public.assert_tasks_delete();

  select * into current_row
  from public.tasks
  where id = target_task_id
  for update;

  if current_row.id is null then
    raise exception 'Задача не найдена.';
  end if;

  if not public.can_mutate_task(current_row.assignee_id, current_row.created_by) then
    raise exception 'Недостаточно прав для удаления чужой или общей задачи.';
  end if;

  delete from public.tasks
  where id = target_task_id;

  if current_row.order_id is not null then
    perform public.write_task_context_journal(
      current_row.order_id,
      current_row.context,
      'task_deleted',
      'Удалена задача «' || left(current_row.title, 120) || '»',
      jsonb_build_object('task_id', current_row.id, 'title', current_row.title, 'context', current_row.context)
    );
  end if;

  perform public.record_audit(
    'task.deleted',
    'task',
    target_task_id::text,
    jsonb_build_object('title', current_row.title, 'order_id', current_row.order_id, 'context', current_row.context)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

revoke all on function public.order_assembly_completeness(uuid) from public, anon;
revoke all on function public.list_order_assemblies(text, text, integer, integer) from public, anon;
revoke all on function public.get_order_assembly(uuid) from public, anon;
revoke all on function public.add_order_assembly_part(uuid, text, numeric, numeric, text) from public, anon;
revoke all on function public.update_order_assembly_part(uuid, text, numeric, numeric, text) from public, anon;
revoke all on function public.remove_order_assembly_part(uuid) from public, anon;
revoke all on function public.get_order_assembly_journal(uuid) from public, anon;
revoke all on function public.add_order_assembly_journal_note(uuid, text) from public, anon;
revoke all on function public.add_order_assembly_attachment_url(uuid, text, text) from public, anon;
revoke all on function public.register_order_assembly_file(uuid, text, text, text, bigint, text) from public, anon;
revoke all on function public.delete_order_assembly_attachment(uuid) from public, anon;
revoke all on function public.write_task_context_journal(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer, text) from public, anon;
revoke all on function public.create_task(text, text, uuid, timestamptz, text, uuid, text) from public, anon;
revoke all on function public.set_task_completed(uuid, boolean) from public, anon;
revoke all on function public.delete_task(uuid) from public, anon;

grant execute on function public.order_assembly_completeness(uuid) to authenticated;
grant execute on function public.list_order_assemblies(text, text, integer, integer) to authenticated;
grant execute on function public.get_order_assembly(uuid) to authenticated;
grant execute on function public.add_order_assembly_part(uuid, text, numeric, numeric, text) to authenticated;
grant execute on function public.update_order_assembly_part(uuid, text, numeric, numeric, text) to authenticated;
grant execute on function public.remove_order_assembly_part(uuid) to authenticated;
grant execute on function public.get_order_assembly_journal(uuid) to authenticated;
grant execute on function public.add_order_assembly_journal_note(uuid, text) to authenticated;
grant execute on function public.add_order_assembly_attachment_url(uuid, text, text) to authenticated;
grant execute on function public.register_order_assembly_file(uuid, text, text, text, bigint, text) to authenticated;
grant execute on function public.delete_order_assembly_attachment(uuid) to authenticated;
grant execute on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer, text) to authenticated;
grant execute on function public.create_task(text, text, uuid, timestamptz, text, uuid, text) to authenticated;
grant execute on function public.set_task_completed(uuid, boolean) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;

notify pgrst, 'reload schema';
