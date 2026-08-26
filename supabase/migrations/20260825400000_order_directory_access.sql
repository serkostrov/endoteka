-- Сотрудники нужны в заказах (ответственный, журнал, фильтры).
-- Имена коллег доступны тем, кто работает с заказами или задачами.

drop policy if exists profiles_select_own_or_users_read on public.profiles;
create policy profiles_select_directory
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.has_permission('users:read')
    or public.has_permission('orders:read')
    or public.has_permission('orders:create')
    or public.has_permission('orders:assign')
    or public.has_permission('tasks:read')
  );

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

revoke all on function public.list_active_employees() from public;
grant execute on function public.list_active_employees() to authenticated;
