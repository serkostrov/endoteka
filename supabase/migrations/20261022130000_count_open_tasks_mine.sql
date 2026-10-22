-- Бейдж «Задачи» в навигации: только открытые задачи, назначенные текущему пользователю.

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
  select count(*) into result
  from public.tasks t
  where t.completed = false
    and t.assignee_id = auth.uid();
  return coalesce(result, 0);
end;
$$;
