-- Эндотека: задачи. Создание со страницы задач и из заказа.
-- Создание и выполнение задач с заказом пишут журнал заказа.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  assignee_id uuid references public.profiles (id) on delete set null,
  due_date date,
  priority text not null default 'normal',
  completed boolean not null default false,
  order_id uuid references public.orders (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tasks_title_present check (btrim(title) <> ''),
  constraint tasks_priority_check check (priority in ('low', 'normal', 'high')),
  constraint tasks_completed_at_check check (
    (completed and completed_at is not null)
    or (not completed and completed_at is null)
  )
);

create index if not exists tasks_open_due_idx
  on public.tasks (completed, due_date);

create index if not exists tasks_assignee_open_idx
  on public.tasks (assignee_id, completed);

create index if not exists tasks_order_idx
  on public.tasks (order_id, created_at desc);

create index if not exists tasks_created_at_idx
  on public.tasks (created_at desc);

create or replace function public.list_active_employees()
returns table (id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('users:read')
    or public.has_permission('orders:read')
    or public.has_permission('orders:create')
    or public.has_permission('orders:assign')
    or public.has_permission('tasks:read')
    or public.has_permission('tasks:create')
    or public.has_permission('tasks:update')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  return query
  select p.id, p.full_name, p.email
  from public.profiles p
  where p.is_active = true
  order by p.full_name, p.email;
end;
$$;

create or replace function public.assert_tasks_read()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('tasks:read') then
    raise exception 'Недостаточно прав для задач.';
  end if;
end;
$$;

create or replace function public.assert_tasks_create()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('tasks:create') then
    raise exception 'Недостаточно прав для создания задачи.';
  end if;
end;
$$;

create or replace function public.assert_tasks_update()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('tasks:update') then
    raise exception 'Недостаточно прав для изменения задачи.';
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
  where t.id = target_task_id;

  return payload;
end;
$$;

create or replace function public.write_task_order_journal(
  target_order_id uuid,
  p_event_type text,
  p_summary text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_order_id is null then
    return;
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (target_order_id, p_event_type, auth.uid(), p_summary, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.list_tasks(
  search_query text default '',
  assignee_filter text default 'all',
  status_filter text default 'open',
  priority_filter text default 'all',
  due_filter text default 'all',
  linked_filter text default 'all',
  order_id_filter uuid default null,
  page_number integer default 1,
  page_size integer default 30
)
returns table (
  id uuid,
  title text,
  assignee_id uuid,
  assignee_name text,
  due_date date,
  priority text,
  completed boolean,
  order_id uuid,
  order_number text,
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
  assignee_uuid uuid;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_tasks_read();

  assignee_value := coalesce(nullif(btrim(assignee_filter), ''), 'all');
  status_value := coalesce(nullif(btrim(status_filter), ''), 'open');
  priority_value := coalesce(nullif(btrim(priority_filter), ''), 'all');
  due_value := coalesce(nullif(btrim(due_filter), ''), 'all');
  linked_value := coalesce(nullif(btrim(linked_filter), ''), 'all');

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

  if assignee_value not in ('all', 'unassigned') then
    begin
      assignee_uuid := assignee_value::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Некорректный исполнитель.';
    end;
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    t.id,
    t.title,
    t.assignee_id,
    coalesce(a.full_name, a.email, '') as assignee_name,
    t.due_date,
    t.priority,
    t.completed,
    t.order_id,
    coalesce(o.number, '') as order_number,
    t.created_by,
    coalesce(c.full_name, c.email, '') as created_by_name,
    t.created_at,
    t.completed_at,
    count(*) over() as total_count
  from public.tasks t
  left join public.profiles a on a.id = t.assignee_id
  left join public.profiles c on c.id = t.created_by
  left join public.orders o on o.id = t.order_id
  where (status_value = 'all' or (status_value = 'open' and not t.completed) or (status_value = 'completed' and t.completed))
    and (priority_value = 'all' or t.priority = priority_value)
    and (
      assignee_value = 'all'
      or (assignee_value = 'unassigned' and t.assignee_id is null)
      or t.assignee_id = assignee_uuid
    )
    and (
      due_value = 'all'
      or (due_value = 'overdue' and t.due_date is not null and t.due_date < current_date)
      or (due_value = 'today' and t.due_date = current_date)
      or (due_value = 'upcoming' and t.due_date is not null and t.due_date > current_date)
      or (due_value = 'none' and t.due_date is null)
    )
    and (
      order_id_filter is not null
      or linked_value = 'all'
      or (linked_value = 'with' and t.order_id is not null)
      or (linked_value = 'none' and t.order_id is null)
    )
    and (order_id_filter is null or t.order_id = order_id_filter)
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.title ilike term escape '\'
      or t.body ilike term escape '\'
      or o.number ilike term escape '\'
    )
  order by t.completed asc, t.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_task(target_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_tasks_read();
  payload := public.task_json(target_task_id);
  if payload is null then
    raise exception 'Задача не найдена.';
  end if;
  return payload;
end;
$$;

create or replace function public.count_open_tasks()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result bigint;
begin
  perform public.assert_tasks_read();
  select count(*) into result from public.tasks where completed = false;
  return coalesce(result, 0);
end;
$$;

create or replace function public.create_task(
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority text default 'normal',
  p_order_id uuid default null
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
begin
  perform public.assert_tasks_create();

  if title_value = '' then
    raise exception 'Укажите задачу.';
  end if;

  if priority_value not in ('low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;

  if p_assignee_id is not null and not exists (select 1 from public.profiles where id = p_assignee_id) then
    raise exception 'Сотрудник не найден.';
  end if;

  if p_order_id is not null and not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.tasks (
    title, body, assignee_id, due_date, priority, order_id, created_by
  )
  values (
    title_value, body_value, p_assignee_id, p_due_date, priority_value, p_order_id, auth.uid()
  )
  returning id into result_id;

  if p_order_id is not null then
    perform public.write_task_order_journal(
      p_order_id,
      'task_created',
      'Создана задача «' || left(title_value, 120) || '»',
      jsonb_build_object('task_id', result_id, 'title', title_value)
    );
  end if;

  perform public.record_audit(
    'task.created',
    'task',
    result_id::text,
    jsonb_build_object('title', title_value, 'order_id', p_order_id)
  );

  return result_id;
end;
$$;

create or replace function public.update_task(
  target_task_id uuid,
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_priority text default 'normal'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.tasks%rowtype;
  title_value text := btrim(coalesce(p_title, ''));
  body_value text := coalesce(p_body, '');
  priority_value text := coalesce(nullif(btrim(p_priority), ''), 'normal');
  updated_id uuid;
begin
  perform public.assert_tasks_update();

  select * into current_row
  from public.tasks
  where id = target_task_id
  for update;

  if current_row.id is null then
    raise exception 'Задача не найдена.';
  end if;

  if title_value = '' then
    raise exception 'Укажите задачу.';
  end if;

  if priority_value not in ('low', 'normal', 'high') then
    raise exception 'Неизвестный приоритет.';
  end if;

  if p_assignee_id is not null and not exists (select 1 from public.profiles where id = p_assignee_id) then
    raise exception 'Сотрудник не найден.';
  end if;

  update public.tasks
  set title = title_value,
      body = body_value,
      assignee_id = p_assignee_id,
      due_date = p_due_date,
      priority = priority_value
  where id = target_task_id
  returning id into updated_id;

  perform public.record_audit(
    'task.updated',
    'task',
    target_task_id::text,
    jsonb_build_object('title', title_value)
  );
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

  if current_row.completed is not distinct from next_completed then
    return;
  end if;

  if next_completed then
    update public.tasks
    set completed = true,
        completed_at = now()
    where id = target_task_id;

    if current_row.order_id is not null then
      perform public.write_task_order_journal(
        current_row.order_id,
        'task_completed',
        'Задача «' || left(current_row.title, 120) || '» выполнена',
        jsonb_build_object('task_id', current_row.id, 'title', current_row.title)
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
    jsonb_build_object('order_id', current_row.order_id)
  );
end;
$$;

alter table public.tasks enable row level security;

drop policy if exists tasks_select on public.tasks;
create policy tasks_select
  on public.tasks
  for select
  to authenticated
  using (public.has_permission('tasks:read'));

grant select on public.tasks to authenticated;

revoke all on function public.assert_tasks_read() from public;
revoke all on function public.assert_tasks_create() from public;
revoke all on function public.assert_tasks_update() from public;
revoke all on function public.task_json(uuid) from public;
revoke all on function public.write_task_order_journal(uuid, text, text, jsonb) from public;
revoke all on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) from public;
revoke all on function public.get_task(uuid) from public;
revoke all on function public.count_open_tasks() from public;
revoke all on function public.create_task(text, text, uuid, date, text, uuid) from public;
revoke all on function public.update_task(uuid, text, text, uuid, date, text) from public;
revoke all on function public.set_task_completed(uuid, boolean) from public;

grant execute on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) to authenticated;
grant execute on function public.get_task(uuid) to authenticated;
grant execute on function public.count_open_tasks() to authenticated;
grant execute on function public.create_task(text, text, uuid, date, text, uuid) to authenticated;
grant execute on function public.update_task(uuid, text, text, uuid, date, text) to authenticated;
grant execute on function public.set_task_completed(uuid, boolean) to authenticated;
