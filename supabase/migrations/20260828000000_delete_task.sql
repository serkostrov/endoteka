-- Удаление задачи. Если задача связана с заказом, в журнал заказа пишется событие.

create or replace function public.assert_tasks_delete()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('tasks:delete') then
    raise exception 'Недостаточно прав для удаления задачи.';
  end if;
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

  delete from public.tasks
  where id = target_task_id;

  if current_row.order_id is not null then
    perform public.write_task_order_journal(
      current_row.order_id,
      'task_deleted',
      'Удалена задача «' || left(current_row.title, 120) || '»',
      jsonb_build_object('task_id', current_row.id, 'title', current_row.title)
    );
  end if;

  perform public.record_audit(
    'task.deleted',
    'task',
    target_task_id::text,
    jsonb_build_object('title', current_row.title, 'order_id', current_row.order_id)
  );
end;
$$;

revoke all on function public.assert_tasks_delete() from public;
revoke all on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated;
