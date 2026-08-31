-- Срок задачи: дата и время (timestamptz), а не только день.

alter table public.tasks
  alter column due_date type timestamptz
  using case
    when due_date is null then null
    else (due_date::timestamp without time zone) at time zone 'Europe/Moscow'
  end;

drop function if exists public.create_task(text, text, uuid, date, text, uuid);
drop function if exists public.update_task(uuid, text, text, uuid, date, text);
drop function if exists public.list_tasks(text, text, text, text, text, text, uuid, integer, integer);

create function public.create_task(
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date timestamptz default null,
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
  order_number text;
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

  if p_assignee_id is not null then
    select number into order_number from public.orders where id = p_order_id;
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
        'title', 'Назначена задача',
        'body', 'Вам назначена задача «' || left(title_value, 120) || '»'
          || case when order_number is not null then ' (заказ ' || order_number || ')' else '' end
      )
    );
  end if;

  return result_id;
end;
$$;

create function public.update_task(
  target_task_id uuid,
  p_title text,
  p_body text default '',
  p_assignee_id uuid default null,
  p_due_date timestamptz default null,
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
  order_number text;
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
  where id = target_task_id;

  perform public.record_audit(
    'task.updated',
    'task',
    target_task_id::text,
    jsonb_build_object('title', title_value)
  );

  if p_assignee_id is not null and p_assignee_id is distinct from current_row.assignee_id then
    select number into order_number from public.orders where id = current_row.order_id;
    perform public.emit_domain_event(
      'task_assigned',
      'task',
      target_task_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'task_id', target_task_id,
        'task_title', title_value,
        'assignee_id', p_assignee_id,
        'order_id', current_row.order_id,
        'order_number', order_number,
        'title', 'Назначена задача',
        'body', 'Вам назначена задача «' || left(title_value, 120) || '»'
          || case when order_number is not null then ' (заказ ' || order_number || ')' else '' end
      )
    );
  end if;
end;
$$;

create function public.list_tasks(
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
  body text,
  assignee_id uuid,
  assignee_name text,
  due_date timestamptz,
  priority text,
  completed boolean,
  order_id uuid,
  order_number text,
  customer_name text,
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
  today_local date := (now() at time zone 'Europe/Moscow')::date;
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
    left(coalesce(t.body, ''), 280) as body,
    t.assignee_id,
    coalesce(a.full_name, a.email, '') as assignee_name,
    t.due_date,
    t.priority,
    t.completed,
    t.order_id,
    coalesce(o.number, '') as order_number,
    coalesce(cu.name, '') as customer_name,
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
  where (status_value = 'all' or (status_value = 'open' and not t.completed) or (status_value = 'completed' and t.completed))
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
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.title ilike term escape '\'
      or t.body ilike term escape '\'
      or o.number ilike term escape '\'
    )
  order by t.completed asc, t.due_date asc nulls last, t.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

revoke all on function public.create_task(text, text, uuid, timestamptz, text, uuid) from public, anon;
revoke all on function public.update_task(uuid, text, text, uuid, timestamptz, text) from public, anon;
revoke all on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) from public, anon;

grant execute on function public.create_task(text, text, uuid, timestamptz, text, uuid) to authenticated;
grant execute on function public.update_task(uuid, text, text, uuid, timestamptz, text) to authenticated;
grant execute on function public.list_tasks(text, text, text, text, text, text, uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
