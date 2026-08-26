-- Смена пароля сотрудника: аудит без сохранения самого пароля.

create or replace function public.record_user_password_changed(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для изменения пароля.';
  end if;

  if not exists (select 1 from public.profiles where id = target_user_id) then
    raise exception 'Пользователь не найден.';
  end if;

  perform public.record_audit(
    'users.password_changed',
    'user',
    target_user_id::text,
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.record_user_password_changed(uuid) from public;
grant execute on function public.record_user_password_changed(uuid) to authenticated;
