-- Эндотека: роли, права, приглашения, RPC и ужесточение RLS.
-- Фронтенд проверяет права только для UX. Доступ к данным закрывают политики и SECURITY DEFINER-функции.

alter table public.profiles
  add column if not exists email text not null default '';

create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email))
  where email <> '';

alter table public.roles
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists roles_set_updated_at on public.roles;
create trigger roles_set_updated_at
  before update on public.roles
  for each row execute procedure public.set_updated_at();

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null default '',
  role_id uuid not null references public.roles (id) on delete restrict,
  invited_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'failed')),
  auth_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index if not exists invitations_pending_email_idx
  on public.invitations (lower(email))
  where status = 'pending';

create index if not exists invitations_created_at_idx on public.invitations (created_at desc);

delete from public.role_permissions;
delete from public.user_roles;
delete from public.permissions;
delete from public.roles;

insert into public.roles (code, name, description)
values
  ('manager', 'Менеджер', 'Приём заказов, клиенты, приглашение сотрудников'),
  ('diagnostic_engineer', 'Инженер-диагност', 'Диагностика и работы по заказам'),
  ('chief_engineer', 'Главный инженер', 'Контроль ремонта, диагностики и инженеров'),
  ('storekeeper', 'Кладовщик', 'Складские операции'),
  ('director', 'Руководитель', 'Управление доступом, настройками и аудитом');

insert into public.permissions (code, name)
values
  ('dashboard:read', 'Рабочий стол: просмотр'),
  ('notifications:read', 'Уведомления: просмотр'),
  ('orders:read', 'Заказы: просмотр'),
  ('orders:create', 'Заказы: создание'),
  ('orders:update', 'Заказы: изменение'),
  ('orders:delete', 'Заказы: удаление'),
  ('orders:change_status', 'Заказы: смена статуса'),
  ('orders:assign', 'Заказы: назначение'),
  ('customers:read', 'Клиенты: просмотр'),
  ('customers:create', 'Клиенты: создание'),
  ('customers:update', 'Клиенты: изменение'),
  ('customers:delete', 'Клиенты: удаление'),
  ('devices:read', 'Приборы: просмотр'),
  ('devices:create', 'Приборы: создание'),
  ('devices:update', 'Приборы: изменение'),
  ('devices:delete', 'Приборы: удаление'),
  ('tasks:read', 'Задачи: просмотр'),
  ('tasks:create', 'Задачи: создание'),
  ('tasks:update', 'Задачи: изменение'),
  ('tasks:delete', 'Задачи: удаление'),
  ('diagnostics:read', 'Диагностика: просмотр'),
  ('diagnostics:update', 'Диагностика: изменение'),
  ('inventory:read', 'Склад: просмотр'),
  ('inventory:receive', 'Склад: приход'),
  ('inventory:write_off', 'Склад: списание'),
  ('inventory:inventory_count', 'Склад: инвентаризация'),
  ('sales:read', 'Продажи: просмотр'),
  ('sales:create', 'Продажи: создание'),
  ('sales:update', 'Продажи: изменение'),
  ('sales:delete', 'Продажи: удаление'),
  ('documents:read', 'Документы: просмотр'),
  ('documents:create', 'Документы: создание'),
  ('documents:print', 'Документы: печать'),
  ('documents:edit_templates', 'Документы: шаблоны'),
  ('users:read', 'Пользователи: просмотр'),
  ('users:invite', 'Пользователи: приглашение'),
  ('users:update', 'Пользователи: изменение'),
  ('roles:read', 'Роли: просмотр'),
  ('roles:update', 'Роли: изменение'),
  ('settings:read', 'Настройки: просмотр'),
  ('settings:update', 'Настройки: изменение'),
  ('audit:read', 'Журнал: просмотр');

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'director';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard:read', 'notifications:read',
  'orders:read', 'orders:create', 'orders:update', 'orders:change_status', 'orders:assign',
  'customers:read', 'customers:create', 'customers:update',
  'devices:read', 'devices:update',
  'tasks:read', 'tasks:create', 'tasks:update',
  'diagnostics:read',
  'documents:read', 'documents:create', 'documents:print',
  'sales:read', 'sales:create', 'sales:update',
  'users:read', 'users:invite'
)
where r.code = 'manager';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard:read', 'notifications:read',
  'orders:read', 'orders:update', 'orders:change_status',
  'diagnostics:read', 'diagnostics:update',
  'devices:read', 'devices:update',
  'tasks:read', 'tasks:update',
  'documents:read'
)
where r.code = 'diagnostic_engineer';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard:read', 'notifications:read',
  'orders:read', 'orders:create', 'orders:update', 'orders:change_status', 'orders:assign',
  'diagnostics:read', 'diagnostics:update',
  'devices:read', 'devices:create', 'devices:update',
  'tasks:read', 'tasks:create', 'tasks:update', 'tasks:delete',
  'customers:read',
  'inventory:read',
  'documents:read', 'documents:create', 'documents:print',
  'users:read'
)
where r.code = 'chief_engineer';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard:read', 'notifications:read',
  'inventory:read', 'inventory:receive', 'inventory:write_off', 'inventory:inventory_count',
  'orders:read',
  'devices:read',
  'documents:read'
)
where r.code = 'storekeeper';

create unique index if not exists user_roles_one_role_idx on public.user_roles (user_id);

create or replace view public.user_accounts
with (security_invoker = true) as
select
  p.id,
  p.full_name,
  p.email,
  p.is_active,
  p.created_at,
  p.updated_at,
  r.id as role_id,
  r.code as role_code,
  r.name as role_name
from public.profiles p
left join public.user_roles ur on ur.user_id = p.id
left join public.roles r on r.id = ur.role_id;

grant select on public.user_accounts to authenticated;

create or replace function public.record_audit(
  action text,
  entity_type text,
  entity_id text default null,
  metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), action, entity_type, entity_id, coalesce(metadata, '{}'::jsonb));
end;
$$;

create or replace function public.has_role(role_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid()
      and pr.is_active = true
      and r.code = role_code
  );
$$;

create or replace function public.director_count(exclude_user_id uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.profiles p on p.id = ur.user_id
  where r.code = 'director'
    and p.is_active = true
    and (exclude_user_id is null or ur.user_id <> exclude_user_id);
$$;

create or replace function public.can_assign_role(target_role_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_code text;
begin
  if not public.is_active_user() then
    return false;
  end if;

  if not (public.has_permission('users:invite') or public.has_permission('users:update')) then
    return false;
  end if;

  select code into target_code from public.roles where id = target_role_id;
  if target_code is null then
    return false;
  end if;

  if public.has_role('director') then
    return true;
  end if;

  return target_code not in ('director', 'chief_engineer');
end;
$$;

create or replace function public.get_assignable_roles()
returns table (id uuid, code text, name text, description text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.code, r.name, r.description
  from public.roles r
  where public.can_assign_role(r.id)
  order by r.name;
$$;

create or replace function public.assign_user_role(target_user_id uuid, target_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_role_id uuid;
  previous_code text;
  next_code text;
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для изменения роли.';
  end if;

  if not public.can_assign_role(target_role_id) then
    raise exception 'Нельзя назначить эту роль.';
  end if;

  select ur.role_id, r.code
    into previous_role_id, previous_code
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = target_user_id;

  select code into next_code from public.roles where id = target_role_id;
  if next_code is null then
    raise exception 'Роль не найдена.';
  end if;

  if previous_code = 'director'
     and next_code <> 'director'
     and public.director_count(target_user_id) = 0 then
    raise exception 'Нельзя снять роль с последнего руководителя.';
  end if;

  delete from public.user_roles where user_id = target_user_id;
  insert into public.user_roles (user_id, role_id, assigned_by)
  values (target_user_id, target_role_id, auth.uid());

  perform public.record_audit(
    'users.role_changed',
    'user',
    target_user_id::text,
    jsonb_build_object(
      'previous_role_id', previous_role_id,
      'previous_role_code', previous_code,
      'role_id', target_role_id,
      'role_code', next_code
    )
  );
end;
$$;

create or replace function public.set_user_active(target_user_id uuid, next_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_active boolean;
  current_role text;
begin
  if not public.has_permission('users:update') then
    raise exception 'Недостаточно прав для изменения статуса пользователя.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Нельзя изменить статус собственной учётной записи.';
  end if;

  select p.is_active, r.code
    into current_active, current_role
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.id
  left join public.roles r on r.id = ur.role_id
  where p.id = target_user_id;

  if current_active is null then
    raise exception 'Пользователь не найден.';
  end if;

  if current_active = next_active then
    return;
  end if;

  if current_role = 'director' and next_active = false and public.director_count(target_user_id) = 0 then
    raise exception 'Нельзя отключить последнего руководителя.';
  end if;

  update public.profiles
  set is_active = next_active
  where id = target_user_id;

  perform public.record_audit(
    case when next_active then 'users.activated' else 'users.deactivated' end,
    'user',
    target_user_id::text,
    jsonb_build_object('is_active', next_active)
  );
end;
$$;

create or replace function public.set_role_permissions(target_role_id uuid, permission_codes text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_codes text[];
  unknown_code text;
begin
  if not public.has_permission('roles:update') then
    raise exception 'Недостаточно прав для изменения матрицы прав.';
  end if;

  if not exists (select 1 from public.roles where id = target_role_id) then
    raise exception 'Роль не найдена.';
  end if;

  select array_agg(p.code order by p.code)
    into previous_codes
  from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id
  where rp.role_id = target_role_id;

  select c.code
    into unknown_code
  from unnest(coalesce(permission_codes, '{}'::text[])) as c(code)
  left join public.permissions p on p.code = c.code
  where p.id is null
  limit 1;

  if unknown_code is not null then
    raise exception 'Неизвестный код права.';
  end if;

  delete from public.role_permissions where role_id = target_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, p.id
  from public.permissions p
  where p.code = any (coalesce(permission_codes, '{}'::text[]));

  perform public.record_audit(
    'roles.permissions_changed',
    'role',
    target_role_id::text,
    jsonb_build_object(
      'previous_codes', to_jsonb(coalesce(previous_codes, '{}'::text[])),
      'codes', to_jsonb(coalesce(permission_codes, '{}'::text[]))
    )
  );
end;
$$;

create or replace function public.create_invitation(target_email text, target_full_name text, target_role_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  invitation_id uuid;
begin
  if not public.has_permission('users:invite') then
    raise exception 'Недостаточно прав для приглашения сотрудников.';
  end if;

  if not public.can_assign_role(target_role_id) then
    raise exception 'Нельзя назначить эту роль при приглашении.';
  end if;

  normalized_email := lower(btrim(target_email));
  if normalized_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    raise exception 'Укажите корректный email.';
  end if;

  if exists (select 1 from public.profiles where lower(email) = normalized_email) then
    raise exception 'Пользователь с таким email уже существует.';
  end if;

  if exists (select 1 from public.invitations where lower(email) = normalized_email and status = 'pending') then
    raise exception 'Приглашение для этого email уже отправлено.';
  end if;

  insert into public.invitations (email, full_name, role_id, invited_by)
  values (normalized_email, btrim(coalesce(target_full_name, '')), target_role_id, auth.uid())
  returning id into invitation_id;

  perform public.record_audit(
    'users.invited',
    'invitation',
    invitation_id::text,
    jsonb_build_object(
      'email', normalized_email,
      'role_id', target_role_id
    )
  );

  return invitation_id;
end;
$$;

create or replace function public.fail_invitation(target_invitation_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('users:invite') then
    raise exception 'Недостаточно прав.';
  end if;

  update public.invitations
  set status = 'failed'
  where id = target_invitation_id
    and invited_by = auth.uid()
    and status = 'pending';

  perform public.record_audit(
    'users.invite_failed',
    'invitation',
    target_invitation_id::text,
    jsonb_build_object('reason', reason)
  );
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.invitations%rowtype;
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when profiles.full_name = '' then excluded.full_name
          else profiles.full_name
        end;

  select *
    into invitation
  from public.invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
  order by created_at desc
  limit 1;

  if invitation.id is not null then
    insert into public.user_roles (user_id, role_id, assigned_by)
    values (new.id, invitation.role_id, invitation.invited_by)
    on conflict (user_id) do nothing;

    update public.invitations
    set status = 'accepted',
        accepted_at = now(),
        auth_user_id = new.id
    where id = invitation.id;

    insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
    values (
      invitation.invited_by,
      'users.invite_accepted',
      'invitation',
      invitation.id::text,
      jsonb_build_object('user_id', new.id, 'email', new.email)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id then
    new.is_active := old.is_active;
    new.email := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute procedure public.protect_profile_fields();

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_own_or_users_read on public.profiles;
create policy profiles_select_own_or_users_read
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.has_permission('users:read'));

drop policy if exists profiles_update_users_write on public.profiles;

drop policy if exists role_permissions_select_authenticated on public.role_permissions;
drop policy if exists role_permissions_select_roles_read on public.role_permissions;
create policy role_permissions_select_roles_read
  on public.role_permissions
  for select
  to authenticated
  using (public.has_permission('roles:read') or public.has_permission('users:read'));

drop policy if exists permissions_select_authenticated on public.permissions;
drop policy if exists permissions_select_roles_read on public.permissions;
create policy permissions_select_roles_read
  on public.permissions
  for select
  to authenticated
  using (
    public.is_active_user()
    and (public.has_permission('roles:read') or public.has_permission('users:invite'))
  );

drop policy if exists user_roles_select_own_or_users_read on public.user_roles;
create policy user_roles_select_own_or_users_read
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid() or public.has_permission('users:read'));

drop policy if exists user_roles_write_users_write on public.user_roles;

alter table public.invitations enable row level security;

drop policy if exists invitations_select_users_read on public.invitations;
create policy invitations_select_users_read
  on public.invitations
  for select
  to authenticated
  using (public.has_permission('users:read') or public.has_permission('users:invite'));

drop policy if exists audit_events_select_own_or_audit_read on public.audit_events;
create policy audit_events_select_own_or_audit_read
  on public.audit_events
  for select
  to authenticated
  using (actor_id = auth.uid() or public.has_permission('audit:read'));

revoke all on function public.record_audit(text, text, text, jsonb) from public;
revoke all on function public.has_role(text) from public;
revoke all on function public.director_count(uuid) from public;
revoke all on function public.can_assign_role(uuid) from public;
revoke all on function public.get_assignable_roles() from public;
revoke all on function public.assign_user_role(uuid, uuid) from public;
revoke all on function public.set_user_active(uuid, boolean) from public;
revoke all on function public.set_role_permissions(uuid, text[]) from public;
revoke all on function public.create_invitation(text, text, uuid) from public;
revoke all on function public.fail_invitation(uuid, text) from public;

grant execute on function public.has_role(text) to authenticated;
grant execute on function public.can_assign_role(uuid) to authenticated;
grant execute on function public.get_assignable_roles() to authenticated;
grant execute on function public.assign_user_role(uuid, uuid) to authenticated;
grant execute on function public.set_user_active(uuid, boolean) to authenticated;
grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.create_invitation(text, text, uuid) to authenticated;
grant execute on function public.fail_invitation(uuid, text) to authenticated;

-- После создания первого пользователя:
-- insert into public.user_roles (user_id, role_id)
-- select '<user-uuid>', id from public.roles where code = 'director';
