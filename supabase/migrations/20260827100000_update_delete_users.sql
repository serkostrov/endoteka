-- Редактирование учётной записи (кроме email) и подготовка к удалению через Edge Function.

alter table public.invitations
  alter column invited_by drop not null;

alter table public.invitations
  drop constraint if exists invitations_invited_by_fkey;

alter table public.invitations
  add constraint invitations_invited_by_fkey
    foreign key (invited_by) references public.profiles (id) on delete set null;

alter table public.user_roles
  drop constraint if exists user_roles_assigned_by_fkey;

alter table public.user_roles
  add constraint user_roles_assigned_by_fkey
    foreign key (assigned_by) references public.profiles (id) on delete set null;

create or replace function public.update_user_account(
  target_user_id uuid,
  next_full_name text,
  target_role_id uuid,
  next_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_name text;
  current_active boolean;
  previous_role_id uuid;
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для изменения пользователя.';
  end if;

  select p.full_name, p.is_active
    into current_name, current_active
  from public.profiles p
  where p.id = target_user_id;

  if not found then
    raise exception 'Пользователь не найден.';
  end if;

  next_full_name := btrim(coalesce(next_full_name, ''));
  if next_full_name = '' then
    raise exception 'Укажите имя.';
  end if;

  if next_full_name <> current_name then
    update public.profiles
    set full_name = next_full_name
    where id = target_user_id;

    perform public.record_audit(
      'users.updated',
      'user',
      target_user_id::text,
      jsonb_build_object('full_name', next_full_name)
    );
  end if;

  select ur.role_id
    into previous_role_id
  from public.user_roles ur
  where ur.user_id = target_user_id;

  if previous_role_id is distinct from target_role_id then
    perform public.assign_user_role(target_user_id, target_role_id);
  end if;

  if target_user_id = auth.uid() then
    if next_active is distinct from current_active then
      raise exception 'Нельзя изменить статус собственной учётной записи.';
    end if;
  else
    perform public.set_user_active(target_user_id, next_active);
  end if;
end;
$$;

create or replace function public.prepare_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_name text;
  current_email text;
  current_active boolean;
  current_role text;
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для удаления пользователя.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Нельзя удалить собственную учётную запись.';
  end if;

  select p.full_name, p.email, p.is_active, r.code
    into current_name, current_email, current_active, current_role
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.id
  left join public.roles r on r.id = ur.role_id
  where p.id = target_user_id;

  if not found then
    raise exception 'Пользователь не найден.';
  end if;

  if current_role = 'director' and public.director_count(target_user_id) = 0 then
    raise exception 'Нельзя удалить последнего руководителя.';
  end if;

  perform public.record_audit(
    'users.deleted',
    'user',
    target_user_id::text,
    jsonb_build_object(
      'email', current_email,
      'full_name', current_name,
      'role_code', current_role,
      'is_active', current_active
    )
  );
end;
$$;

revoke all on function public.update_user_account(uuid, text, uuid, boolean) from public;
revoke all on function public.prepare_delete_user(uuid) from public;

grant execute on function public.update_user_account(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.prepare_delete_user(uuid) to authenticated;
