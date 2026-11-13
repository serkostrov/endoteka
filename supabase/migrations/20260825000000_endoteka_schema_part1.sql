-- =============================================================================
-- Эндотека: schema squash — часть 1/3
-- Секции исходных миграций: [1/151] … [18/151]
-- Файлы: 20260825000000_foundation.sql … 20260826700000_security_hardening.sql
-- Размер части: ~419 KiB
--
-- Применять строго по порядку: part1 → part2 → part3
-- на чистой БД (SQL Editor / psql -v ON_ERROR_STOP=1).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- [1/18 | was 1/151] 20260825000000_foundation.sql
-- -----------------------------------------------------------------------------

-- Эндотека: фундамент безопасности, профилей, ролей и аудита.
-- Применять через Supabase CLI или SQL Editor от привилегированной роли.
-- Фронтенд не является границей авторизации: доступ к данным закрывает RLS.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id),
  primary key (user_id, role_id)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_actor_id_idx on public.audit_events (actor_id);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_active = true
  );
$$;

create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    join public.profiles pr on pr.id = ur.user_id
    where ur.user_id = auth.uid()
      and pr.is_active = true
      and p.code = permission_code
  );
$$;

create or replace function public.get_my_roles()
returns table (code text)
language sql
stable
security definer
set search_path = public
as $$
  select r.code
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid();
$$;

create or replace function public.get_my_permissions()
returns table (code text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.code
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where ur.user_id = auth.uid();
$$;

revoke all on function public.is_active_user() from public;
revoke all on function public.has_permission(text) from public;
revoke all on function public.get_my_roles() from public;
revoke all on function public.get_my_permissions() from public;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.get_my_roles() to authenticated;
grant execute on function public.get_my_permissions() to authenticated;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid());

drop policy if exists profiles_update_users_write on public.profiles;
create policy profiles_update_users_write
  on public.profiles
  for update
  to authenticated
  using (public.has_permission('users.write'))
  with check (public.has_permission('users.write'));

drop policy if exists roles_select_authenticated on public.roles;
create policy roles_select_authenticated
  on public.roles
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists permissions_select_authenticated on public.permissions;
create policy permissions_select_authenticated
  on public.permissions
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists role_permissions_select_authenticated on public.role_permissions;
create policy role_permissions_select_authenticated
  on public.role_permissions
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists user_roles_select_own_or_users_read on public.user_roles;
create policy user_roles_select_own_or_users_read
  on public.user_roles
  for select
  to authenticated
  using (user_id = auth.uid() or public.has_permission('users.read'));

drop policy if exists user_roles_write_users_write on public.user_roles;
create policy user_roles_write_users_write
  on public.user_roles
  for all
  to authenticated
  using (public.has_permission('users.write'))
  with check (public.has_permission('users.write'));

drop policy if exists audit_events_insert_own on public.audit_events;
create policy audit_events_insert_own
  on public.audit_events
  for insert
  to authenticated
  with check (actor_id = auth.uid() and public.is_active_user());

drop policy if exists audit_events_select_own_or_audit_read on public.audit_events;
create policy audit_events_select_own_or_audit_read
  on public.audit_events
  for select
  to authenticated
  using (actor_id = auth.uid() or public.has_permission('audit.read'));

insert into public.roles (code, name, description)
values
  ('admin', 'Администратор', 'Полный доступ к системе'),
  ('manager', 'Руководитель', 'Операционное управление сервисным центром'),
  ('technician', 'Инженер', 'Диагностика и ремонт'),
  ('warehouse', 'Склад', 'Учёт запчастей и остатков'),
  ('reception', 'Приёмка', 'Клиенты, приём и выдача аппаратов'),
  ('accountant', 'Бухгалтерия', 'Продажи, счета и документы')
on conflict (code) do nothing;

insert into public.permissions (code, name)
values
  ('dashboard.read', 'Просмотр обзора'),
  ('orders.read', 'Просмотр заказов'),
  ('orders.write', 'Изменение заказов'),
  ('diagnostics.read', 'Просмотр диагностики'),
  ('diagnostics.write', 'Изменение диагностики'),
  ('devices.read', 'Просмотр аппаратов'),
  ('devices.write', 'Изменение аппаратов'),
  ('customers.read', 'Просмотр клиентов'),
  ('customers.write', 'Изменение клиентов'),
  ('inventory.read', 'Просмотр склада'),
  ('inventory.write', 'Изменение склада'),
  ('sales.read', 'Просмотр продаж'),
  ('sales.write', 'Изменение продаж'),
  ('documents.read', 'Просмотр документов'),
  ('documents.write', 'Изменение документов'),
  ('tasks.read', 'Просмотр задач'),
  ('tasks.write', 'Изменение задач'),
  ('notifications.read', 'Просмотр уведомлений'),
  ('users.read', 'Просмотр пользователей'),
  ('users.write', 'Изменение пользователей'),
  ('settings.read', 'Просмотр настроек'),
  ('settings.write', 'Изменение настроек'),
  ('audit.read', 'Просмотр аудита')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'admin'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard.read',
  'orders.read', 'orders.write',
  'diagnostics.read', 'diagnostics.write',
  'devices.read', 'devices.write',
  'customers.read', 'customers.write',
  'inventory.read',
  'sales.read',
  'documents.read', 'documents.write',
  'tasks.read', 'tasks.write',
  'notifications.read',
  'users.read',
  'settings.read',
  'audit.read'
)
where r.code = 'manager'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard.read',
  'orders.read', 'orders.write',
  'diagnostics.read', 'diagnostics.write',
  'devices.read',
  'documents.read',
  'tasks.read', 'tasks.write',
  'notifications.read'
)
where r.code = 'technician'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard.read',
  'orders.read',
  'devices.read',
  'inventory.read', 'inventory.write',
  'notifications.read'
)
where r.code = 'warehouse'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard.read',
  'orders.read', 'orders.write',
  'devices.read',
  'customers.read', 'customers.write',
  'documents.read',
  'tasks.read',
  'notifications.read'
)
where r.code = 'reception'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in (
  'dashboard.read',
  'orders.read',
  'customers.read',
  'sales.read', 'sales.write',
  'documents.read', 'documents.write',
  'notifications.read'
)
where r.code = 'accountant'
on conflict do nothing;

-- После создания первого пользователя назначьте роль руководителя:
-- insert into public.user_roles (user_id, role_id)
-- select '<user-uuid>', id from public.roles where code = 'director';

-- -----------------------------------------------------------------------------
-- [2/18 | was 2/151] 20260825120000_users_roles_permissions.sql
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- [3/18 | was 3/151] 20260825200000_reference_data_and_dynamic_fields.sql
-- -----------------------------------------------------------------------------

-- Эндотека: настраиваемые справочники и динамические поля.
-- Определения полей нормализованы. Значения записей хранятся в jsonb и проверяются на сервере.

create table if not exists public.reference_sets (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  parent_set_id uuid references public.reference_sets (id) on delete restrict,
  is_system boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_sets_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint reference_sets_code_unique unique (code)
);

drop trigger if exists reference_sets_set_updated_at on public.reference_sets;
create trigger reference_sets_set_updated_at
  before update on public.reference_sets
  for each row execute procedure public.set_updated_at();

create table if not exists public.reference_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.reference_sets (id) on delete restrict,
  parent_id uuid references public.reference_items (id) on delete restrict,
  code text not null,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_items_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint reference_items_set_code_unique unique (set_id, code)
);

create index if not exists reference_items_set_sort_idx
  on public.reference_items (set_id, sort_order, name);

create index if not exists reference_items_parent_idx
  on public.reference_items (parent_id);

drop trigger if exists reference_items_set_updated_at on public.reference_items;
create trigger reference_items_set_updated_at
  before update on public.reference_items
  for each row execute procedure public.set_updated_at();

create table if not exists public.field_entities (
  code text primary key,
  name text not null,
  description text,
  sort_order integer not null default 0,
  constraint field_entities_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$')
);

create table if not exists public.dynamic_field_types (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  constraint dynamic_field_types_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$')
);

create table if not exists public.dynamic_fields (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null references public.field_entities (code) on delete restrict,
  code text not null,
  name text not null,
  field_type text not null references public.dynamic_field_types (code) on delete restrict,
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_fields_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint dynamic_fields_entity_code_unique unique (entity_code, code)
);

create index if not exists dynamic_fields_entity_sort_idx
  on public.dynamic_fields (entity_code, sort_order, name);

drop trigger if exists dynamic_fields_set_updated_at on public.dynamic_fields;
create trigger dynamic_fields_set_updated_at
  before update on public.dynamic_fields
  for each row execute procedure public.set_updated_at();

create table if not exists public.dynamic_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.dynamic_fields (id) on delete cascade,
  code text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_field_options_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint dynamic_field_options_field_code_unique unique (field_id, code)
);

create index if not exists dynamic_field_options_field_sort_idx
  on public.dynamic_field_options (field_id, sort_order, label);

drop trigger if exists dynamic_field_options_set_updated_at on public.dynamic_field_options;
create trigger dynamic_field_options_set_updated_at
  before update on public.dynamic_field_options
  for each row execute procedure public.set_updated_at();

create table if not exists public.dynamic_field_values (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.dynamic_fields (id) on delete restrict,
  entity_code text not null references public.field_entities (code) on delete restrict,
  record_id uuid not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_field_values_field_record_unique unique (field_id, record_id)
);

create index if not exists dynamic_field_values_record_idx
  on public.dynamic_field_values (entity_code, record_id);

drop trigger if exists dynamic_field_values_set_updated_at on public.dynamic_field_values;
create trigger dynamic_field_values_set_updated_at
  before update on public.dynamic_field_values
  for each row execute procedure public.set_updated_at();

create or replace view public.reference_set_summaries
with (security_invoker = true) as
select
  s.id,
  s.code,
  s.name,
  s.description,
  s.parent_set_id,
  ps.code as parent_set_code,
  ps.name as parent_set_name,
  s.is_system,
  s.sort_order,
  s.created_at,
  s.updated_at,
  count(i.id)::integer as item_count,
  count(i.id) filter (where i.is_active)::integer as active_item_count
from public.reference_sets s
left join public.reference_sets ps on ps.id = s.parent_set_id
left join public.reference_items i on i.set_id = s.id
group by s.id, ps.code, ps.name;

create or replace view public.field_entity_summaries
with (security_invoker = true) as
select
  e.code,
  e.name,
  e.description,
  e.sort_order,
  count(f.id)::integer as field_count,
  count(f.id) filter (where f.is_active)::integer as active_field_count
from public.field_entities e
left join public.dynamic_fields f on f.entity_code = e.code
group by e.code;

create or replace function public.assert_settings_write()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения настроек.';
  end if;
end;
$$;

create or replace function public.assert_reference_item_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_parent_set uuid;
  actual_parent_set uuid;
begin
  select parent_set_id into expected_parent_set
  from public.reference_sets
  where id = new.set_id;

  if expected_parent_set is null then
    if new.parent_id is not null then
      raise exception 'У этого справочника нет родительского справочника.';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    raise exception 'Выберите значение родительского справочника.';
  end if;

  select set_id into actual_parent_set
  from public.reference_items
  where id = new.parent_id;

  if actual_parent_set is null or actual_parent_set <> expected_parent_set then
    raise exception 'Родитель должен быть из связанного справочника.';
  end if;

  return new;
end;
$$;

drop trigger if exists reference_items_parent_check on public.reference_items;
create trigger reference_items_parent_check
  before insert or update on public.reference_items
  for each row execute procedure public.assert_reference_item_parent();

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.reference_items
  where parent_id = target_item_id;
$$;

create or replace function public.dynamic_field_usage_count(target_field_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.dynamic_field_values
  where field_id = target_field_id;
$$;

create or replace function public.dynamic_option_usage_count(target_field_id uuid, option_code text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.dynamic_field_values
  where field_id = target_field_id
    and jsonb_typeof(value) = 'string'
    and value #>> '{}' = option_code;
$$;

create or replace function public.validate_dynamic_field_value(target_field_id uuid, raw jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  value_type text;
  option_code text;
begin
  select * into field_row from public.dynamic_fields where id = target_field_id;
  if field_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  if raw is null or raw = 'null'::jsonb then
    if field_row.is_required and field_row.is_active then
      raise exception 'Заполните обязательное поле.';
    end if;
    return;
  end if;

  value_type := jsonb_typeof(raw);

  if field_row.field_type = 'text' then
    if value_type <> 'string' then
      raise exception 'Ожидается текстовое значение.';
    end if;
    if field_row.is_required and btrim(raw #>> '{}') = '' then
      raise exception 'Заполните обязательное поле.';
    end if;
    return;
  end if;

  if field_row.field_type = 'number' then
    if value_type <> 'number' then
      raise exception 'Ожидается числовое значение.';
    end if;
    return;
  end if;

  if field_row.field_type = 'select' then
    if value_type <> 'string' then
      raise exception 'Выберите значение из списка.';
    end if;
    option_code := raw #>> '{}';
    if not exists (
      select 1
      from public.dynamic_field_options
      where field_id = field_row.id
        and code = option_code
        and is_active = true
    ) then
      raise exception 'Выбранный вариант недоступен.';
    end if;
    return;
  end if;

  raise exception 'Неподдерживаемый тип поля.';
end;
$$;

create or replace function public.upsert_reference_item(
  target_id uuid,
  target_set_id uuid,
  item_code text,
  item_name text,
  item_description text default '',
  parent_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  normalized_name text;
  current_row public.reference_items%rowtype;
  result_id uuid;
  next_sort integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.reference_sets where id = target_set_id) then
    raise exception 'Справочник не найден.';
  end if;

  normalized_code := lower(btrim(coalesce(item_code, '')));
  normalized_name := btrim(coalesce(item_name, ''));

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if target_id is not null then
    select * into current_row from public.reference_items where id = target_id and set_id = target_set_id;
    if current_row.id is null then
      raise exception 'Запись справочника не найдена.';
    end if;

    if current_row.is_system and current_row.code <> normalized_code then
      raise exception 'Код системной записи нельзя изменить.';
    end if;

    update public.reference_items
    set
      code = case when current_row.is_system then current_row.code else normalized_code end,
      name = normalized_name,
      description = btrim(coalesce(item_description, '')),
      parent_id = parent_item_id
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.reference_items
    where set_id = target_set_id;

    insert into public.reference_items (set_id, parent_id, code, name, description, sort_order)
    values (
      target_set_id,
      parent_item_id,
      normalized_code,
      normalized_name,
      btrim(coalesce(item_description, '')),
      next_sort
    )
    returning id into result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'references.item_created' else 'references.item_updated' end,
    'reference_item',
    result_id::text,
    jsonb_build_object('set_id', target_set_id, 'code', normalized_code)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Запись с таким кодом уже есть в справочнике.';
end;
$$;

create or replace function public.set_reference_item_active(target_id uuid, next_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  if current_row.is_active = next_active then
    return;
  end if;

  update public.reference_items
  set is_active = next_active
  where id = target_id;

  perform public.record_audit(
    case when next_active then 'references.item_activated' else 'references.item_deactivated' end,
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id)
  );
end;
$$;

create or replace function public.reorder_reference_items(target_set_id uuid, item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  perform public.assert_settings_write();

  if item_ids is null or array_length(item_ids, 1) is null then
    raise exception 'Передайте порядок записей.';
  end if;

  select count(*) into expected_count from public.reference_items where set_id = target_set_id;

  select count(*) into matched_count
  from public.reference_items
  where set_id = target_set_id
    and id = any (item_ids);

  if expected_count <> array_length(item_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все записи справочника.';
  end if;

  update public.reference_items i
  set sort_order = o.ord - 1
  from unnest(item_ids) with ordinality as o(id, ord)
  where i.id = o.id
    and i.set_id = target_set_id;

  perform public.record_audit(
    'references.items_reordered',
    'reference_set',
    target_set_id::text,
    jsonb_build_object('count', expected_count)
  );
end;
$$;

create or replace function public.replace_dynamic_field_options(target_field_id uuid, options jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  option_row jsonb;
  option_code text;
  option_label text;
  option_sort integer;
  option_active boolean;
  seen_codes text[] := '{}';
  idx integer := 0;
begin
  if jsonb_typeof(coalesce(options, '[]'::jsonb)) <> 'array' then
    raise exception 'Варианты списка заданы некорректно.';
  end if;

  for option_row in select value from jsonb_array_elements(options)
  loop
    option_code := lower(btrim(coalesce(option_row ->> 'code', '')));
    option_label := btrim(coalesce(option_row ->> 'label', ''));
    option_sort := coalesce((option_row ->> 'sort_order')::integer, idx);
    option_active := coalesce((option_row ->> 'is_active')::boolean, true);

    if option_code !~ '^[a-z][a-z0-9_]{0,63}$' then
      raise exception 'Код варианта: латиница, цифры и подчёркивание, начинается с буквы.';
    end if;

    if char_length(option_label) < 1 then
      raise exception 'Укажите название варианта.';
    end if;

    if option_code = any (seen_codes) then
      raise exception 'Коды вариантов не должны повторяться.';
    end if;

    seen_codes := array_append(seen_codes, option_code);

    insert into public.dynamic_field_options (field_id, code, label, sort_order, is_active)
    values (target_field_id, option_code, option_label, option_sort, option_active)
    on conflict (field_id, code) do update
      set label = excluded.label,
          sort_order = excluded.sort_order,
          is_active = excluded.is_active;

    idx := idx + 1;
  end loop;

  update public.dynamic_field_options
  set is_active = false
  where field_id = target_field_id
    and not (code = any (seen_codes));
end;
$$;

create or replace function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  normalized_code text;
  normalized_name text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);
    if usage_count > 0 and current_row.field_type <> p_type then
      raise exception 'Нельзя сменить тип поля, которое уже используется в данных.';
    end if;

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = p_type,
      is_required = p_required
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order)
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object('entity_code', p_entity, 'code', normalized_code, 'field_type', p_type)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

create or replace function public.set_dynamic_field_active(target_id uuid, next_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  if current_row.is_active = next_active then
    return;
  end if;

  update public.dynamic_fields
  set is_active = next_active
  where id = target_id;

  perform public.record_audit(
    case when next_active then 'fields.activated' else 'fields.deactivated' end,
    'dynamic_field',
    target_id::text,
    jsonb_build_object('entity_code', current_row.entity_code, 'code', current_row.code)
  );
end;
$$;

create or replace function public.reorder_dynamic_fields(target_entity_code text, field_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  perform public.assert_settings_write();

  if field_ids is null or array_length(field_ids, 1) is null then
    raise exception 'Передайте порядок полей.';
  end if;

  select count(*) into expected_count
  from public.dynamic_fields
  where entity_code = target_entity_code;

  select count(*) into matched_count
  from public.dynamic_fields
  where entity_code = target_entity_code
    and id = any (field_ids);

  if expected_count <> array_length(field_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все поля раздела.';
  end if;

  update public.dynamic_fields f
  set sort_order = o.ord - 1
  from unnest(field_ids) with ordinality as o(id, ord)
  where f.id = o.id
    and f.entity_code = target_entity_code;

  perform public.record_audit(
    'fields.reordered',
    'field_entity',
    target_entity_code,
    jsonb_build_object('count', expected_count)
  );
end;
$$;

create or replace function public.save_dynamic_field_values(
  target_entity_code text,
  target_record_id uuid,
  field_values jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  raw jsonb;
  permission_code text;
begin
  if not public.is_active_user() then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.field_entities where code = target_entity_code) then
    raise exception 'Раздел карточки не найден.';
  end if;

  permission_code := target_entity_code || ':update';
  if target_entity_code = 'diagnostics' then
    permission_code := 'diagnostics:update';
  end if;

  if not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  for field_row in
    select *
    from public.dynamic_fields
    where entity_code = target_entity_code
      and is_active = true
  loop
    raw := field_values -> field_row.code;
    perform public.validate_dynamic_field_value(field_row.id, raw);

    if raw is null or raw = 'null'::jsonb or (jsonb_typeof(raw) = 'string' and btrim(raw #>> '{}') = '') then
      delete from public.dynamic_field_values
      where field_id = field_row.id
        and record_id = target_record_id;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
    end if;
  end loop;
end;
$$;

insert into public.dynamic_field_types (code, name, sort_order)
values
  ('text', 'Текст', 0),
  ('number', 'Число', 1),
  ('select', 'Список', 2)
on conflict (code) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;

insert into public.field_entities (code, name, description, sort_order)
values
  ('orders', 'Заказы', 'Дополнительные поля ремонтного заказа', 0),
  ('customers', 'Клиенты', 'Дополнительные поля организации', 1),
  ('devices', 'Приборы', 'Дополнительные поля эндоскопа', 2),
  ('diagnostics', 'Диагностика', 'Поля протокола диагностики', 3),
  ('inventory', 'Склад', 'Дополнительные поля номенклатуры', 4),
  ('tasks', 'Задачи', 'Дополнительные поля задачи', 5)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into public.reference_sets (code, name, description, sort_order)
values
  ('order_statuses', 'Статусы заказов', 'Этапы ремонта и выдачи', 0),
  ('device_groups', 'Группы приборов', 'Типы эндоскопов и принадлежностей', 1),
  ('device_brands', 'Бренды приборов', 'Производители', 2),
  ('inventory_categories', 'Категории склада', 'Группы номенклатуры', 5),
  ('units_of_measure', 'Единицы измерения', 'Единицы учёта склада', 6),
  ('task_priorities', 'Приоритеты задач', 'Срочность работ', 7),
  ('notification_event_types', 'Типы уведомлений', 'События, по которым создаются уведомления', 8)
on conflict (code) do nothing;

insert into public.reference_sets (code, name, description, parent_set_id, sort_order)
select 'device_models', 'Модели приборов', 'Модели в рамках бренда', s.id, 3
from public.reference_sets s
where s.code = 'device_brands'
on conflict (code) do nothing;

insert into public.reference_sets (code, name, description, parent_set_id, sort_order)
select 'device_modifications', 'Модификации приборов', 'Модификации в рамках модели', s.id, 4
from public.reference_sets s
where s.code = 'device_models'
on conflict (code) do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('received', 'Принят', 0),
    ('diagnostics', 'Диагностика', 1),
    ('waiting_approval', 'Согласование', 2),
    ('waiting_parts', 'Ожидание запчастей', 3),
    ('repair', 'Ремонт', 4),
    ('quality_check', 'Контроль', 5),
    ('ready', 'Готов к выдаче', 6),
    ('issued', 'Выдан', 7),
    ('cancelled', 'Отменён', 8)
) as i(code, name, sort_order) on true
where s.code = 'order_statuses'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('flexible_endoscope', 'Гибкий эндоскоп', 0),
    ('rigid_endoscope', 'Жёсткий эндоскоп', 1),
    ('ultrasound_endoscope', 'УЗИ-эндоскоп', 2),
    ('accessory', 'Принадлежность', 3)
) as i(code, name, sort_order) on true
where s.code = 'device_groups'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('olympus', 'Olympus', 0),
    ('pentax', 'Pentax', 1),
    ('fujifilm', 'Fujifilm', 2),
    ('karl_storz', 'Karl Storz', 3),
    ('other', 'Другой', 4)
) as i(code, name, sort_order) on true
where s.code = 'device_brands'
on conflict do nothing;

insert into public.reference_items (set_id, parent_id, code, name, sort_order, is_system)
select model_set.id, brands.id, models.code, models.name, models.sort_order, true
from (
  values
    ('gif_q150', 'GIF-Q150', 0),
    ('cf_q150l', 'CF-Q150L', 1)
) as models(code, name, sort_order)
join public.reference_sets model_set on model_set.code = 'device_models'
join public.reference_items brands on brands.code = 'olympus'
join public.reference_sets brand_set on brand_set.id = brands.set_id and brand_set.code = 'device_brands'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('spare_parts', 'Запчасти', 0),
    ('consumables', 'Расходники', 1),
    ('tools', 'Инструмент', 2)
) as i(code, name, sort_order) on true
where s.code = 'inventory_categories'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('pcs', 'шт', 0),
    ('set', 'компл', 1),
    ('pack', 'упак', 2),
    ('m', 'м', 3)
) as i(code, name, sort_order) on true
where s.code = 'units_of_measure'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('low', 'Низкий', 0),
    ('normal', 'Обычный', 1),
    ('high', 'Высокий', 2),
    ('urgent', 'Срочный', 3)
) as i(code, name, sort_order) on true
where s.code = 'task_priorities'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('order_assigned', 'Назначение заказа', 0),
    ('order_status_changed', 'Смена статуса заказа', 1),
    ('task_due', 'Срок задачи', 2),
    ('inventory_low', 'Низкий остаток', 3)
) as i(code, name, sort_order) on true
where s.code = 'notification_event_types'
on conflict do nothing;

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order)
values
  ('customers', 'inn', 'ИНН', 'text', false, 0),
  ('customers', 'contract_number', 'Номер договора', 'text', false, 1),
  ('diagnostics', 'working_hours', 'Наработка, часы', 'number', false, 0),
  ('diagnostics', 'leak_test', 'Тест на герметичность', 'select', true, 1),
  ('diagnostics', 'notes', 'Комментарий диагноста', 'text', false, 2),
  ('devices', 'firmware_version', 'Версия ПО', 'text', false, 0)
on conflict do nothing;

insert into public.dynamic_field_options (field_id, code, label, sort_order)
select f.id, o.code, o.label, o.sort_order
from public.dynamic_fields f
join (
  values
    ('passed', 'Пройден', 0),
    ('failed', 'Не пройден', 1),
    ('not_performed', 'Не выполнялся', 2)
) as o(code, label, sort_order) on true
where f.entity_code = 'diagnostics' and f.code = 'leak_test'
on conflict do nothing;

alter table public.reference_sets enable row level security;
alter table public.reference_items enable row level security;
alter table public.field_entities enable row level security;
alter table public.dynamic_field_types enable row level security;
alter table public.dynamic_fields enable row level security;
alter table public.dynamic_field_options enable row level security;
alter table public.dynamic_field_values enable row level security;

drop policy if exists reference_sets_select_active on public.reference_sets;
create policy reference_sets_select_active
  on public.reference_sets
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists reference_items_select_active on public.reference_items;
create policy reference_items_select_active
  on public.reference_items
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists field_entities_select_active on public.field_entities;
create policy field_entities_select_active
  on public.field_entities
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_field_types_select_active on public.dynamic_field_types;
create policy dynamic_field_types_select_active
  on public.dynamic_field_types
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_fields_select_active on public.dynamic_fields;
create policy dynamic_fields_select_active
  on public.dynamic_fields
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_field_options_select_active on public.dynamic_field_options;
create policy dynamic_field_options_select_active
  on public.dynamic_field_options
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_field_values_select_entity_read on public.dynamic_field_values;
create policy dynamic_field_values_select_entity_read
  on public.dynamic_field_values
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('settings:read')
      or public.has_permission(entity_code || ':read')
    )
  );

grant select on public.reference_set_summaries to authenticated;
grant select on public.field_entity_summaries to authenticated;

revoke all on function public.assert_settings_write() from public;
revoke all on function public.reference_item_usage_count(uuid) from public;
revoke all on function public.dynamic_field_usage_count(uuid) from public;
revoke all on function public.dynamic_option_usage_count(uuid, text) from public;
revoke all on function public.validate_dynamic_field_value(uuid, jsonb) from public;
revoke all on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) from public;
revoke all on function public.set_reference_item_active(uuid, boolean) from public;
revoke all on function public.reorder_reference_items(uuid, uuid[]) from public;
revoke all on function public.replace_dynamic_field_options(uuid, jsonb) from public;
revoke all on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb) from public;
revoke all on function public.set_dynamic_field_active(uuid, boolean) from public;
revoke all on function public.reorder_dynamic_fields(text, uuid[]) from public;
revoke all on function public.save_dynamic_field_values(text, uuid, jsonb) from public;

grant execute on function public.reference_item_usage_count(uuid) to authenticated;
grant execute on function public.dynamic_field_usage_count(uuid) to authenticated;
grant execute on function public.dynamic_option_usage_count(uuid, text) to authenticated;
grant execute on function public.validate_dynamic_field_value(uuid, jsonb) to authenticated;
grant execute on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.set_reference_item_active(uuid, boolean) to authenticated;
grant execute on function public.reorder_reference_items(uuid, uuid[]) to authenticated;
grant execute on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.set_dynamic_field_active(uuid, boolean) to authenticated;
grant execute on function public.reorder_dynamic_fields(text, uuid[]) to authenticated;
grant execute on function public.save_dynamic_field_values(text, uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- [4/18 | was 4/151] 20260825300000_orders.sql
-- -----------------------------------------------------------------------------

-- Эндотека: заказы, клиенты, приборы, маршрут статусов, журнал, файлы, уведомления.
-- Номер заказа выдаётся только в БД, с блокировкой строки последовательности.
-- Зависит от 20260825200000_reference_data_and_dynamic_fields.sql (reference_sets / reference_items).

do $$
begin
  if to_regclass('public.reference_items') is null or to_regclass('public.reference_sets') is null then
    raise exception 'Сначала примените миграцию 20260825200000_reference_data_and_dynamic_fields.sql (нет public.reference_items).';
  end if;
end $$;

update public.reference_items i
set name = v.name
from public.reference_sets s,
  (values
    ('repair', 'В ремонте'),
    ('quality_check', 'Выходной контроль'),
    ('ready', 'Готов к отправке'),
    ('cancelled', 'Отказ/возврат без ремонта')
  ) as v(code, name)
where s.code = 'order_statuses'
  and i.set_id = s.id
  and i.code = v.code;

update public.reference_items i
set is_active = false
from public.reference_sets s
where s.code = 'order_statuses'
  and i.set_id = s.id
  and i.code = 'waiting_parts';

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, v.code, v.name, v.sort_order, true
from public.reference_sets s
join (
  values
    ('warehouse_repair_started', 'Заказ переведён в ремонт', 4),
    ('order_deadline_approaching', 'Приближается срок заказа', 5),
    ('order_deadline_overdue', 'Срок заказа просрочен', 6)
) as v(code, name, sort_order) on true
where s.code = 'notification_event_types'
on conflict do nothing;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute procedure public.set_updated_at();

insert into public.app_settings (key, value)
values
  ('order_number', jsonb_build_object('prefix', 'ЗК', 'start', 1, 'pad', 4)),
  ('deadline', jsonb_build_object('approaching_days', 2))
on conflict (key) do nothing;

create table if not exists public.order_number_sequence (
  id smallint primary key default 1 check (id = 1),
  prefix text not null default 'ЗК',
  pad_width integer not null default 4 check (pad_width between 3 and 8),
  start_value integer not null default 1 check (start_value >= 1),
  last_value integer not null default 0 check (last_value >= 0)
);

insert into public.order_number_sequence (id, prefix, pad_width, start_value, last_value)
values (1, 'ЗК', 4, 1, 0)
on conflict (id) do nothing;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  inn text not null default '',
  phone text not null default '',
  email text not null default '',
  city text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_name_idx on public.customers (lower(name));
create index if not exists customers_inn_idx on public.customers (inn);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute procedure public.set_updated_at();

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  group_id uuid references public.reference_items (id) on delete set null,
  brand_id uuid references public.reference_items (id) on delete set null,
  model_id uuid references public.reference_items (id) on delete set null,
  modification_id uuid references public.reference_items (id) on delete set null,
  serial_number text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_serial_unique unique (serial_number)
);

create index if not exists devices_serial_idx on public.devices (lower(serial_number));
create index if not exists devices_customer_idx on public.devices (customer_id);

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute procedure public.set_updated_at();

create table if not exists public.order_status_meta (
  status_id uuid primary key references public.reference_items (id) on delete cascade,
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  notifies_warehouse boolean not null default false
);

insert into public.order_status_meta (status_id, is_initial, is_terminal, notifies_warehouse)
select i.id,
  i.code = 'received',
  i.code in ('issued', 'cancelled'),
  i.code = 'repair'
from public.reference_items i
join public.reference_sets s on s.id = i.set_id
where s.code = 'order_statuses'
on conflict (status_id) do update
  set is_initial = excluded.is_initial,
      is_terminal = excluded.is_terminal,
      notifies_warehouse = excluded.notifies_warehouse;

create table if not exists public.transition_rule_types (
  code text primary key,
  name text not null,
  description text
);

insert into public.transition_rule_types (code, name, description)
values
  ('diagnostics_conclusion', 'Заключение диагностики', 'Нужно заполненное заключение диагностики'),
  ('responsible_assigned', 'Ответственный', 'У заказа должен быть ответственный сотрудник')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description;

create table if not exists public.order_status_transitions (
  id uuid primary key default gen_random_uuid(),
  from_status_id uuid not null references public.reference_items (id) on delete restrict,
  to_status_id uuid not null references public.reference_items (id) on delete restrict,
  required_permission text not null default 'orders:change_status',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_status_transitions_unique unique (from_status_id, to_status_id)
);

create trigger order_status_transitions_set_updated_at
  before update on public.order_status_transitions
  for each row execute procedure public.set_updated_at();

create table if not exists public.order_transition_rules (
  transition_id uuid not null references public.order_status_transitions (id) on delete cascade,
  rule_code text not null references public.transition_rule_types (code) on delete restrict,
  primary key (transition_id, rule_code)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  number_seq integer not null,
  customer_id uuid not null references public.customers (id) on delete restrict,
  device_id uuid not null references public.devices (id) on delete restrict,
  serial_number text not null,
  claimed_malfunction text not null default '',
  completeness text not null default '',
  external_condition text not null default '',
  deadline date,
  responsible_id uuid references public.profiles (id) on delete set null,
  status_id uuid not null references public.reference_items (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_number_unique unique (number)
);

create index if not exists orders_status_idx on public.orders (status_id);
create index if not exists orders_responsible_idx on public.orders (responsible_id);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_deadline_idx on public.orders (deadline);
create index if not exists orders_updated_idx on public.orders (updated_at desc);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute procedure public.set_updated_at();

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status_id uuid references public.reference_items (id) on delete set null,
  to_status_id uuid not null references public.reference_items (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_status_events_order_idx
  on public.order_status_events (order_id, created_at desc);

create table if not exists public.order_diagnostics (
  order_id uuid primary key references public.orders (id) on delete cascade,
  conclusion text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('photo', 'pdf', 'url')),
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
  url text,
  caption text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_attachments_payload check (
    (kind = 'url' and url is not null and file_path is null)
    or (kind in ('photo', 'pdf') and file_path is not null)
  )
);

create index if not exists order_attachments_order_idx on public.order_attachments (order_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  event_code text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

create table if not exists public.notification_routes (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  target_kind text not null check (target_kind in ('role', 'responsible')),
  role_id uuid references public.roles (id) on delete cascade
);

create unique index if not exists notification_routes_unique_idx
  on public.notification_routes (event_code, target_kind, coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid));

insert into public.notification_routes (event_code, target_kind, role_id)
select 'warehouse_repair_started', 'role', r.id
from public.roles r
where r.code = 'storekeeper'
on conflict do nothing;

insert into public.notification_routes (event_code, target_kind, role_id)
values
  ('order_assigned', 'responsible', null),
  ('order_deadline_approaching', 'responsible', null),
  ('order_deadline_overdue', 'responsible', null)
on conflict do nothing;

create table if not exists public.order_deadline_flags (
  order_id uuid not null references public.orders (id) on delete cascade,
  kind text not null check (kind in ('approaching', 'overdue')),
  sent_at timestamptz not null default now(),
  primary key (order_id, kind)
);

insert into public.order_status_transitions (from_status_id, to_status_id, required_permission, sort_order)
select f.id, t.id, 'orders:change_status', v.sort_order
from (
  values
    ('received', 'diagnostics', 0),
    ('diagnostics', 'waiting_approval', 1),
    ('waiting_approval', 'repair', 2),
    ('repair', 'quality_check', 3),
    ('quality_check', 'ready', 4),
    ('ready', 'issued', 5),
    ('received', 'cancelled', 10),
    ('diagnostics', 'cancelled', 11),
    ('waiting_approval', 'cancelled', 12)
) as v(from_code, to_code, sort_order)
join public.reference_sets s on s.code = 'order_statuses'
join public.reference_items f on f.set_id = s.id and f.code = v.from_code
join public.reference_items t on t.set_id = s.id and t.code = v.to_code
on conflict (from_status_id, to_status_id) do nothing;

insert into public.order_transition_rules (transition_id, rule_code)
select tr.id, 'diagnostics_conclusion'
from public.order_status_transitions tr
join public.reference_items f on f.id = tr.from_status_id
join public.reference_items t on t.id = tr.to_status_id
join public.reference_sets s on s.id = f.set_id and s.code = 'order_statuses'
where f.code = 'diagnostics' and t.code = 'waiting_approval'
on conflict do nothing;

create or replace view public.order_list_items
with (security_invoker = true) as
select
  o.id,
  o.number,
  o.number_seq,
  o.customer_id,
  c.name as customer_name,
  o.device_id,
  o.serial_number,
  coalesce(brand.name, '') as device_brand,
  coalesce(model.name, '') as device_model,
  trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''))) as device_label,
  o.status_id,
  st.code as status_code,
  st.name as status_name,
  coalesce(meta.is_terminal, false) as is_terminal,
  o.responsible_id,
  coalesce(nullif(p.full_name, ''), p.email, '') as responsible_name,
  o.deadline,
  case
    when coalesce(meta.is_terminal, false) then 'closed'
    when o.deadline is null then 'none'
    when o.deadline < current_date then 'overdue'
    when o.deadline <= current_date + coalesce(
      ((select value ->> 'approaching_days' from public.app_settings where key = 'deadline')::integer),
      2
    ) then 'approaching'
    else 'normal'
  end as deadline_state,
  o.claimed_malfunction,
  o.created_at,
  o.updated_at
from public.orders o
join public.customers c on c.id = o.customer_id
join public.devices d on d.id = o.device_id
join public.reference_items st on st.id = o.status_id
left join public.order_status_meta meta on meta.status_id = o.status_id
left join public.profiles p on p.id = o.responsible_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

create or replace function public.next_order_number()
returns table (order_number text, seq integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_val integer;
  current_prefix text;
  current_pad integer;
begin
  update public.order_number_sequence
  set last_value = greatest(last_value, start_value - 1) + 1
  where id = 1
  returning last_value, prefix, pad_width into next_val, current_prefix, current_pad;

  if next_val is null then
    raise exception 'Не настроена нумерация заказов.';
  end if;

  order_number := current_prefix || '-' || lpad(next_val::text, current_pad, '0');
  seq := next_val;
  return next;
end;
$$;

create or replace function public.preview_next_order_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select prefix || '-' || lpad((greatest(last_value, start_value - 1) + 1)::text, pad_width, '0')
  from public.order_number_sequence
  where id = 1;
$$;

create or replace function public.set_order_number_start(next_start integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения нумерации.';
  end if;

  if next_start is null or next_start < 1 then
    raise exception 'Начальный номер должен быть больше нуля.';
  end if;

  update public.order_number_sequence
  set start_value = next_start
  where id = 1;

  update public.app_settings
  set value = jsonb_set(coalesce(value, '{}'::jsonb), '{start}', to_jsonb(next_start))
  where key = 'order_number';

  perform public.record_audit(
    'orders.number_start_changed',
    'settings',
    'order_number',
    jsonb_build_object('start', next_start)
  );
end;
$$;

create or replace function public.create_customer(
  customer_name text,
  customer_inn text default '',
  customer_phone text default '',
  customer_email text default '',
  customer_city text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  normalized_name text;
begin
  if not public.has_permission('customers:create') then
    raise exception 'Недостаточно прав для создания клиента.';
  end if;

  normalized_name := btrim(coalesce(customer_name, ''));
  if char_length(normalized_name) < 1 then
    raise exception 'Укажите название клиента.';
  end if;

  insert into public.customers (name, inn, phone, email, city)
  values (
    normalized_name,
    btrim(coalesce(customer_inn, '')),
    btrim(coalesce(customer_phone, '')),
    btrim(coalesce(customer_email, '')),
    btrim(coalesce(customer_city, ''))
  )
  returning id into result_id;

  perform public.record_audit('customers.created', 'customer', result_id::text, jsonb_build_object('name', normalized_name));
  return result_id;
end;
$$;

create or replace function public.create_device(
  device_serial text,
  device_customer_id uuid default null,
  device_group_id uuid default null,
  device_brand_id uuid default null,
  device_model_id uuid default null,
  device_modification_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  serial text;
begin
  if not public.has_permission('devices:create') then
    raise exception 'Недостаточно прав для создания прибора.';
  end if;

  serial := btrim(coalesce(device_serial, ''));
  if char_length(serial) < 1 then
    raise exception 'Укажите серийный номер.';
  end if;

  insert into public.devices (
    serial_number, customer_id, group_id, brand_id, model_id, modification_id
  )
  values (
    serial, device_customer_id, device_group_id, device_brand_id, device_model_id, device_modification_id
  )
  returning id into result_id;

  perform public.record_audit('devices.created', 'device', result_id::text, jsonb_build_object('serial', serial));
  return result_id;
exception
  when unique_violation then
    raise exception 'Прибор с таким серийным номером уже есть.';
end;
$$;

create or replace function public.fanout_notification(
  event_code text,
  title text,
  body text,
  entity_type text,
  entity_id text,
  source_order_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  route public.notification_routes%rowtype;
  responsible uuid;
begin
  for route in
    select * from public.notification_routes where notification_routes.event_code = fanout_notification.event_code
  loop
    if route.target_kind = 'role' and route.role_id is not null then
      insert into public.notifications (recipient_id, event_code, title, body, entity_type, entity_id)
      select ur.user_id, fanout_notification.event_code, title, body, entity_type, entity_id
      from public.user_roles ur
      join public.profiles p on p.id = ur.user_id
      where ur.role_id = route.role_id
        and p.is_active = true;
    elsif route.target_kind = 'responsible' and source_order_id is not null then
      select responsible_id into responsible from public.orders where id = source_order_id;
      if responsible is not null then
        insert into public.notifications (recipient_id, event_code, title, body, entity_type, entity_id)
        select responsible, fanout_notification.event_code, title, body, entity_type, entity_id
        from public.profiles p
        where p.id = responsible and p.is_active = true;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.create_order(
  target_customer_id uuid,
  target_device_id uuid,
  claimed_malfunction text,
  completeness text default '',
  external_condition text default '',
  target_deadline date default null,
  target_responsible_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  v_number text;
  v_seq integer;
  device_serial text;
  initial_status uuid;
  malfunction text;
begin
  if not public.has_permission('orders:create') then
    raise exception 'Недостаточно прав для создания заказа.';
  end if;

  malfunction := btrim(coalesce(claimed_malfunction, ''));
  if char_length(malfunction) < 1 then
    raise exception 'Укажите заявленную неисправность.';
  end if;

  if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
    raise exception 'Клиент не найден.';
  end if;

  select serial_number into device_serial from public.devices where id = target_device_id;
  if device_serial is null then
    raise exception 'Прибор не найден.';
  end if;

  select m.status_id into initial_status
  from public.order_status_meta m
  join public.reference_items i on i.id = m.status_id
  where m.is_initial = true and i.is_active = true
  order by i.sort_order
  limit 1;

  if initial_status is null then
    raise exception 'Не задан начальный статус заказа.';
  end if;

  if target_responsible_id is not null
     and not exists (select 1 from public.profiles where id = target_responsible_id and is_active = true) then
    raise exception 'Ответственный сотрудник не найден.';
  end if;

  select n.order_number, n.seq into v_number, v_seq from public.next_order_number() as n;

  insert into public.orders (
    number, number_seq, customer_id, device_id, serial_number,
    claimed_malfunction, completeness, external_condition,
    deadline, responsible_id, status_id, created_by
  )
  values (
    v_number, v_seq, target_customer_id, target_device_id, device_serial,
    malfunction, btrim(coalesce(completeness, '')), btrim(coalesce(external_condition, '')),
    target_deadline, target_responsible_id, initial_status, auth.uid()
  )
  returning id into result_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (result_id, null, initial_status, auth.uid(), jsonb_build_object('source', 'create'));

  perform public.record_audit(
    'orders.created',
    'order',
    result_id::text,
    jsonb_build_object('number', v_number)
  );

  return result_id;
end;
$$;

create or replace function public.update_order(
  target_order_id uuid,
  claimed_malfunction text default null,
  completeness text default null,
  external_condition text default null,
  target_deadline date default null,
  clear_deadline boolean default false,
  target_responsible_id uuid default null,
  change_responsible boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if claimed_malfunction is not null or completeness is not null or external_condition is not null
     or target_deadline is not null or clear_deadline then
    if not public.has_permission('orders:update') then
      raise exception 'Недостаточно прав для изменения заказа.';
    end if;
  end if;

  if change_responsible and not (public.has_permission('orders:assign') or public.has_permission('orders:update')) then
    raise exception 'Недостаточно прав для назначения ответственного.';
  end if;

  if claimed_malfunction is not null and char_length(btrim(claimed_malfunction)) < 1 then
    raise exception 'Укажите заявленную неисправность.';
  end if;

  previous_responsible := current_row.responsible_id;

  update public.orders
  set
    claimed_malfunction = case
      when claimed_malfunction is not null then btrim(claimed_malfunction)
      else orders.claimed_malfunction
    end,
    completeness = case
      when completeness is not null then btrim(completeness)
      else orders.completeness
    end,
    external_condition = case
      when external_condition is not null then btrim(external_condition)
      else orders.external_condition
    end,
    deadline = case
      when clear_deadline then null
      when target_deadline is not null then target_deadline
      else orders.deadline
    end,
    responsible_id = case
      when change_responsible then target_responsible_id
      else orders.responsible_id
    end
  where id = target_order_id;

  if change_responsible and target_responsible_id is distinct from previous_responsible then
    perform public.fanout_notification(
      'order_assigned',
      'Назначен заказ',
      'Вам назначен заказ ' || current_row.number,
      'order',
      target_order_id::text,
      target_order_id
    );
  end if;

  perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.transition_rule_passed(rule_code text, target_order public.orders)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if rule_code = 'diagnostics_conclusion' then
    return exists (
      select 1 from public.order_diagnostics d
      where d.order_id = target_order.id
        and char_length(btrim(d.conclusion)) > 0
    );
  end if;

  if rule_code = 'responsible_assigned' then
    return target_order.responsible_id is not null;
  end if;

  return false;
end;
$$;

create or replace function public.change_order_status(target_order_id uuid, target_status_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  transition public.order_status_transitions%rowtype;
  rule_code text;
  to_name text;
  to_code text;
  from_name text;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  select * into transition
  from public.order_status_transitions
  where from_status_id = current_row.status_id
    and to_status_id = target_status_id
    and is_active = true;

  if transition.id is null then
    raise exception 'Такой переход статуса не разрешён.';
  end if;

  if not public.has_permission(transition.required_permission) then
    raise exception 'Недостаточно прав для этого перехода.';
  end if;

  for rule_code in
    select r.rule_code from public.order_transition_rules r where r.transition_id = transition.id
  loop
    if not public.transition_rule_passed(rule_code, current_row) then
      if rule_code = 'diagnostics_conclusion' then
        raise exception 'Сначала заполните заключение диагностики.';
      end if;
      if rule_code = 'responsible_assigned' then
        raise exception 'Назначьте ответственного сотрудника.';
      end if;
      raise exception 'Не выполнено условие перехода.';
    end if;
  end loop;

  select name, code into to_name, to_code from public.reference_items where id = target_status_id;
  select name into from_name from public.reference_items where id = current_row.status_id;

  update public.orders
  set status_id = target_status_id
  where id = target_order_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (
    target_order_id,
    current_row.status_id,
    target_status_id,
    auth.uid(),
    jsonb_build_object('from_name', from_name, 'to_name', to_name)
  );

  if exists (
    select 1 from public.order_status_meta
    where status_id = target_status_id and notifies_warehouse = true
  ) then
    perform public.fanout_notification(
      'warehouse_repair_started',
      'Заказ в ремонте',
      'Заказ ' || current_row.number || ' переведён в ремонт. Проверьте склад.',
      'order',
      target_order_id::text,
      target_order_id
    );
  end if;

  perform public.record_audit(
    'orders.status_changed',
    'order',
    target_order_id::text,
    jsonb_build_object('from', current_row.status_id, 'to', target_status_id, 'to_code', to_code)
  );
end;
$$;

create or replace function public.get_available_order_transitions(target_order_id uuid)
returns table (
  transition_id uuid,
  to_status_id uuid,
  to_status_code text,
  to_status_name text,
  required_permission text,
  is_allowed boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  rec record;
  allowed boolean;
  reason text;
  rule_code text;
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  select * into current_row from public.orders where id = target_order_id;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  for rec in
    select tr.id, tr.to_status_id, tr.required_permission, i.code, i.name
    from public.order_status_transitions tr
    join public.reference_items i on i.id = tr.to_status_id
    where tr.from_status_id = current_row.status_id
      and tr.is_active = true
    order by tr.sort_order, i.sort_order
  loop
    allowed := public.has_permission(rec.required_permission);
    reason := null;

    if not allowed then
      reason := 'Недостаточно прав для этого перехода.';
    else
      for rule_code in
        select r.rule_code from public.order_transition_rules r where r.transition_id = rec.id
      loop
        if not public.transition_rule_passed(rule_code, current_row) then
          allowed := false;
          if rule_code = 'diagnostics_conclusion' then
            reason := 'Нужно заключение диагностики.';
          elsif rule_code = 'responsible_assigned' then
            reason := 'Нужно назначить ответственного.';
          else
            reason := 'Не выполнено условие перехода.';
          end if;
          exit;
        end if;
      end loop;
    end if;

    transition_id := rec.id;
    to_status_id := rec.to_status_id;
    to_status_code := rec.code;
    to_status_name := rec.name;
    required_permission := rec.required_permission;
    is_allowed := allowed;
    block_reason := reason;
    return next;
  end loop;
end;
$$;

create or replace function public.save_order_diagnostics(target_order_id uuid, conclusion text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('diagnostics:update') then
    raise exception 'Недостаточно прав для записи диагностики.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.order_diagnostics (order_id, conclusion, updated_by, updated_at)
  values (target_order_id, btrim(coalesce(conclusion, '')), auth.uid(), now())
  on conflict (order_id) do update
    set conclusion = excluded.conclusion,
        updated_by = excluded.updated_by,
        updated_at = now();

  perform public.record_audit('orders.diagnostics_saved', 'order', target_order_id::text, '{}'::jsonb);
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

  insert into public.order_attachments (order_id, kind, url, caption, created_by)
  values (target_order_id, 'url', normalized, btrim(coalesce(caption, '')), auth.uid())
  returning id into result_id;

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
begin
  if not (public.has_permission('orders:update') or public.has_permission('orders:create')) then
    raise exception 'Недостаточно прав для добавления файла.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if file_path is null or split_part(file_path, '/', 1) <> target_order_id::text then
    raise exception 'Некорректный путь файла.';
  end if;

  if mime_type in ('image/jpeg', 'image/png', 'image/webp') then
    kind := 'photo';
  elsif mime_type = 'application/pdf' then
    kind := 'pdf';
  else
    raise exception 'Можно загрузить только фото или PDF. Видео добавляйте ссылкой.';
  end if;

  insert into public.order_attachments (
    order_id, kind, file_path, file_name, mime_type, file_size, caption, created_by
  )
  values (
    target_order_id, kind, file_path, file_name, mime_type, file_size, btrim(coalesce(caption, '')), auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.upsert_order_transition(
  target_id uuid,
  from_status_id uuid,
  to_status_id uuid,
  required_permission text,
  rule_codes text[] default '{}',
  is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения маршрута.';
  end if;

  if from_status_id = to_status_id then
    raise exception 'Начальный и конечный статус не должны совпадать.';
  end if;

  if required_permission is null or required_permission not in (
    'orders:change_status', 'orders:update', 'diagnostics:update', 'orders:assign'
  ) then
    raise exception 'Некорректное право для перехода.';
  end if;

  if target_id is null then
    insert into public.order_status_transitions (
      from_status_id, to_status_id, required_permission, is_active
    )
    values (from_status_id, to_status_id, required_permission, coalesce(is_active, true))
    returning id into result_id;
  else
    update public.order_status_transitions
    set from_status_id = upsert_order_transition.from_status_id,
        to_status_id = upsert_order_transition.to_status_id,
        required_permission = upsert_order_transition.required_permission,
        is_active = coalesce(is_active, true)
    where id = target_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Переход не найден.';
    end if;
  end if;

  delete from public.order_transition_rules where transition_id = result_id;
  insert into public.order_transition_rules (transition_id, rule_code)
  select result_id, r.code
  from unnest(coalesce(rule_codes, '{}'::text[])) as r(code)
  join public.transition_rule_types t on t.code = r.code;

  perform public.record_audit('orders.transition_saved', 'order_transition', result_id::text, '{}'::jsonb);
  return result_id;
exception
  when unique_violation then
    raise exception 'Такой переход уже существует.';
end;
$$;

create or replace function public.process_order_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  approaching_days integer := 2;
  sent integer := 0;
  rec record;
begin
  if auth.uid() is not null and not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав.';
  end if;

  select coalesce((value ->> 'approaching_days')::integer, 2)
    into approaching_days
  from public.app_settings
  where key = 'deadline';

  for rec in
    select o.id, o.number, o.deadline, o.responsible_id, meta.is_terminal
    from public.orders o
    left join public.order_status_meta meta on meta.status_id = o.status_id
    where o.deadline is not null
      and o.responsible_id is not null
      and coalesce(meta.is_terminal, false) = false
  loop
    if rec.deadline < current_date then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'overdue'
      ) then
        perform public.fanout_notification(
          'order_deadline_overdue',
          'Срок заказа просрочен',
          'Срок заказа ' || rec.number || ' истёк.',
          'order',
          rec.id::text,
          rec.id
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'overdue');
        sent := sent + 1;
      end if;
    elsif rec.deadline <= current_date + approaching_days then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'approaching'
      ) then
        perform public.fanout_notification(
          'order_deadline_approaching',
          'Приближается срок заказа',
          'Срок заказа ' || rec.number || ' — ' || to_char(rec.deadline, 'DD.MM.YYYY') || '.',
          'order',
          rec.id::text,
          rec.id
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'approaching');
        sent := sent + 1;
      end if;
    end if;
  end loop;

  return sent;
end;
$$;

create or replace function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set is_read = true
  where recipient_id = auth.uid() and is_read = false;
end;
$$;

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.reference_items where parent_id = target_item_id) +
    (select count(*) from public.orders where status_id = target_item_id) +
    (select count(*) from public.devices where group_id = target_item_id or brand_id = target_item_id or model_id = target_item_id or modification_id = target_item_id)
  )::integer;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-attachments',
  'order-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists order_attachments_select on storage.objects;
create policy order_attachments_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'order-attachments' and public.has_permission('orders:read'));

drop policy if exists order_attachments_insert on storage.objects;
create policy order_attachments_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'order-attachments'
    and (public.has_permission('orders:create') or public.has_permission('orders:update'))
  );

drop policy if exists order_attachments_delete on storage.objects;
create policy order_attachments_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'order-attachments'
    and public.has_permission('orders:update')
  );

alter table public.app_settings enable row level security;
alter table public.order_number_sequence enable row level security;
alter table public.customers enable row level security;
alter table public.devices enable row level security;
alter table public.order_status_meta enable row level security;
alter table public.transition_rule_types enable row level security;
alter table public.order_status_transitions enable row level security;
alter table public.order_transition_rules enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_events enable row level security;
alter table public.order_diagnostics enable row level security;
alter table public.order_attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_routes enable row level security;
alter table public.order_deadline_flags enable row level security;

create policy app_settings_select on public.app_settings
  for select to authenticated using (public.is_active_user());

create policy customers_select on public.customers
  for select to authenticated
  using (public.has_permission('customers:read') or public.has_permission('orders:read'));

create policy devices_select on public.devices
  for select to authenticated
  using (public.has_permission('devices:read') or public.has_permission('orders:read'));

create policy order_status_meta_select on public.order_status_meta
  for select to authenticated using (public.is_active_user());

create policy transition_rule_types_select on public.transition_rule_types
  for select to authenticated using (public.is_active_user());

create policy order_status_transitions_select on public.order_status_transitions
  for select to authenticated using (public.has_permission('orders:read') or public.has_permission('settings:read'));

create policy order_transition_rules_select on public.order_transition_rules
  for select to authenticated using (public.has_permission('orders:read') or public.has_permission('settings:read'));

create policy orders_select on public.orders
  for select to authenticated using (public.has_permission('orders:read'));

create policy order_status_events_select on public.order_status_events
  for select to authenticated using (public.has_permission('orders:read'));

create policy order_diagnostics_select on public.order_diagnostics
  for select to authenticated
  using (public.has_permission('diagnostics:read') or public.has_permission('orders:read'));

create policy order_attachments_select on public.order_attachments
  for select to authenticated using (public.has_permission('orders:read'));

create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_id = auth.uid());

create policy notification_routes_select on public.notification_routes
  for select to authenticated using (public.has_permission('settings:read'));

grant select on public.order_list_items to authenticated;

revoke all on function public.next_order_number() from public;
revoke all on function public.preview_next_order_number() from public;
revoke all on function public.set_order_number_start(integer) from public;
revoke all on function public.create_customer(text, text, text, text, text) from public;
revoke all on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.fanout_notification(text, text, text, text, text, uuid) from public;
revoke all on function public.create_order(uuid, uuid, text, text, text, date, uuid) from public;
revoke all on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean) from public;
revoke all on function public.transition_rule_passed(text, public.orders) from public;
revoke all on function public.change_order_status(uuid, uuid) from public;
revoke all on function public.get_available_order_transitions(uuid) from public;
revoke all on function public.save_order_diagnostics(uuid, text) from public;
revoke all on function public.add_order_attachment_url(uuid, text, text) from public;
revoke all on function public.register_order_file(uuid, text, text, text, integer, text) from public;
revoke all on function public.upsert_order_transition(uuid, uuid, uuid, text, text[], boolean) from public;
revoke all on function public.process_order_deadline_notifications() from public;
revoke all on function public.mark_notifications_read() from public;

grant execute on function public.preview_next_order_number() to authenticated;
grant execute on function public.set_order_number_start(integer) to authenticated;
grant execute on function public.create_customer(text, text, text, text, text) to authenticated;
grant execute on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.create_order(uuid, uuid, text, text, text, date, uuid) to authenticated;
grant execute on function public.update_order(uuid, text, text, text, date, boolean, uuid, boolean) to authenticated;
grant execute on function public.change_order_status(uuid, uuid) to authenticated;
grant execute on function public.get_available_order_transitions(uuid) to authenticated;
grant execute on function public.save_order_diagnostics(uuid, text) to authenticated;
grant execute on function public.add_order_attachment_url(uuid, text, text) to authenticated;
grant execute on function public.register_order_file(uuid, text, text, text, integer, text) to authenticated;
grant execute on function public.upsert_order_transition(uuid, uuid, uuid, text, text[], boolean) to authenticated;
grant execute on function public.process_order_deadline_notifications() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;

-- -----------------------------------------------------------------------------
-- [5/18 | was 5/151] 20260825400000_order_directory_access.sql
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- [6/18 | was 6/151] 20260825500000_devices_warranty.sql
-- -----------------------------------------------------------------------------

-- Приборы: классификация, уникальный серийный номер, гарантии, поиск для заказа.

alter table public.devices
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.devices drop constraint if exists devices_serial_unique;
drop index if exists devices_serial_unique;

create unique index if not exists devices_serial_unique
  on public.devices (lower(btrim(serial_number)));

insert into public.app_settings (key, value)
values ('warranty', jsonb_build_object('default_months', 6))
on conflict (key) do nothing;

create table if not exists public.device_warranties (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices (id) on delete cascade,
  order_id uuid references public.orders (id) on delete restrict,
  starts_on date not null,
  ends_on date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint device_warranties_range check (ends_on >= starts_on),
  constraint device_warranties_order_unique unique (order_id)
);

create index if not exists device_warranties_device_idx
  on public.device_warranties (device_id, ends_on desc);

create or replace function public.warranty_status(starts_on date, ends_on date)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when starts_on is null or ends_on is null then null
    when starts_on > current_date then 'upcoming'
    when ends_on < current_date then 'expired'
    else 'active'
  end;
$$;

create or replace function public.assert_device_classification(
  device_group_id uuid,
  device_brand_id uuid,
  device_model_id uuid,
  device_modification_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  set_code text;
  parent uuid;
begin
  if device_group_id is not null then
    select s.code into set_code
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_group_id and i.is_active = true;
    if set_code is distinct from 'device_groups' then
      raise exception 'Некорректная группа прибора.';
    end if;
  end if;

  if device_brand_id is not null then
    select s.code into set_code
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_brand_id and i.is_active = true;
    if set_code is distinct from 'device_brands' then
      raise exception 'Некорректный бренд прибора.';
    end if;
  end if;

  if device_model_id is not null then
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_model_id and i.is_active = true;
    if set_code is distinct from 'device_models' then
      raise exception 'Некорректная модель прибора.';
    end if;
    if device_brand_id is not null and parent is distinct from device_brand_id then
      raise exception 'Модель не относится к выбранному бренду.';
    end if;
  end if;

  if device_modification_id is not null then
    select s.code, i.parent_id into set_code, parent
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = device_modification_id and i.is_active = true;
    if set_code is distinct from 'device_modifications' then
      raise exception 'Некорректная модификация прибора.';
    end if;
    if device_model_id is not null and parent is distinct from device_model_id then
      raise exception 'Модификация не относится к выбранной модели.';
    end if;
  end if;
end;
$$;

create or replace function public.create_device(
  device_serial text,
  device_customer_id uuid default null,
  device_group_id uuid default null,
  device_brand_id uuid default null,
  device_model_id uuid default null,
  device_modification_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  serial text;
begin
  if not public.has_permission('devices:create') then
    raise exception 'Недостаточно прав для создания прибора.';
  end if;

  serial := btrim(coalesce(device_serial, ''));
  if char_length(serial) < 1 then
    raise exception 'Укажите серийный номер.';
  end if;

  perform public.assert_device_classification(
    device_group_id, device_brand_id, device_model_id, device_modification_id
  );

  insert into public.devices (
    serial_number, customer_id, group_id, brand_id, model_id, modification_id
  )
  values (
    serial, device_customer_id, device_group_id, device_brand_id, device_model_id, device_modification_id
  )
  returning id into result_id;

  perform public.record_audit('devices.created', 'device', result_id::text, jsonb_build_object('serial', serial));
  return result_id;
exception
  when unique_violation then
    select id into result_id
    from public.devices
    where lower(btrim(serial_number)) = lower(serial)
    limit 1;
    raise exception 'Прибор с таким серийным номером уже существует'
      using hint = coalesce(result_id::text, '');
end;
$$;

create or replace function public.update_device(
  target_device_id uuid,
  device_group_id uuid default null,
  device_brand_id uuid default null,
  device_model_id uuid default null,
  device_modification_id uuid default null,
  device_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('devices:update') then
    raise exception 'Недостаточно прав для изменения прибора.';
  end if;

  if not exists (select 1 from public.devices where id = target_device_id) then
    raise exception 'Прибор не найден.';
  end if;

  perform public.assert_device_classification(
    device_group_id, device_brand_id, device_model_id, device_modification_id
  );

  update public.devices
  set
    group_id = device_group_id,
    brand_id = device_brand_id,
    model_id = device_model_id,
    modification_id = device_modification_id,
    metadata = coalesce(device_metadata, metadata)
  where id = target_device_id;

  perform public.record_audit('devices.updated', 'device', target_device_id::text, '{}'::jsonb);
end;
$$;

create or replace view public.device_list_items
with (security_invoker = true) as
select
  d.id,
  d.serial_number,
  d.customer_id,
  d.group_id,
  d.brand_id,
  d.model_id,
  d.modification_id,
  d.metadata,
  d.notes,
  d.created_at,
  d.updated_at,
  coalesce(grp.name, '') as group_name,
  coalesce(brand.name, '') as brand_name,
  coalesce(model.name, '') as model_name,
  coalesce(modif.name, '') as modification_name,
  trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), coalesce(modif.name, ''))) as label,
  w.id as warranty_id,
  w.starts_on as warranty_start,
  w.ends_on as warranty_end,
  public.warranty_status(w.starts_on, w.ends_on) as warranty_status
from public.devices d
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id
left join public.reference_items modif on modif.id = d.modification_id
left join lateral (
  select dw.id, dw.starts_on, dw.ends_on
  from public.device_warranties dw
  where dw.device_id = d.id
  order by
    case public.warranty_status(dw.starts_on, dw.ends_on)
      when 'active' then 0
      when 'upcoming' then 1
      else 2
    end,
    dw.ends_on desc
  limit 1
) w on true;

create or replace function public.device_warranty_json(target_device_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'id', w.id,
        'starts_on', w.starts_on,
        'ends_on', w.ends_on,
        'status', public.warranty_status(w.starts_on, w.ends_on),
        'order_id', w.order_id,
        'order_number', o.number
      )
      from public.device_warranties w
      left join public.orders o on o.id = w.order_id
      where w.device_id = target_device_id
      order by
        case public.warranty_status(w.starts_on, w.ends_on)
          when 'active' then 0
          when 'upcoming' then 1
          else 2
        end,
        w.ends_on desc
      limit 1
    ),
    'null'::jsonb
  );
$$;

create or replace function public.device_repairs_json(target_device_id uuid, max_rows integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_agg(item order by ord.created_at desc)
      from (
        select jsonb_build_object(
          'id', o.id,
          'number', o.number,
          'customer_id', o.customer_id,
          'customer_name', c.name,
          'status_name', st.name,
          'status_code', st.code,
          'claimed_malfunction', o.claimed_malfunction,
          'created_at', o.created_at,
          'updated_at', o.updated_at,
          'deadline', o.deadline
        ) as item,
        o.created_at
        from public.orders o
        join public.customers c on c.id = o.customer_id
        join public.reference_items st on st.id = o.status_id
        where o.device_id = target_device_id
        order by o.created_at desc
        limit greatest(coalesce(max_rows, 8), 1)
      ) ord
    ),
    '[]'::jsonb
  );
$$;

create or replace function public.device_payload(target_device_id uuid, repair_limit integer default 8)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id,
    'serial_number', d.serial_number,
    'group_id', d.group_id,
    'brand_id', d.brand_id,
    'model_id', d.model_id,
    'modification_id', d.modification_id,
    'group_name', coalesce(grp.name, ''),
    'brand_name', coalesce(brand.name, ''),
    'model_name', coalesce(model.name, ''),
    'modification_name', coalesce(modif.name, ''),
    'label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), coalesce(modif.name, ''))),
    'metadata', d.metadata,
    'created_at', d.created_at,
    'updated_at', d.updated_at,
    'warranty', public.device_warranty_json(d.id),
    'latest_order', (
      select value
      from jsonb_array_elements(public.device_repairs_json(d.id, 1))
      limit 1
    ),
    'repairs', public.device_repairs_json(d.id, repair_limit)
  )
  from public.devices d
  left join public.reference_items grp on grp.id = d.group_id
  left join public.reference_items brand on brand.id = d.brand_id
  left join public.reference_items model on model.id = d.model_id
  left join public.reference_items modif on modif.id = d.modification_id
  where d.id = target_device_id;
$$;

create or replace function public.search_device_serial(serial_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  exact_id uuid;
begin
  if not (public.has_permission('devices:read') or public.has_permission('orders:read') or public.has_permission('orders:create') or public.has_permission('devices:create')) then
    raise exception 'Недостаточно прав.';
  end if;

  term := btrim(coalesce(serial_query, ''));
  if char_length(term) < 2 then
    return jsonb_build_object('kind', 'empty', 'device', null, 'items', '[]'::jsonb);
  end if;

  select d.id into exact_id
  from public.devices d
  where lower(btrim(d.serial_number)) = lower(term)
  limit 1;

  if exact_id is not null then
    return jsonb_build_object(
      'kind', 'exact',
      'device', public.device_payload(exact_id, 5),
      'items', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'kind', 'list',
    'device', null,
    'items', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', d.id,
          'serial_number', d.serial_number,
          'label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''))),
          'group_name', coalesce(grp.name, ''),
          'brand_name', coalesce(brand.name, ''),
          'model_name', coalesce(model.name, '')
        ) order by d.serial_number)
        from (
          select *
          from public.devices
          where serial_number ilike '%' || term || '%'
          order by serial_number
          limit 8
        ) d
        left join public.reference_items grp on grp.id = d.group_id
        left join public.reference_items brand on brand.id = d.brand_id
        left join public.reference_items model on model.id = d.model_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_device_card(target_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_permission('devices:read') or public.has_permission('orders:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.devices where id = target_device_id) then
    return null;
  end if;

  return jsonb_build_object(
    'device', public.device_payload(target_device_id, 50),
    'warranties', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', w.id,
          'starts_on', w.starts_on,
          'ends_on', w.ends_on,
          'status', public.warranty_status(w.starts_on, w.ends_on),
          'order_id', w.order_id,
          'order_number', o.number,
          'created_at', w.created_at
        ) order by w.starts_on desc, w.created_at desc)
        from public.device_warranties w
        left join public.orders o on o.id = w.order_id
        where w.device_id = target_device_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_warranty_defaults()
returns table (starts_on date, ends_on date, default_months integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  months integer := 6;
begin
  if not (public.has_permission('orders:change_status') or public.has_permission('orders:read') or public.has_permission('devices:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  select coalesce((value ->> 'default_months')::integer, 6)
    into months
  from public.app_settings
  where key = 'warranty';

  starts_on := current_date;
  ends_on := (current_date + make_interval(months => greatest(months, 1)))::date;
  default_months := greatest(months, 1);
  return next;
end;
$$;

drop function if exists public.change_order_status(uuid, uuid);

create or replace function public.change_order_status(
  target_order_id uuid,
  target_status_id uuid,
  warranty_start date default null,
  warranty_end date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  transition public.order_status_transitions%rowtype;
  rule_code text;
  to_name text;
  to_code text;
  from_name text;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  select * into transition
  from public.order_status_transitions
  where from_status_id = current_row.status_id
    and to_status_id = target_status_id
    and is_active = true;

  if transition.id is null then
    raise exception 'Такой переход статуса не разрешён.';
  end if;

  if not public.has_permission(transition.required_permission) then
    raise exception 'Недостаточно прав для этого перехода.';
  end if;

  for rule_code in
    select r.rule_code from public.order_transition_rules r where r.transition_id = transition.id
  loop
    if not public.transition_rule_passed(rule_code, current_row) then
      if rule_code = 'diagnostics_conclusion' then
        raise exception 'Сначала заполните заключение диагностики.';
      end if;
      if rule_code = 'responsible_assigned' then
        raise exception 'Назначьте ответственного сотрудника.';
      end if;
      raise exception 'Не выполнено условие перехода.';
    end if;
  end loop;

  select name, code into to_name, to_code from public.reference_items where id = target_status_id;
  select name into from_name from public.reference_items where id = current_row.status_id;

  if to_code = 'issued' then
    if warranty_start is null or warranty_end is null then
      raise exception 'Укажите срок гарантии.';
    end if;
    if warranty_end < warranty_start then
      raise exception 'Дата окончания гарантии не может быть раньше начала.';
    end if;
  end if;

  update public.orders
  set status_id = target_status_id
  where id = target_order_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (
    target_order_id,
    current_row.status_id,
    target_status_id,
    auth.uid(),
    jsonb_build_object('from_name', from_name, 'to_name', to_name)
  );

  if to_code = 'issued' then
    insert into public.device_warranties (device_id, order_id, starts_on, ends_on, created_by)
    values (current_row.device_id, target_order_id, warranty_start, warranty_end, auth.uid());
  end if;

  if exists (
    select 1 from public.order_status_meta
    where status_id = target_status_id and notifies_warehouse = true
  ) then
    perform public.fanout_notification(
      'warehouse_repair_started',
      'Заказ в ремонте',
      'Заказ ' || current_row.number || ' переведён в ремонт. Проверьте склад.',
      'order',
      target_order_id::text,
      target_order_id
    );
  end if;

  perform public.record_audit(
    'orders.status_changed',
    'order',
    target_order_id::text,
    jsonb_build_object('from', current_row.status_id, 'to', target_status_id, 'to_code', to_code)
  );
end;
$$;

alter table public.device_warranties enable row level security;

drop policy if exists device_warranties_select on public.device_warranties;
create policy device_warranties_select
  on public.device_warranties
  for select
  to authenticated
  using (public.has_permission('devices:read') or public.has_permission('orders:read'));

grant select on public.device_list_items to authenticated;

revoke all on function public.warranty_status(date, date) from public;
revoke all on function public.assert_device_classification(uuid, uuid, uuid, uuid) from public;
revoke all on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.device_warranty_json(uuid) from public;
revoke all on function public.device_repairs_json(uuid, integer) from public;
revoke all on function public.device_payload(uuid, integer) from public;
revoke all on function public.search_device_serial(text) from public;
revoke all on function public.get_device_card(uuid) from public;
revoke all on function public.get_warranty_defaults() from public;
revoke all on function public.change_order_status(uuid, uuid, date, date) from public;

grant execute on function public.create_device(text, uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_device(uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.search_device_serial(text) to authenticated;
grant execute on function public.get_device_card(uuid) to authenticated;
grant execute on function public.get_warranty_defaults() to authenticated;
grant execute on function public.change_order_status(uuid, uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- [7/18 | was 7/151] 20260825600000_diagnostics.sql
-- -----------------------------------------------------------------------------

-- Диагностика заказа: инженер, журнал, группы полей, единое сохранение.

alter table public.dynamic_fields
  add column if not exists group_name text not null default '';

alter table public.order_diagnostics
  add column if not exists engineer_id uuid references public.profiles (id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

update public.order_diagnostics
set created_by = coalesce(created_by, updated_by)
where created_by is null;

create table if not exists public.order_journal_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_journal_events_order_idx
  on public.order_journal_events (order_id, created_at desc);

create or replace function public.forbid_order_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Записи журнала нельзя изменять.';
end;
$$;

drop trigger if exists order_journal_events_no_update on public.order_journal_events;
create trigger order_journal_events_no_update
  before update or delete on public.order_journal_events
  for each row execute procedure public.forbid_order_journal_mutation();

create or replace view public.order_diagnostics_items
with (security_invoker = true) as
select
  d.order_id,
  d.engineer_id,
  coalesce(eng.full_name, eng.email, '') as engineer_name,
  d.conclusion,
  d.created_at,
  d.created_by,
  d.updated_at,
  d.updated_by,
  coalesce(upd.full_name, upd.email, '') as updated_by_name
from public.order_diagnostics d
left join public.profiles eng on eng.id = d.engineer_id
left join public.profiles upd on upd.id = d.updated_by;

update public.dynamic_fields
set group_name = 'Осмотр'
where entity_code = 'diagnostics' and code = 'leak_test' and group_name = '';

update public.dynamic_fields
set group_name = 'Измерения'
where entity_code = 'diagnostics' and code = 'working_hours' and group_name = '';

update public.dynamic_fields
set group_name = 'Комментарии'
where entity_code = 'diagnostics' and code = 'notes' and group_name = '';

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
values
  ('diagnostics', 'bending_section', 'Состояние изгибателя', 'select', false, 3, 'Осмотр'),
  ('diagnostics', 'insertion_tube', 'Введенная трубка', 'select', false, 4, 'Осмотр'),
  ('diagnostics', 'image_quality', 'Качество изображения', 'select', false, 5, 'Изображение'),
  ('diagnostics', 'light_output', 'Свет', 'select', false, 6, 'Изображение')
on conflict do nothing;

insert into public.dynamic_field_options (field_id, code, label, sort_order)
select f.id, o.code, o.label, o.sort_order
from public.dynamic_fields f
join (
  values
    ('bending_section', 'ok', 'В норме', 0),
    ('bending_section', 'stiff', 'Тугой ход', 1),
    ('bending_section', 'defect', 'Дефект', 2),
    ('insertion_tube', 'ok', 'В норме', 0),
    ('insertion_tube', 'scratches', 'Царапины', 1),
    ('insertion_tube', 'damage', 'Повреждение', 2),
    ('image_quality', 'good', 'Хорошее', 0),
    ('image_quality', 'noise', 'Помехи', 1),
    ('image_quality', 'no_image', 'Нет изображения', 2),
    ('light_output', 'normal', 'Нормальный', 0),
    ('light_output', 'dim', 'Слабый', 1),
    ('light_output', 'none', 'Нет света', 2)
) as o(field_code, code, label, sort_order) on true
where f.entity_code = 'diagnostics' and f.code = o.field_code
on conflict do nothing;

drop function if exists public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb);

create function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb,
  group_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  normalized_code text;
  normalized_name text;
  normalized_group text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));
  normalized_group := left(btrim(coalesce(group_name, '')), 80);

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);
    if usage_count > 0 and current_row.field_type <> p_type then
      raise exception 'Нельзя сменить тип поля, которое уже используется в данных.';
    end if;

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = p_type,
      is_required = p_required,
      group_name = normalized_group
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order, group_name)
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort,
      normalized_group
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object('entity_code', p_entity, 'code', normalized_code, 'field_type', p_type)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

create or replace function public.get_available_order_transitions(target_order_id uuid)
returns table (
  transition_id uuid,
  to_status_id uuid,
  to_status_code text,
  to_status_name text,
  required_permission text,
  is_allowed boolean,
  block_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  rec record;
  allowed boolean;
  reason text;
  rule_code text;
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав.';
  end if;

  select * into current_row from public.orders where id = target_order_id;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  for rec in
    select tr.id, tr.to_status_id, tr.required_permission, i.code, i.name
    from public.order_status_transitions tr
    join public.reference_items i on i.id = tr.to_status_id
    where tr.from_status_id = current_row.status_id
      and tr.is_active = true
    order by tr.sort_order, i.sort_order
  loop
    allowed := public.has_permission(rec.required_permission);
    reason := null;

    if not allowed then
      reason := 'Недостаточно прав для этого перехода.';
    else
      for rule_code in
        select r.rule_code from public.order_transition_rules r where r.transition_id = rec.id
      loop
        if not public.transition_rule_passed(rule_code, current_row) then
          allowed := false;
          if rule_code = 'diagnostics_conclusion' then
            reason := 'Сначала заполните заключение диагностики.';
          elsif rule_code = 'responsible_assigned' then
            reason := 'Назначьте ответственного сотрудника.';
          else
            reason := 'Не выполнено условие перехода.';
          end if;
          exit;
        end if;
      end loop;
    end if;

    transition_id := rec.id;
    to_status_id := rec.to_status_id;
    to_status_code := rec.code;
    to_status_name := rec.name;
    required_permission := rec.required_permission;
    is_allowed := allowed;
    block_reason := reason;
    return next;
  end loop;
end;
$$;

drop function if exists public.save_order_diagnostics(uuid, text);

create function public.save_order_diagnostics(
  target_order_id uuid,
  conclusion text,
  target_engineer_id uuid default null,
  field_values jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  was_new boolean;
  old_conclusion text := '';
  old_engineer uuid;
  old_fields jsonb := '{}'::jsonb;
  new_conclusion text;
  changes jsonb := '[]'::jsonb;
  field_row record;
  old_value jsonb;
  new_value jsonb;
begin
  if not public.has_permission('diagnostics:update') then
    raise exception 'Недостаточно прав для записи диагностики.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if target_engineer_id is not null and not exists (
    select 1 from public.profiles where id = target_engineer_id and is_active = true
  ) then
    raise exception 'Выберите действующего инженера.';
  end if;

  new_conclusion := btrim(coalesce(conclusion, ''));
  was_new := not exists (select 1 from public.order_diagnostics where order_id = target_order_id);

  if not was_new then
    select d.conclusion, d.engineer_id
      into old_conclusion, old_engineer
    from public.order_diagnostics d
    where d.order_id = target_order_id;

    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_order_id
    where f.entity_code = 'diagnostics';
  end if;

  insert into public.order_diagnostics (
    order_id, conclusion, engineer_id, created_by, updated_by, created_at, updated_at
  )
  values (
    target_order_id, new_conclusion, target_engineer_id, auth.uid(), auth.uid(), now(), now()
  )
  on conflict (order_id) do update
    set conclusion = excluded.conclusion,
        engineer_id = excluded.engineer_id,
        updated_by = excluded.updated_by,
        updated_at = now();

  perform public.save_dynamic_field_values('diagnostics', target_order_id, coalesce(field_values, '{}'::jsonb));

  if coalesce(old_conclusion, '') is distinct from new_conclusion then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'conclusion',
      'label', 'Заключение',
      'from', left(coalesce(old_conclusion, ''), 200),
      'to', left(new_conclusion, 200)
    ));
  end if;

  if old_engineer is distinct from target_engineer_id then
    changes := changes || jsonb_build_array(jsonb_build_object(
      'field', 'engineer_id',
      'label', 'Инженер',
      'from', (select coalesce(full_name, email, '') from public.profiles where id = old_engineer),
      'to', (select coalesce(full_name, email, '') from public.profiles where id = target_engineer_id)
    ));
  end if;

  for field_row in
    select f.code, f.name
    from public.dynamic_fields f
    where f.entity_code = 'diagnostics' and f.is_active = true
    order by f.sort_order, f.name
  loop
    old_value := old_fields -> field_row.code;
    new_value := coalesce(field_values, '{}'::jsonb) -> field_row.code;
    if old_value = 'null'::jsonb then
      old_value := null;
    end if;
    if new_value = 'null'::jsonb or (jsonb_typeof(new_value) = 'string' and btrim(new_value #>> '{}') = '') then
      new_value := null;
    end if;
    if old_value is distinct from new_value then
      changes := changes || jsonb_build_array(jsonb_build_object(
        'field', field_row.code,
        'label', field_row.name,
        'from', old_value,
        'to', new_value
      ));
    end if;
  end loop;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    case when was_new then 'diagnostics_created' else 'diagnostics_updated' end,
    auth.uid(),
    case when was_new then 'Создана диагностика' else 'Обновлена диагностика' end,
    jsonb_build_object('changes', changes)
  );

  perform public.record_audit(
    case when was_new then 'orders.diagnostics_created' else 'orders.diagnostics_updated' end,
    'order',
    target_order_id::text,
    jsonb_build_object('changes', changes)
  );
end;
$$;

create or replace function public.get_order_journal(target_order_id uuid)
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
begin
  if not (public.has_permission('orders:read') or public.has_permission('diagnostics:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return query
  select *
  from (
    select
      e.id,
      e.event_type,
      e.summary,
      e.actor_id,
      coalesce(p.full_name, p.email, '') as actor_name,
      e.payload,
      e.created_at
    from public.order_journal_events e
    left join public.profiles p on p.id = e.actor_id
    where e.order_id = target_order_id

    union all

    select
      s.id,
      'status_changed'::text,
      case
        when s.from_status_id is null then coalesce(s.metadata ->> 'to_name', t.name)
        else coalesce(s.metadata ->> 'from_name', f.name, '') || ' → ' || coalesce(s.metadata ->> 'to_name', t.name)
      end,
      s.actor_id,
      coalesce(ap.full_name, ap.email, ''),
      s.metadata,
      s.created_at
    from public.order_status_events s
    left join public.reference_items f on f.id = s.from_status_id
    left join public.reference_items t on t.id = s.to_status_id
    left join public.profiles ap on ap.id = s.actor_id
    where s.order_id = target_order_id
  ) events
  order by events.created_at desc, events.id desc;
end;
$$;

alter table public.order_journal_events enable row level security;

drop policy if exists order_journal_events_select on public.order_journal_events;
create policy order_journal_events_select
  on public.order_journal_events
  for select
  to authenticated
  using (public.has_permission('orders:read') or public.has_permission('diagnostics:read'));

grant select on public.order_diagnostics_items to authenticated;
grant select on public.order_journal_events to authenticated;

revoke all on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text) from public;
revoke all on function public.save_order_diagnostics(uuid, text, uuid, jsonb) from public;
revoke all on function public.get_order_journal(uuid) from public;
revoke all on function public.forbid_order_journal_mutation() from public;

grant execute on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text) to authenticated;
grant execute on function public.save_order_diagnostics(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.get_order_journal(uuid) to authenticated;
grant execute on function public.get_available_order_transitions(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [8/18 | was 8/151] 20260825700000_customers.sql
-- -----------------------------------------------------------------------------

-- Клиенты: организация/физлицо, реквизиты, поиск, карточка, история.

alter table public.customers
  add column if not exists kind text not null default 'organization',
  add column if not exists kpp text not null default '',
  add column if not exists ogrn text not null default '',
  add column if not exists contact_name text not null default '';

alter table public.customers drop constraint if exists customers_kind_check;
alter table public.customers
  add constraint customers_kind_check check (kind in ('organization', 'individual'));

create index if not exists customers_phone_idx on public.customers (lower(phone));
create index if not exists customers_email_idx on public.customers (lower(email));
create index if not exists customers_kpp_idx on public.customers (kpp);
create index if not exists customers_ogrn_idx on public.customers (ogrn);
create index if not exists customers_contact_idx on public.customers (lower(contact_name));

update public.dynamic_fields
set is_active = false
where entity_code = 'customers' and code = 'inn' and is_active = true;

drop function if exists public.create_customer(text, text, text, text, text);

create function public.create_customer(
  customer_name text,
  customer_kind text default 'organization',
  customer_inn text default '',
  customer_kpp text default '',
  customer_ogrn text default '',
  customer_phone text default '',
  customer_email text default '',
  customer_city text default '',
  customer_contact_name text default '',
  customer_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  normalized_name text;
  normalized_kind text;
begin
  if not public.has_permission('customers:create') then
    raise exception 'Недостаточно прав для создания клиента.';
  end if;

  normalized_name := btrim(coalesce(customer_name, ''));
  if char_length(normalized_name) < 1 then
    raise exception 'Укажите название или ФИО клиента.';
  end if;

  normalized_kind := btrim(coalesce(customer_kind, 'organization'));
  if normalized_kind not in ('organization', 'individual') then
    raise exception 'Укажите тип клиента.';
  end if;

  insert into public.customers (
    name, kind, inn, kpp, ogrn, phone, email, city, contact_name, notes
  )
  values (
    normalized_name,
    normalized_kind,
    btrim(coalesce(customer_inn, '')),
    btrim(coalesce(customer_kpp, '')),
    btrim(coalesce(customer_ogrn, '')),
    btrim(coalesce(customer_phone, '')),
    btrim(coalesce(customer_email, '')),
    btrim(coalesce(customer_city, '')),
    btrim(coalesce(customer_contact_name, '')),
    btrim(coalesce(customer_notes, ''))
  )
  returning id into result_id;

  perform public.record_audit(
    'customers.created',
    'customer',
    result_id::text,
    jsonb_build_object('name', normalized_name, 'kind', normalized_kind)
  );
  return result_id;
end;
$$;

create or replace function public.update_customer(
  target_customer_id uuid,
  customer_name text,
  customer_kind text default 'organization',
  customer_inn text default '',
  customer_kpp text default '',
  customer_ogrn text default '',
  customer_phone text default '',
  customer_email text default '',
  customer_city text default '',
  customer_contact_name text default '',
  customer_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text;
  normalized_kind text;
begin
  if not public.has_permission('customers:update') then
    raise exception 'Недостаточно прав для изменения клиента.';
  end if;

  if not exists (select 1 from public.customers where id = target_customer_id) then
    raise exception 'Клиент не найден.';
  end if;

  normalized_name := btrim(coalesce(customer_name, ''));
  if char_length(normalized_name) < 1 then
    raise exception 'Укажите название или ФИО клиента.';
  end if;

  normalized_kind := btrim(coalesce(customer_kind, 'organization'));
  if normalized_kind not in ('organization', 'individual') then
    raise exception 'Укажите тип клиента.';
  end if;

  update public.customers
  set
    name = normalized_name,
    kind = normalized_kind,
    inn = btrim(coalesce(customer_inn, '')),
    kpp = btrim(coalesce(customer_kpp, '')),
    ogrn = btrim(coalesce(customer_ogrn, '')),
    phone = btrim(coalesce(customer_phone, '')),
    email = btrim(coalesce(customer_email, '')),
    city = btrim(coalesce(customer_city, '')),
    contact_name = btrim(coalesce(customer_contact_name, '')),
    notes = btrim(coalesce(customer_notes, ''))
  where id = target_customer_id;

  perform public.record_audit(
    'customers.updated',
    'customer',
    target_customer_id::text,
    jsonb_build_object('name', normalized_name, 'kind', normalized_kind)
  );
end;
$$;

create or replace function public.search_customers(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  active_only boolean default false
)
returns table (
  id uuid,
  kind text,
  name text,
  inn text,
  kpp text,
  ogrn text,
  phone text,
  email text,
  city text,
  contact_name text,
  notes text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  safe_page integer;
  safe_size integer;
begin
  if not (
    public.has_permission('customers:read')
    or public.has_permission('orders:read')
    or public.has_permission('orders:create')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  term := replace(replace(btrim(coalesce(search_query, '')), '%', ''), '_', '');
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    c.id,
    c.kind,
    c.name,
    c.inn,
    c.kpp,
    c.ogrn,
    c.phone,
    c.email,
    c.city,
    c.contact_name,
    c.notes,
    c.is_active,
    c.created_at,
    c.updated_at,
    count(*) over() as total_count
  from public.customers c
  where (not active_only or c.is_active = true)
    and (
      term = ''
      or c.name ilike '%' || term || '%'
      or c.contact_name ilike '%' || term || '%'
      or c.phone ilike '%' || term || '%'
      or c.email ilike '%' || term || '%'
      or c.inn ilike '%' || term || '%'
      or c.kpp ilike '%' || term || '%'
      or c.ogrn ilike '%' || term || '%'
      or c.city ilike '%' || term || '%'
    )
  order by c.name, c.created_at
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.find_customers_by_inn(
  inn_query text,
  exclude_id uuid default null
)
returns table (
  id uuid,
  name text,
  kind text,
  inn text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
begin
  if not (
    public.has_permission('customers:read')
    or public.has_permission('customers:create')
    or public.has_permission('customers:update')
    or public.has_permission('orders:create')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  term := btrim(coalesce(inn_query, ''));
  if term = '' then
    return;
  end if;

  return query
  select c.id, c.name, c.kind, c.inn
  from public.customers c
  where lower(btrim(c.inn)) = lower(term)
    and (exclude_id is null or c.id <> exclude_id)
  order by c.name
  limit 8;
end;
$$;

create or replace function public.get_customer_card(target_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  if not (public.has_permission('customers:read') or public.has_permission('orders:read')) then
    raise exception 'Недостаточно прав.';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'name', c.name,
    'inn', c.inn,
    'kpp', c.kpp,
    'ogrn', c.ogrn,
    'phone', c.phone,
    'email', c.email,
    'city', c.city,
    'contact_name', c.contact_name,
    'notes', c.notes,
    'is_active', c.is_active,
    'created_at', c.created_at,
    'updated_at', c.updated_at
  )
  into payload
  from public.customers c
  where c.id = target_customer_id;

  if payload is null then
    return null;
  end if;

  return jsonb_build_object(
    'customer', payload,
    'devices', coalesce(
      (
        select jsonb_agg(item order by item ->> 'serial_number')
        from (
          select distinct on (d.id) jsonb_build_object(
            'id', d.id,
            'serial_number', d.serial_number,
            'label', coalesce(li.label, d.serial_number),
            'group_name', coalesce(li.group_name, ''),
            'brand_name', coalesce(li.brand_name, ''),
            'model_name', coalesce(li.model_name, '')
          ) as item
          from public.devices d
          left join public.device_list_items li on li.id = d.id
          where d.customer_id = target_customer_id
            or exists (
              select 1 from public.orders o
              where o.customer_id = target_customer_id and o.device_id = d.id
            )
          order by d.id, d.serial_number
        ) devices
      ),
      '[]'::jsonb
    ),
    'orders', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'number', o.number,
          'serial_number', o.serial_number,
          'device_label', o.device_label,
          'status_name', o.status_name,
          'status_code', o.status_code,
          'created_at', o.created_at
        ) order by o.created_at desc)
        from (
          select *
          from public.order_list_items
          where customer_id = target_customer_id
          order by created_at desc
          limit 50
        ) o
      ),
      '[]'::jsonb
    ),
    'history', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'action', e.action,
          'actor_name', coalesce(p.full_name, p.email, ''),
          'metadata', e.metadata,
          'created_at', e.created_at
        ) order by e.created_at desc)
        from (
          select *
          from public.audit_events
          where entity_type = 'customer' and entity_id = target_customer_id::text
          order by created_at desc
          limit 50
        ) e
        left join public.profiles p on p.id = e.actor_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.create_customer(text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.update_customer(uuid, text, text, text, text, text, text, text, text, text, text) from public;
revoke all on function public.search_customers(text, integer, integer, boolean) from public;
revoke all on function public.find_customers_by_inn(text, uuid) from public;
revoke all on function public.get_customer_card(uuid) from public;

grant execute on function public.create_customer(text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_customer(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.search_customers(text, integer, integer, boolean) to authenticated;
grant execute on function public.find_customers_by_inn(text, uuid) to authenticated;
grant execute on function public.get_customer_card(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [9/18 | was 9/151] 20260825800000_inventory.sql
-- -----------------------------------------------------------------------------

-- Эндотека: склад. Остаток считается по журналу движений.
-- remaining_quantity на партии — кэш, который обновляет только триггер журнала.
-- Списание FIFO выполняется одной SECURITY DEFINER-транзакцией, не серией запросов с клиента.

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code in ('inventory:read', 'inventory:write_off')
where r.code = 'diagnostic_engineer'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.permission_id = p.id
  );

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'inventory:write_off'
where r.code = 'chief_engineer'
  and not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = r.id and rp.permission_id = p.id
  );

create sequence if not exists public.inventory_item_code_seq;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  article text not null default '',
  barcode text not null default '',
  name text not null,
  category_id uuid not null references public.reference_items (id) on delete restrict,
  unit_id uuid not null references public.reference_items (id) on delete restrict,
  purchase_price numeric(14, 2) not null default 0 check (purchase_price >= 0),
  repair_price numeric(14, 2) not null default 0 check (repair_price >= 0),
  retail_price numeric(14, 2) not null default 0 check (retail_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_name_present check (btrim(name) <> ''),
  constraint inventory_items_code_present check (btrim(code) <> '')
);

create unique index if not exists inventory_items_name_unique
  on public.inventory_items (lower(btrim(name)));

create index if not exists inventory_items_barcode_idx
  on public.inventory_items (barcode)
  where barcode <> '';

create index if not exists inventory_items_article_idx
  on public.inventory_items (lower(article));

create index if not exists inventory_items_code_idx
  on public.inventory_items (lower(code));

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute procedure public.set_updated_at();

create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  receipt_date date not null,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_receipts_supplier_present check (btrim(supplier) <> '')
);

create index if not exists inventory_receipts_created_at_idx
  on public.inventory_receipts (created_at desc);

create table if not exists public.inventory_sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  reason text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustments_reason_present check (btrim(reason) <> '')
);

create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  receipt_id uuid references public.inventory_receipts (id) on delete restrict,
  supplier text not null default '',
  receipt_date date not null,
  purchase_price numeric(14, 2) not null check (purchase_price >= 0),
  quantity numeric(14, 3) not null check (quantity > 0),
  remaining_quantity numeric(14, 3) not null default 0,
  created_at timestamptz not null default now(),
  constraint inventory_batches_remaining_check check (
    remaining_quantity >= 0 and remaining_quantity <= quantity
  )
);

create index if not exists inventory_batches_fifo_idx
  on public.inventory_batches (item_id, receipt_date, created_at, id)
  where remaining_quantity > 0;

create index if not exists inventory_batches_item_idx
  on public.inventory_batches (item_id);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  batch_id uuid not null references public.inventory_batches (id) on delete restrict,
  quantity numeric(14, 3) not null,
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  movement_type text not null,
  reference_type text not null,
  reference_id uuid not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_quantity_nonzero check (quantity <> 0),
  constraint inventory_movements_type_check check (
    movement_type in ('receipt', 'repair_consumption', 'sale', 'inventory_adjustment')
  ),
  constraint inventory_movements_reference_check check (
    reference_type in ('receipt', 'order', 'sale', 'inventory_adjustment')
  )
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id, created_at desc);

create index if not exists inventory_movements_batch_idx
  on public.inventory_movements (batch_id, created_at);

create index if not exists inventory_movements_reference_idx
  on public.inventory_movements (reference_type, reference_id);

create or replace function public.prevent_inventory_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Движения склада нельзя изменять или удалять.';
end;
$$;

drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable
  before update or delete on public.inventory_movements
  for each row execute procedure public.prevent_inventory_movement_mutation();

create or replace function public.protect_inventory_batch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Партию нельзя удалить.';
  end if;

  if new.item_id is distinct from old.item_id
     or new.receipt_id is distinct from old.receipt_id
     or new.supplier is distinct from old.supplier
     or new.receipt_date is distinct from old.receipt_date
     or new.purchase_price is distinct from old.purchase_price
     or new.quantity is distinct from old.quantity then
    raise exception 'Партию нельзя изменять.';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_batches_protect on public.inventory_batches;
create trigger inventory_batches_protect
  before update or delete on public.inventory_batches
  for each row execute procedure public.protect_inventory_batch();

create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_batches
  set remaining_quantity = remaining_quantity + new.quantity
  where id = new.batch_id;

  if not found then
    raise exception 'Партия не найдена.';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_movements_apply on public.inventory_movements;
create trigger inventory_movements_apply
  after insert on public.inventory_movements
  for each row execute procedure public.apply_inventory_movement();

create or replace function public.assert_inventory_category(target_category_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = target_category_id
      and s.code = 'inventory_categories'
      and i.is_active = true
  ) then
    raise exception 'Выберите категорию из справочника склада.';
  end if;
end;
$$;

create or replace function public.assert_inventory_unit(target_unit_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  unit_code text;
begin
  select i.code
    into unit_code
  from public.reference_items i
  join public.reference_sets s on s.id = i.set_id
  where i.id = target_unit_id
    and s.code = 'units_of_measure'
    and i.is_active = true;

  if unit_code is null then
    raise exception 'Выберите единицу измерения.';
  end if;

  if unit_code not in ('pcs', 'pack') then
    raise exception 'Допустимые единицы: шт и упак.';
  end if;
end;
$$;

create or replace function public.can_read_inventory()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('inventory:read')
      or public.has_permission('inventory:receive')
      or public.has_permission('inventory:write_off')
      or public.has_permission('inventory:inventory_count');
$$;

create or replace function public.raise_inventory_name_duplicate(item_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from public.inventory_items
  where lower(btrim(name)) = lower(btrim(item_name))
  limit 1;

  raise exception 'Такое наименование уже в справочнике'
    using hint = coalesce(existing_id::text, '');
end;
$$;

create or replace function public.create_inventory_item(
  item_name text,
  item_code text default '',
  item_article text default '',
  item_barcode text default '',
  item_category_id uuid default null,
  item_unit_id uuid default null,
  item_purchase_price numeric default 0,
  item_repair_price numeric default 0,
  item_retail_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для создания номенклатуры.';
  end if;

  if btrim(coalesce(item_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null then
    raise exception 'Выберите категорию.';
  end if;

  if item_unit_id is null then
    raise exception 'Выберите единицу измерения.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or coalesce(item_repair_price, 0) < 0 or coalesce(item_retail_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    next_code := 'N-' || lpad(nextval('public.inventory_item_code_seq')::text, 6, '0');
  end if;

  insert into public.inventory_items (
    code, article, barcode, name, category_id, unit_id, purchase_price, repair_price, retail_price
  )
  values (
    next_code,
    btrim(coalesce(item_article, '')),
    btrim(coalesce(item_barcode, '')),
    btrim(item_name),
    item_category_id,
    item_unit_id,
    coalesce(item_purchase_price, 0),
    coalesce(item_repair_price, 0),
    coalesce(item_retail_price, 0)
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object('name', btrim(item_name), 'code', next_code)
  );

  return result_id;
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
    return null;
end;
$$;

create or replace function public.update_inventory_item(
  target_item_id uuid,
  item_name text,
  item_code text default '',
  item_article text default '',
  item_barcode text default '',
  item_category_id uuid default null,
  item_unit_id uuid default null,
  item_purchase_price numeric default 0,
  item_repair_price numeric default 0,
  item_retail_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code text;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения номенклатуры.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if btrim(coalesce(item_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null or item_unit_id is null then
    raise exception 'Категория и единица измерения обязательны.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or coalesce(item_repair_price, 0) < 0 or coalesce(item_retail_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    select code into next_code from public.inventory_items where id = target_item_id;
  end if;

  update public.inventory_items
  set
    code = next_code,
    article = btrim(coalesce(item_article, '')),
    barcode = btrim(coalesce(item_barcode, '')),
    name = btrim(item_name),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = coalesce(item_repair_price, 0),
    retail_price = coalesce(item_retail_price, 0)
  where id = target_item_id;

  perform public.record_audit(
    'inventory.item_updated',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', btrim(item_name), 'code', next_code)
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

create or replace function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  safe_page integer;
  safe_size integer;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра склада.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  with stock as (
    select m.item_id, coalesce(sum(m.quantity), 0) as qty
    from public.inventory_movements m
    group by m.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where btrim(coalesce(search_query, '')) = ''
     or i.name ilike term escape '\'
     or i.code ilike term escape '\'
     or i.article ilike term escape '\'
     or i.barcode ilike term escape '\'
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.find_inventory_item_by_name(name_query text, exclude_id uuid default null)
returns table (id uuid, name text, code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('inventory:receive')
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if btrim(coalesce(name_query, '')) = '' then
    return;
  end if;

  return query
  select i.id, i.name, i.code
  from public.inventory_items i
  where lower(btrim(i.name)) = lower(btrim(name_query))
    and (exclude_id is null or i.id <> exclude_id)
  limit 5;
end;
$$;

create or replace function public.find_inventory_items_by_barcode(barcode_query text)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  code_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для поиска по штрихкоду.';
  end if;

  code_value := btrim(coalesce(barcode_query, ''));
  if code_value = '' then
    return;
  end if;

  return query
  with stock as (
    select m.item_id, coalesce(sum(m.quantity), 0) as qty
    from public.inventory_movements m
    group by m.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where i.barcode = code_value
     or i.code = code_value
  order by i.name
  limit 20;
end;
$$;

create or replace function public.consume_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  available numeric;
  remaining numeric;
  take numeric;
  batch_row public.inventory_batches%rowtype;
  movement_id uuid;
  lines jsonb := '[]'::jsonb;
begin
  if consume_quantity is null or consume_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  select coalesce(sum(remaining_quantity), 0)
    into available
  from public.inventory_batches
  where item_id = target_item_id;

  if available < consume_quantity then
    raise exception 'Недостаточно остатка. Доступно: %, запрошено: %.', available, consume_quantity;
  end if;

  remaining := consume_quantity;

  for batch_row in
    select *
    from public.inventory_batches
    where item_id = target_item_id
      and remaining_quantity > 0
    order by receipt_date asc, created_at asc, id asc
    for update
  loop
    exit when remaining <= 0;

    take := least(batch_row.remaining_quantity, remaining);

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      batch_row.id,
      -take,
      batch_row.purchase_price,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', batch_row.id,
      'quantity', take,
      'unit_price', batch_row.purchase_price,
      'receipt_date', batch_row.receipt_date
    ));

    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    raise exception 'Недостаточно остатка.';
  end if;

  return jsonb_build_object(
    'item_id', target_item_id,
    'quantity', consume_quantity,
    'lines', lines
  );
end;
$$;

create or replace function public.receive_inventory(
  supplier_name text,
  doc_receipt_date date,
  doc_notes text,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_id uuid;
  line record;
  batch_id uuid;
  line_count integer := 0;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  if btrim(coalesce(supplier_name, '')) = '' then
    raise exception 'Укажите поставщика.';
  end if;

  if doc_receipt_date is null then
    raise exception 'Укажите дату прихода.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(lines, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  insert into public.inventory_receipts (supplier, receipt_date, notes, created_by)
  values (btrim(supplier_name), doc_receipt_date, btrim(coalesce(doc_notes, '')), auth.uid())
  returning id into receipt_id;

  for line in
    select *
    from jsonb_to_recordset(lines) as x(
      item_id uuid,
      quantity numeric,
      purchase_price numeric
    )
  loop
    line_count := line_count + 1;

    if line.item_id is null then
      raise exception 'В строке прихода не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция прихода не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 then
      raise exception 'Количество в приходе должно быть больше нуля.';
    end if;

    if line.purchase_price is null or line.purchase_price < 0 then
      raise exception 'Цена закупки не может быть отрицательной.';
    end if;

    perform pg_advisory_xact_lock(871001, hashtext(line.item_id::text));

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      line.item_id,
      receipt_id,
      btrim(supplier_name),
      doc_receipt_date,
      line.purchase_price,
      line.quantity,
      0
    )
    returning id into batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      line.item_id,
      batch_id,
      line.quantity,
      line.purchase_price,
      'receipt',
      'receipt',
      receipt_id,
      auth.uid()
    );
  end loop;

  if line_count = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  perform public.record_audit(
    'inventory.received',
    'inventory_receipt',
    receipt_id::text,
    jsonb_build_object('supplier', btrim(supplier_name), 'lines', line_count)
  );

  return receipt_id;
end;
$$;

create or replace function public.consume_inventory_for_order(
  target_order_id uuid,
  target_item_id uuid,
  consume_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания в ремонт.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  result := public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'repair_consumption',
    'order',
    target_order_id
  );

  perform public.record_audit(
    'inventory.consumed_repair',
    'order',
    target_order_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity)
  );

  return result;
end;
$$;

create or replace function public.consume_inventory_for_sale(
  target_item_id uuid,
  consume_quantity numeric,
  invoice_number text default '',
  sale_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_id uuid;
begin
  if not (public.has_permission('inventory:write_off') or public.has_permission('sales:create')) then
    raise exception 'Недостаточно прав для продажи со склада.';
  end if;

  insert into public.inventory_sales (invoice_number, notes, created_by)
  values (btrim(coalesce(invoice_number, '')), btrim(coalesce(sale_notes, '')), auth.uid())
  returning id into sale_id;

  perform public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'sale',
    'sale',
    sale_id
  );

  perform public.record_audit(
    'inventory.sold',
    'inventory_sale',
    sale_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity, 'invoice_number', btrim(coalesce(invoice_number, '')))
  );

  return sale_id;
end;
$$;

create or replace function public.adjust_inventory(
  target_item_id uuid,
  quantity_delta numeric,
  reason_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  adjustment_id uuid;
  batch_id uuid;
  item_price numeric;
begin
  if not public.has_permission('inventory:inventory_count') then
    raise exception 'Недостаточно прав для инвентаризации.';
  end if;

  if btrim(coalesce(reason_text, '')) = '' then
    raise exception 'Укажите причину корректировки.';
  end if;

  if quantity_delta is null or quantity_delta = 0 then
    raise exception 'Количество корректировки не может быть нулевым.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  insert into public.inventory_adjustments (reason, created_by)
  values (btrim(reason_text), auth.uid())
  returning id into adjustment_id;

  if quantity_delta < 0 then
    perform public.consume_inventory_fifo(
      target_item_id,
      abs(quantity_delta),
      'inventory_adjustment',
      'inventory_adjustment',
      adjustment_id
    );
  else
    perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

    select purchase_price into item_price
    from public.inventory_items
    where id = target_item_id;

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      target_item_id,
      null,
      'Инвентаризация',
      current_date,
      coalesce(item_price, 0),
      quantity_delta,
      0
    )
    returning id into batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      batch_id,
      quantity_delta,
      coalesce(item_price, 0),
      'inventory_adjustment',
      'inventory_adjustment',
      adjustment_id,
      auth.uid()
    );
  end if;

  perform public.record_audit(
    'inventory.adjusted',
    'inventory_adjustment',
    adjustment_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity_delta', quantity_delta)
  );

  return adjustment_id;
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'name', i.name,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_inventory_receipts(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  supplier text,
  receipt_date date,
  notes text,
  created_at timestamptz,
  actor_name text,
  line_count bigint,
  total_quantity numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer;
  safe_size integer;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра приходов.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    r.id,
    r.supplier,
    r.receipt_date,
    r.notes,
    r.created_at,
    coalesce(p.full_name, '') as actor_name,
    count(m.id) as line_count,
    coalesce(sum(m.quantity), 0) as total_quantity,
    count(*) over() as total_count
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  left join public.inventory_movements m on m.reference_type = 'receipt' and m.reference_id = r.id
  group by r.id, r.supplier, r.receipt_date, r.notes, r.created_at, p.full_name
  order by r.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_receipt(target_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  header jsonb;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра прихода.';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'supplier', r.supplier,
    'receipt_date', r.receipt_date,
    'notes', r.notes,
    'created_at', r.created_at,
    'actor_name', coalesce(p.full_name, '')
  )
  into header
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  where r.id = target_receipt_id;

  if header is null then
    raise exception 'Приход не найден.';
  end if;

  return header || jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.created_at)
      from (
        select
          m.id,
          m.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          m.quantity,
          m.unit_price,
          m.batch_id,
          b.remaining_quantity,
          m.created_at
        from public.inventory_movements m
        join public.inventory_items i on i.id = m.item_id
        join public.inventory_batches b on b.id = m.batch_id
        where m.reference_type = 'receipt' and m.reference_id = target_receipt_id
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_inventory_adjustments(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  reason text,
  created_at timestamptz,
  actor_name text,
  item_name text,
  quantity numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer;
  safe_size integer;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:inventory_count') then
    raise exception 'Недостаточно прав для просмотра инвентаризации.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    a.id,
    a.reason,
    a.created_at,
    coalesce(p.full_name, '') as actor_name,
    coalesce(string_agg(distinct i.name, ', '), '') as item_name,
    coalesce(sum(m.quantity), 0) as quantity,
    count(*) over() as total_count
  from public.inventory_adjustments a
  left join public.profiles p on p.id = a.created_by
  left join public.inventory_movements m on m.reference_type = 'inventory_adjustment' and m.reference_id = a.id
  left join public.inventory_items i on i.id = m.item_id
  group by a.id, a.reason, a.created_at, p.full_name
  order by a.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_order_inventory_usage(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('orders:read')
    or public.can_read_inventory()
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        m.id,
        m.item_id,
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        i.barcode as item_barcode,
        coalesce(u.name, '') as unit_name,
        m.quantity,
        m.unit_price,
        m.batch_id,
        b.receipt_date as batch_receipt_date,
        b.supplier as batch_supplier,
        coalesce(p.full_name, '') as actor_name,
        m.created_at
      from public.inventory_movements m
      join public.inventory_items i on i.id = m.item_id
      join public.inventory_batches b on b.id = m.batch_id
      left join public.reference_items u on u.id = i.unit_id
      left join public.profiles p on p.id = m.created_by
      where m.reference_type = 'order' and m.reference_id = target_order_id
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.save_dynamic_field_values(
  target_entity_code text,
  target_record_id uuid,
  field_values jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  raw jsonb;
  permission_code text;
begin
  if not public.is_active_user() then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.field_entities where code = target_entity_code) then
    raise exception 'Раздел карточки не найден.';
  end if;

  permission_code := target_entity_code || ':update';
  if target_entity_code = 'diagnostics' then
    permission_code := 'diagnostics:update';
  end if;
  if target_entity_code = 'inventory' then
    permission_code := 'inventory:receive';
  end if;

  if not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  for field_row in
    select *
    from public.dynamic_fields
    where entity_code = target_entity_code
      and is_active = true
  loop
    raw := field_values -> field_row.code;
    perform public.validate_dynamic_field_value(field_row.id, raw);

    if raw is null or raw = 'null'::jsonb or (jsonb_typeof(raw) = 'string' and btrim(raw #>> '{}') = '') then
      delete from public.dynamic_field_values
      where field_id = field_row.id
        and record_id = target_record_id;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
    end if;
  end loop;
end;
$$;

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.reference_items where parent_id = target_item_id) +
    (select count(*) from public.orders where status_id = target_item_id) +
    (select count(*) from public.devices where group_id = target_item_id or brand_id = target_item_id or model_id = target_item_id or modification_id = target_item_id) +
    (select count(*) from public.inventory_items where category_id = target_item_id or unit_id = target_item_id)
  )::integer;
$$;

alter table public.inventory_items enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_sales enable row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_items_select on public.inventory_items;
create policy inventory_items_select
  on public.inventory_items
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('orders:read') or public.has_permission('orders:update'));

drop policy if exists inventory_receipts_select on public.inventory_receipts;
create policy inventory_receipts_select
  on public.inventory_receipts
  for select
  to authenticated
  using (public.has_permission('inventory:read') or public.has_permission('inventory:receive'));

drop policy if exists inventory_sales_select on public.inventory_sales;
create policy inventory_sales_select
  on public.inventory_sales
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('sales:read'));

drop policy if exists inventory_adjustments_select on public.inventory_adjustments;
create policy inventory_adjustments_select
  on public.inventory_adjustments
  for select
  to authenticated
  using (public.has_permission('inventory:read') or public.has_permission('inventory:inventory_count'));

drop policy if exists inventory_batches_select on public.inventory_batches;
create policy inventory_batches_select
  on public.inventory_batches
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('orders:read'));

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select
  on public.inventory_movements
  for select
  to authenticated
  using (public.can_read_inventory() or public.has_permission('orders:read'));

revoke all on function public.prevent_inventory_movement_mutation() from public;
revoke all on function public.protect_inventory_batch() from public;
revoke all on function public.apply_inventory_movement() from public;
revoke all on function public.assert_inventory_category(uuid) from public;
revoke all on function public.assert_inventory_unit(uuid) from public;
revoke all on function public.can_read_inventory() from public;
revoke all on function public.raise_inventory_name_duplicate(text) from public;
revoke all on function public.consume_inventory_fifo(uuid, numeric, text, text, uuid) from public;
revoke all on function public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric) from public;
revoke all on function public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric) from public;
revoke all on function public.search_inventory_items(text, integer, integer) from public;
revoke all on function public.find_inventory_item_by_name(text, uuid) from public;
revoke all on function public.find_inventory_items_by_barcode(text) from public;
revoke all on function public.receive_inventory(text, date, text, jsonb) from public;
revoke all on function public.consume_inventory_for_order(uuid, uuid, numeric) from public;
revoke all on function public.consume_inventory_for_sale(uuid, numeric, text, text) from public;
revoke all on function public.adjust_inventory(uuid, numeric, text) from public;
revoke all on function public.get_inventory_item_card(uuid) from public;
revoke all on function public.list_inventory_receipts(integer, integer) from public;
revoke all on function public.get_inventory_receipt(uuid) from public;
revoke all on function public.list_inventory_adjustments(integer, integer) from public;
revoke all on function public.get_order_inventory_usage(uuid) from public;

grant execute on function public.create_inventory_item(text, text, text, text, uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.update_inventory_item(uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.search_inventory_items(text, integer, integer) to authenticated;
grant execute on function public.find_inventory_item_by_name(text, uuid) to authenticated;
grant execute on function public.find_inventory_items_by_barcode(text) to authenticated;
grant execute on function public.receive_inventory(text, date, text, jsonb) to authenticated;
grant execute on function public.consume_inventory_for_order(uuid, uuid, numeric) to authenticated;
grant execute on function public.consume_inventory_for_sale(uuid, numeric, text, text) to authenticated;
grant execute on function public.adjust_inventory(uuid, numeric, text) to authenticated;
grant execute on function public.get_inventory_item_card(uuid) to authenticated;
grant execute on function public.list_inventory_receipts(integer, integer) to authenticated;
grant execute on function public.get_inventory_receipt(uuid) to authenticated;
grant execute on function public.list_inventory_adjustments(integer, integer) to authenticated;
grant execute on function public.get_order_inventory_usage(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [10/18 | was 10/151] 20260825900000_inventory_counts.sql
-- -----------------------------------------------------------------------------

-- Эндотека: документы инвентаризации. Расхождения проводятся только журналом движений.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_reference_check;

alter table public.inventory_movements
  add constraint inventory_movements_reference_check check (
    reference_type in ('receipt', 'order', 'sale', 'inventory_adjustment', 'inventory_count')
  );

create sequence if not exists public.inventory_count_number_seq;

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  status text not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint inventory_counts_number_present check (btrim(number) <> ''),
  constraint inventory_counts_status_check check (
    status in ('draft', 'in_progress', 'completed', 'cancelled')
  ),
  constraint inventory_counts_completed_at_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create unique index if not exists inventory_counts_number_unique
  on public.inventory_counts (number);

create index if not exists inventory_counts_created_at_idx
  on public.inventory_counts (created_at desc);

create index if not exists inventory_counts_status_idx
  on public.inventory_counts (status, created_at desc);

create table if not exists public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  expected_quantity numeric(14, 3) not null check (expected_quantity >= 0),
  actual_quantity numeric(14, 3) check (actual_quantity is null or actual_quantity >= 0),
  difference numeric(14, 3) generated always as (actual_quantity - expected_quantity) stored,
  created_at timestamptz not null default now(),
  constraint inventory_count_lines_item_unique unique (count_id, item_id)
);

create index if not exists inventory_count_lines_count_idx
  on public.inventory_count_lines (count_id, created_at);

create index if not exists inventory_count_lines_item_idx
  on public.inventory_count_lines (item_id);

create or replace function public.inventory_item_stock_qty(target_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(quantity), 0)
  from public.inventory_movements
  where item_id = target_item_id;
$$;

create or replace function public.assert_inventory_count_permission()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('inventory:inventory_count') then
    raise exception 'Недостаточно прав для инвентаризации.';
  end if;
end;
$$;

create or replace function public.lock_inventory_count(target_count_id uuid)
returns public.inventory_counts
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  perform public.assert_inventory_count_permission();
  perform pg_advisory_xact_lock(871002, hashtext(target_count_id::text));

  select * into current_row
  from public.inventory_counts
  where id = target_count_id
  for update;

  if current_row.id is null then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  return current_row;
end;
$$;

create or replace function public.assert_inventory_count_editable(current_row public.inventory_counts)
returns void
language plpgsql
stable
as $$
begin
  if current_row.status in ('completed', 'cancelled') then
    raise exception 'Документ закрыт для изменений.';
  end if;
end;
$$;

create or replace function public.mark_inventory_count_in_progress(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_counts
  set status = 'in_progress'
  where id = target_count_id
    and status = 'draft';
end;
$$;

create or replace function public.apply_inventory_quantity_delta(
  target_item_id uuid,
  quantity_delta numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_id uuid;
  item_price numeric;
begin
  if quantity_delta is null or quantity_delta = 0 then
    return;
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if quantity_delta < 0 then
    perform public.consume_inventory_fifo(
      target_item_id,
      abs(quantity_delta),
      target_movement_type,
      target_reference_type,
      target_reference_id
    );
    return;
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  select purchase_price into item_price
  from public.inventory_items
  where id = target_item_id;

  insert into public.inventory_batches (
    item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
  )
  values (
    target_item_id,
    null,
    'Инвентаризация',
    current_date,
    coalesce(item_price, 0),
    quantity_delta,
    0
  )
  returning id into batch_id;

  insert into public.inventory_movements (
    item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
  )
  values (
    target_item_id,
    batch_id,
    quantity_delta,
    coalesce(item_price, 0),
    target_movement_type,
    target_reference_type,
    target_reference_id,
    auth.uid()
  );
end;
$$;

create or replace function public.adjust_inventory(
  target_item_id uuid,
  quantity_delta numeric,
  reason_text text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  adjustment_id uuid;
begin
  perform public.assert_inventory_count_permission();

  if btrim(coalesce(reason_text, '')) = '' then
    raise exception 'Укажите причину корректировки.';
  end if;

  if quantity_delta is null or quantity_delta = 0 then
    raise exception 'Количество корректировки не может быть нулевым.';
  end if;

  insert into public.inventory_adjustments (reason, created_by)
  values (btrim(reason_text), auth.uid())
  returning id into adjustment_id;

  perform public.apply_inventory_quantity_delta(
    target_item_id,
    quantity_delta,
    'inventory_adjustment',
    'inventory_adjustment',
    adjustment_id
  );

  perform public.record_audit(
    'inventory.adjusted',
    'inventory_adjustment',
    adjustment_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity_delta', quantity_delta)
  );

  return adjustment_id;
end;
$$;

create or replace function public.create_inventory_count(
  seed_mode text default 'empty',
  seed_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_number text;
  mode text;
begin
  perform public.assert_inventory_count_permission();

  mode := coalesce(nullif(btrim(seed_mode), ''), 'empty');
  if mode not in ('empty', 'in_stock') then
    raise exception 'Неизвестный способ заполнения документа.';
  end if;

  next_number := 'ИНВ-' || lpad(nextval('public.inventory_count_number_seq')::text, 6, '0');

  insert into public.inventory_counts (number, status, created_by)
  values (next_number, 'draft', auth.uid())
  returning id into result_id;

  if seed_item_id is not null then
    if not exists (select 1 from public.inventory_items where id = seed_item_id) then
      raise exception 'Позиция не найдена.';
    end if;

    insert into public.inventory_count_lines (count_id, item_id, expected_quantity)
    values (result_id, seed_item_id, public.inventory_item_stock_qty(seed_item_id));
  elsif mode = 'in_stock' then
    insert into public.inventory_count_lines (count_id, item_id, expected_quantity)
    select result_id, i.id, stock.qty
    from public.inventory_items i
    join (
      select item_id, coalesce(sum(quantity), 0) as qty
      from public.inventory_movements
      group by item_id
    ) stock on stock.item_id = i.id
    where stock.qty <> 0;
  end if;

  perform public.record_audit(
    'inventory.count_created',
    'inventory_count',
    result_id::text,
    jsonb_build_object('number', next_number, 'seed_mode', mode, 'seed_item_id', seed_item_id)
  );

  return result_id;
end;
$$;

create or replace function public.start_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  if current_row.status = 'in_progress' then
    return;
  end if;

  update public.inventory_counts
  set status = 'in_progress'
  where id = target_count_id;

  perform public.record_audit('inventory.count_started', 'inventory_count', target_count_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.cancel_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  update public.inventory_counts
  set status = 'cancelled'
  where id = target_count_id
    and status in ('draft', 'in_progress');

  if not found then
    raise exception 'Документ нельзя отменить.';
  end if;

  perform public.record_audit('inventory.count_cancelled', 'inventory_count', target_count_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.add_inventory_count_item(target_count_id uuid, target_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_id uuid;
begin
  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  insert into public.inventory_count_lines (count_id, item_id, expected_quantity)
  values (target_count_id, target_item_id, public.inventory_item_stock_qty(target_item_id))
  on conflict (count_id, item_id) do update
    set expected_quantity = public.inventory_count_lines.expected_quantity
  returning id into line_id;

  perform public.mark_inventory_count_in_progress(target_count_id);

  return line_id;
end;
$$;

create or replace function public.remove_inventory_count_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_count_id uuid;
begin
  select count_id into line_count_id
  from public.inventory_count_lines
  where id = target_line_id;

  if line_count_id is null then
    raise exception 'Строка не найдена.';
  end if;

  current_row := public.lock_inventory_count(line_count_id);
  perform public.assert_inventory_count_editable(current_row);

  delete from public.inventory_count_lines where id = target_line_id;
end;
$$;

create or replace function public.set_inventory_count_line_actual(
  target_line_id uuid,
  next_actual numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_count_id uuid;
begin
  if next_actual is null or next_actual < 0 then
    raise exception 'Фактическое количество не может быть отрицательным.';
  end if;

  select count_id into line_count_id
  from public.inventory_count_lines
  where id = target_line_id;

  if line_count_id is null then
    raise exception 'Строка не найдена.';
  end if;

  current_row := public.lock_inventory_count(line_count_id);
  perform public.assert_inventory_count_editable(current_row);

  update public.inventory_count_lines
  set actual_quantity = next_actual
  where id = target_line_id;

  perform public.mark_inventory_count_in_progress(line_count_id);
end;
$$;

create or replace function public.increment_inventory_count_item(
  target_count_id uuid,
  target_item_id uuid,
  increment_by numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  line_id uuid;
begin
  if increment_by is null or increment_by <= 0 then
    raise exception 'Приращение должно быть больше нуля.';
  end if;

  current_row := public.lock_inventory_count(target_count_id);
  perform public.assert_inventory_count_editable(current_row);

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  insert into public.inventory_count_lines (count_id, item_id, expected_quantity, actual_quantity)
  values (
    target_count_id,
    target_item_id,
    public.inventory_item_stock_qty(target_item_id),
    increment_by
  )
  on conflict (count_id, item_id) do update
    set actual_quantity = coalesce(public.inventory_count_lines.actual_quantity, 0) + increment_by
  returning id into line_id;

  perform public.mark_inventory_count_in_progress(target_count_id);
  return line_id;
end;
$$;

create or replace function public.complete_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
  uncounted integer;
  line_row public.inventory_count_lines%rowtype;
  updated_id uuid;
begin
  current_row := public.lock_inventory_count(target_count_id);

  if current_row.status = 'completed' then
    raise exception 'Инвентаризация уже проведена.';
  end if;

  if current_row.status = 'cancelled' then
    raise exception 'Отменённый документ нельзя провести.';
  end if;

  if not exists (select 1 from public.inventory_count_lines where count_id = target_count_id) then
    raise exception 'Добавьте хотя бы одну позицию.';
  end if;

  select count(*) into uncounted
  from public.inventory_count_lines
  where count_id = target_count_id
    and actual_quantity is null;

  if uncounted > 0 then
    raise exception 'Укажите факт по всем строкам. Не пересчитано: %.', uncounted;
  end if;

  for line_row in
    select *
    from public.inventory_count_lines
    where count_id = target_count_id
      and coalesce(difference, 0) <> 0
    order by created_at, id
  loop
    perform public.apply_inventory_quantity_delta(
      line_row.item_id,
      line_row.difference,
      'inventory_adjustment',
      'inventory_count',
      target_count_id
    );
  end loop;

  update public.inventory_counts
  set status = 'completed',
      completed_at = now()
  where id = target_count_id
    and status in ('draft', 'in_progress')
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Инвентаризация уже проведена.';
  end if;

  perform public.record_audit(
    'inventory.count_completed',
    'inventory_count',
    target_count_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

create or replace function public.list_inventory_counts(
  status_filter text default '',
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  number text,
  status text,
  created_by uuid,
  created_at timestamptz,
  completed_at timestamptz,
  actor_name text,
  line_count bigint,
  counted_count bigint,
  discrepancy_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer;
  safe_size integer;
  status_value text;
begin
  perform public.assert_inventory_count_permission();

  status_value := btrim(coalesce(status_filter, ''));
  if status_value <> '' and status_value not in ('draft', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Неизвестный статус.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    c.id,
    c.number,
    c.status,
    c.created_by,
    c.created_at,
    c.completed_at,
    coalesce(p.full_name, '') as actor_name,
    count(l.id) as line_count,
    count(l.id) filter (where l.actual_quantity is not null) as counted_count,
    count(l.id) filter (where l.actual_quantity is not null and l.difference <> 0) as discrepancy_count,
    count(*) over() as total_count
  from public.inventory_counts c
  left join public.profiles p on p.id = c.created_by
  left join public.inventory_count_lines l on l.count_id = c.id
  where status_value = '' or c.status = status_value
  group by c.id, c.number, c.status, c.created_by, c.created_at, c.completed_at, p.full_name
  order by c.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_count(target_count_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_inventory_count_permission();

  select jsonb_build_object(
    'id', c.id,
    'number', c.number,
    'status', c.status,
    'created_by', c.created_by,
    'created_at', c.created_at,
    'completed_at', c.completed_at,
    'actor_name', coalesce(p.full_name, ''),
    'line_count', coalesce((select count(*) from public.inventory_count_lines l where l.count_id = c.id), 0),
    'counted_count', coalesce((
      select count(*) from public.inventory_count_lines l
      where l.count_id = c.id and l.actual_quantity is not null
    ), 0),
    'uncounted_count', coalesce((
      select count(*) from public.inventory_count_lines l
      where l.count_id = c.id and l.actual_quantity is null
    ), 0),
    'discrepancy_count', coalesce((
      select count(*) from public.inventory_count_lines l
      where l.count_id = c.id and l.actual_quantity is not null and l.difference <> 0
    ), 0)
  )
  into payload
  from public.inventory_counts c
  left join public.profiles p on p.id = c.created_by
  where c.id = target_count_id;

  if payload is null then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  return payload;
end;
$$;

create or replace function public.list_inventory_count_lines(
  target_count_id uuid,
  search_query text default '',
  line_filter text default 'all',
  page_number integer default 1,
  page_size integer default 50
)
returns table (
  id uuid,
  item_id uuid,
  item_name text,
  item_code text,
  item_article text,
  item_barcode text,
  unit_name text,
  expected_quantity numeric,
  actual_quantity numeric,
  difference numeric,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  filter_value text;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_inventory_count_permission();

  if not exists (select 1 from public.inventory_counts where id = target_count_id) then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  filter_value := coalesce(nullif(btrim(line_filter), ''), 'all');
  if filter_value not in ('all', 'uncounted', 'counted', 'discrepancy') then
    raise exception 'Неизвестный фильтр строк.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 50), 1), 100);

  return query
  select
    l.id,
    l.item_id,
    i.name as item_name,
    i.code as item_code,
    i.article as item_article,
    i.barcode as item_barcode,
    coalesce(u.name, '') as unit_name,
    l.expected_quantity,
    l.actual_quantity,
    l.difference,
    l.created_at,
    count(*) over() as total_count
  from public.inventory_count_lines l
  join public.inventory_items i on i.id = l.item_id
  left join public.reference_items u on u.id = i.unit_id
  where l.count_id = target_count_id
    and (
      btrim(coalesce(search_query, '')) = ''
      or i.name ilike term escape '\'
      or i.code ilike term escape '\'
      or i.article ilike term escape '\'
      or i.barcode ilike term escape '\'
    )
    and (
      filter_value = 'all'
      or (filter_value = 'uncounted' and l.actual_quantity is null)
      or (filter_value = 'counted' and l.actual_quantity is not null)
      or (filter_value = 'discrepancy' and l.actual_quantity is not null and l.difference <> 0)
    )
  order by
    case when l.actual_quantity is null then 0 else 1 end,
    i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_count_statement(target_count_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  header jsonb;
begin
  perform public.assert_inventory_count_permission();

  select jsonb_build_object(
    'id', c.id,
    'number', c.number,
    'status', c.status,
    'created_at', c.created_at,
    'completed_at', c.completed_at,
    'actor_name', coalesce(p.full_name, '')
  )
  into header
  from public.inventory_counts c
  left join public.profiles p on p.id = c.created_by
  where c.id = target_count_id;

  if header is null then
    raise exception 'Документ инвентаризации не найден.';
  end if;

  return header || jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.item_name)
      from (
        select
          l.id,
          l.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          coalesce(u.name, '') as unit_name,
          l.expected_quantity,
          l.actual_quantity,
          l.difference
        from public.inventory_count_lines l
        join public.inventory_items i on i.id = l.item_id
        left join public.reference_items u on u.id = i.unit_id
        where l.count_id = target_count_id
          and l.actual_quantity is not null
          and l.difference <> 0
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'name', i.name,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            when 'inventory_count' then 'Инвентаризация ' || coalesce(c.number, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        left join public.inventory_counts c on m.reference_type = 'inventory_count' and c.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_lines enable row level security;

drop policy if exists inventory_counts_select on public.inventory_counts;
create policy inventory_counts_select
  on public.inventory_counts
  for select
  to authenticated
  using (public.has_permission('inventory:inventory_count') or public.has_permission('inventory:read'));

drop policy if exists inventory_count_lines_select on public.inventory_count_lines;
create policy inventory_count_lines_select
  on public.inventory_count_lines
  for select
  to authenticated
  using (public.has_permission('inventory:inventory_count') or public.has_permission('inventory:read'));

revoke all on function public.inventory_item_stock_qty(uuid) from public;
revoke all on function public.assert_inventory_count_permission() from public;
revoke all on function public.lock_inventory_count(uuid) from public;
revoke all on function public.assert_inventory_count_editable(public.inventory_counts) from public;
revoke all on function public.mark_inventory_count_in_progress(uuid) from public;
revoke all on function public.apply_inventory_quantity_delta(uuid, numeric, text, text, uuid) from public;
revoke all on function public.create_inventory_count(text, uuid) from public;
revoke all on function public.start_inventory_count(uuid) from public;
revoke all on function public.cancel_inventory_count(uuid) from public;
revoke all on function public.add_inventory_count_item(uuid, uuid) from public;
revoke all on function public.remove_inventory_count_line(uuid) from public;
revoke all on function public.set_inventory_count_line_actual(uuid, numeric) from public;
revoke all on function public.increment_inventory_count_item(uuid, uuid, numeric) from public;
revoke all on function public.complete_inventory_count(uuid) from public;
revoke all on function public.list_inventory_counts(text, integer, integer) from public;
revoke all on function public.get_inventory_count(uuid) from public;
revoke all on function public.list_inventory_count_lines(uuid, text, text, integer, integer) from public;
revoke all on function public.get_inventory_count_statement(uuid) from public;

grant execute on function public.create_inventory_count(text, uuid) to authenticated;
grant execute on function public.start_inventory_count(uuid) to authenticated;
grant execute on function public.cancel_inventory_count(uuid) to authenticated;
grant execute on function public.add_inventory_count_item(uuid, uuid) to authenticated;
grant execute on function public.remove_inventory_count_line(uuid) to authenticated;
grant execute on function public.set_inventory_count_line_actual(uuid, numeric) to authenticated;
grant execute on function public.increment_inventory_count_item(uuid, uuid, numeric) to authenticated;
grant execute on function public.complete_inventory_count(uuid) to authenticated;
grant execute on function public.list_inventory_counts(text, integer, integer) to authenticated;
grant execute on function public.get_inventory_count(uuid) to authenticated;
grant execute on function public.list_inventory_count_lines(uuid, text, text, integer, integer) to authenticated;
grant execute on function public.get_inventory_count_statement(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [11/18 | was 11/151] 20260826000000_sales.sql
-- -----------------------------------------------------------------------------

-- Эндотека: продажи внешним клиентам. Списание FIFO только при подтверждении счёта.

create sequence if not exists public.sale_invoice_number_seq;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  customer_id uuid references public.customers (id) on delete restrict,
  created_by uuid references public.profiles (id) on delete set null,
  sale_date date not null default current_date,
  status text not null default 'draft',
  total numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint sales_invoice_present check (btrim(invoice_number) <> ''),
  constraint sales_status_check check (status in ('draft', 'confirmed', 'cancelled')),
  constraint sales_total_check check (total >= 0),
  constraint sales_confirmed_at_check check (
    (status = 'confirmed' and confirmed_at is not null)
    or (status <> 'confirmed' and confirmed_at is null)
  )
);

create unique index if not exists sales_invoice_number_unique
  on public.sales (invoice_number);

create index if not exists sales_created_at_idx
  on public.sales (created_at desc);

create index if not exists sales_status_idx
  on public.sales (status, created_at desc);

create index if not exists sales_customer_idx
  on public.sales (customer_id);

create table if not exists public.sale_lines (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  amount numeric(14, 2) generated always as (round((quantity * unit_price)::numeric, 2)) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint sale_lines_item_unique unique (sale_id, item_id)
);

create index if not exists sale_lines_sale_idx
  on public.sale_lines (sale_id, sort_order, created_at);

create table if not exists public.sale_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  line_id uuid not null references public.sale_lines (id) on delete restrict,
  batch_id uuid not null references public.inventory_batches (id) on delete restrict,
  movement_id uuid not null references public.inventory_movements (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2) not null,
  created_at timestamptz not null default now()
);

create index if not exists sale_allocations_sale_idx
  on public.sale_allocations (sale_id);

create index if not exists sale_allocations_line_idx
  on public.sale_allocations (line_id);

create or replace function public.assert_sales_read()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('sales:read') then
    raise exception 'Недостаточно прав для просмотра продаж.';
  end if;
end;
$$;

create or replace function public.assert_sales_write()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('sales:create')
    or public.has_permission('sales:update')
  ) then
    raise exception 'Недостаточно прав для изменения продажи.';
  end if;
end;
$$;

create or replace function public.assert_sales_create()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('sales:create') then
    raise exception 'Недостаточно прав для оформления продажи.';
  end if;
end;
$$;

create or replace function public.lock_sale(target_sale_id uuid)
returns public.sales
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
begin
  perform pg_advisory_xact_lock(871003, hashtext(target_sale_id::text));

  select * into current_row
  from public.sales
  where id = target_sale_id
  for update;

  if current_row.id is null then
    raise exception 'Продажа не найдена.';
  end if;

  return current_row;
end;
$$;

create or replace function public.assert_sale_draft(current_row public.sales)
returns void
language plpgsql
stable
as $$
begin
  if current_row.status = 'confirmed' then
    raise exception 'Продажа уже подтверждена.';
  end if;

  if current_row.status = 'cancelled' then
    raise exception 'Отменённую продажу нельзя изменить.';
  end if;
end;
$$;

create or replace function public.refresh_sale_total(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sales
  set total = coalesce((
    select round(sum(amount), 2)
    from public.sale_lines
    where sale_id = target_sale_id
  ), 0)
  where id = target_sale_id;
end;
$$;

create or replace function public.next_sale_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'СЧ-' || lpad(nextval('public.sale_invoice_number_seq')::text, 6, '0');
end;
$$;

create or replace function public.preview_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  remaining numeric;
  take numeric;
  lines jsonb := '[]'::jsonb;
  batch_row record;
begin
  if not (
    public.has_permission('sales:read')
    or public.has_permission('sales:create')
    or public.can_read_inventory()
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if consume_quantity is null or consume_quantity <= 0 then
    return jsonb_build_object('lines', '[]'::jsonb, 'enough', true, 'shortfall', 0);
  end if;

  remaining := consume_quantity;

  for batch_row in
    select
      b.id,
      b.receipt_date,
      b.supplier,
      b.remaining_quantity,
      b.purchase_price
    from public.inventory_batches b
    where b.item_id = target_item_id
      and b.remaining_quantity > 0
    order by b.receipt_date asc, b.created_at asc, b.id asc
  loop
    exit when remaining <= 0;
    take := least(batch_row.remaining_quantity, remaining);
    lines := lines || jsonb_build_array(jsonb_build_object(
      'batch_id', batch_row.id,
      'receipt_date', batch_row.receipt_date,
      'supplier', coalesce(batch_row.supplier, ''),
      'quantity', take,
      'unit_cost', batch_row.purchase_price
    ));
    remaining := remaining - take;
  end loop;

  return jsonb_build_object(
    'lines', lines,
    'enough', remaining <= 0,
    'shortfall', greatest(remaining, 0)
  );
end;
$$;

create or replace function public.create_sale(
  p_customer_id uuid default null,
  p_sale_date date default null,
  p_invoice_number text default null,
  p_seed_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_number text;
  seed_price numeric;
begin
  perform public.assert_sales_create();

  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Клиент не найден.';
  end if;

  next_number := nullif(btrim(coalesce(p_invoice_number, '')), '');
  if next_number is null then
    next_number := public.next_sale_invoice_number();
  end if;

  insert into public.sales (invoice_number, customer_id, created_by, sale_date, status, total)
  values (next_number, p_customer_id, auth.uid(), coalesce(p_sale_date, current_date), 'draft', 0)
  returning id into result_id;

  if p_seed_item_id is not null then
    if not exists (select 1 from public.inventory_items where id = p_seed_item_id) then
      raise exception 'Позиция не найдена.';
    end if;

    select retail_price into seed_price
    from public.inventory_items
    where id = p_seed_item_id;

    insert into public.sale_lines (sale_id, item_id, quantity, unit_price, sort_order)
    values (result_id, p_seed_item_id, 1, coalesce(seed_price, 0), 0);

    perform public.refresh_sale_total(result_id);
  end if;

  perform public.record_audit(
    'sale.created',
    'sale',
    result_id::text,
    jsonb_build_object('invoice_number', next_number, 'customer_id', p_customer_id)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Номер счёта уже используется.';
end;
$$;

create or replace function public.update_sale(
  target_sale_id uuid,
  p_customer_id uuid default null,
  p_sale_date date default null,
  p_invoice_number text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  next_number text;
begin
  perform public.assert_sales_write();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Клиент не найден.';
  end if;

  next_number := nullif(btrim(coalesce(p_invoice_number, '')), '');

  update public.sales
  set
    customer_id = p_customer_id,
    sale_date = coalesce(p_sale_date, sale_date),
    invoice_number = coalesce(next_number, invoice_number)
  where id = target_sale_id;
exception
  when unique_violation then
    raise exception 'Номер счёта уже используется.';
end;
$$;

create or replace function public.add_sale_line(
  target_sale_id uuid,
  target_item_id uuid,
  line_quantity numeric,
  line_unit_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  next_price numeric;
  next_order integer;
  result_id uuid;
begin
  perform public.assert_sales_write();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  next_price := line_unit_price;
  if next_price is null then
    select retail_price into next_price
    from public.inventory_items
    where id = target_item_id;
  end if;

  if next_price is null or next_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  select coalesce(max(sort_order), -1) + 1 into next_order
  from public.sale_lines
  where sale_id = target_sale_id;

  insert into public.sale_lines (sale_id, item_id, quantity, unit_price, sort_order)
  values (target_sale_id, target_item_id, line_quantity, next_price, next_order)
  on conflict (sale_id, item_id) do update
    set quantity = public.sale_lines.quantity + excluded.quantity,
        unit_price = excluded.unit_price
  returning id into result_id;

  perform public.refresh_sale_total(target_sale_id);
  return result_id;
end;
$$;

create or replace function public.set_sale_line(
  target_line_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  target_sale_id uuid;
begin
  perform public.assert_sales_write();

  select sale_id into target_sale_id
  from public.sale_lines
  where id = target_line_id;

  if target_sale_id is null then
    raise exception 'Строка продажи не найдена.';
  end if;

  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.sale_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  perform public.refresh_sale_total(target_sale_id);
end;
$$;

create or replace function public.remove_sale_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  target_sale_id uuid;
begin
  perform public.assert_sales_write();

  select sale_id into target_sale_id
  from public.sale_lines
  where id = target_line_id;

  if target_sale_id is null then
    raise exception 'Строка продажи не найдена.';
  end if;

  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  delete from public.sale_lines
  where id = target_line_id;

  perform public.refresh_sale_total(target_sale_id);
end;
$$;

create or replace function public.confirm_sale(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  line_row public.sale_lines%rowtype;
  fifo jsonb;
  alloc jsonb;
  updated_id uuid;
begin
  perform public.assert_sales_create();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  if current_row.customer_id is null then
    raise exception 'Укажите покупателя.';
  end if;

  if not exists (select 1 from public.sale_lines where sale_id = target_sale_id) then
    raise exception 'Добавьте хотя бы одну позицию.';
  end if;

  for line_row in
    select *
    from public.sale_lines
    where sale_id = target_sale_id
    order by sort_order, created_at, id
  loop
    fifo := public.consume_inventory_fifo(
      line_row.item_id,
      line_row.quantity,
      'sale',
      'sale',
      target_sale_id
    );

    for alloc in
      select value
      from jsonb_array_elements(coalesce(fifo->'lines', '[]'::jsonb))
    loop
      insert into public.sale_allocations (
        sale_id, line_id, batch_id, movement_id, quantity, unit_cost
      )
      values (
        target_sale_id,
        line_row.id,
        (alloc->>'batch_id')::uuid,
        (alloc->>'movement_id')::uuid,
        (alloc->>'quantity')::numeric,
        (alloc->>'unit_price')::numeric
      );
    end loop;
  end loop;

  update public.sales
  set status = 'confirmed',
      confirmed_at = now()
  where id = target_sale_id
    and status = 'draft'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Продажа уже подтверждена.';
  end if;

  perform public.record_audit(
    'sale.confirmed',
    'sale',
    target_sale_id::text,
    jsonb_build_object('invoice_number', current_row.invoice_number, 'total', current_row.total)
  );
end;
$$;

create or replace function public.cancel_sale(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
  updated_id uuid;
begin
  perform public.assert_sales_write();
  current_row := public.lock_sale(target_sale_id);
  perform public.assert_sale_draft(current_row);

  update public.sales
  set status = 'cancelled'
  where id = target_sale_id
    and status = 'draft'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Продажу нельзя отменить.';
  end if;

  perform public.record_audit(
    'sale.cancelled',
    'sale',
    target_sale_id::text,
    jsonb_build_object('invoice_number', current_row.invoice_number)
  );
end;
$$;

create or replace function public.list_sales(
  search_query text default '',
  status_filter text default '',
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  invoice_number text,
  customer_id uuid,
  customer_name text,
  created_by uuid,
  created_by_name text,
  sale_date date,
  status text,
  total numeric,
  created_at timestamptz,
  confirmed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  status_value text;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_sales_read();

  status_value := coalesce(nullif(btrim(status_filter), ''), '');
  if status_value <> '' and status_value not in ('draft', 'confirmed', 'cancelled') then
    raise exception 'Неизвестный статус продажи.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    s.id,
    s.invoice_number,
    s.customer_id,
    coalesce(c.name, '') as customer_name,
    s.created_by,
    coalesce(p.full_name, '') as created_by_name,
    s.sale_date,
    s.status,
    s.total,
    s.created_at,
    s.confirmed_at,
    count(*) over() as total_count
  from public.sales s
  left join public.customers c on c.id = s.customer_id
  left join public.profiles p on p.id = s.created_by
  where (status_value = '' or s.status = status_value)
    and (
      btrim(coalesce(search_query, '')) = ''
      or s.invoice_number ilike term escape '\'
      or c.name ilike term escape '\'
    )
  order by s.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_sale(target_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  lines_json jsonb := '[]'::jsonb;
  rec record;
  preview jsonb;
  stock_qty numeric;
begin
  perform public.assert_sales_read();

  select jsonb_build_object(
    'id', s.id,
    'invoice_number', s.invoice_number,
    'customer_id', s.customer_id,
    'customer_name', coalesce(c.name, ''),
    'customer_inn', coalesce(c.inn, ''),
    'customer_phone', coalesce(c.phone, ''),
    'created_by', s.created_by,
    'created_by_name', coalesce(p.full_name, ''),
    'sale_date', s.sale_date,
    'status', s.status,
    'total', s.total,
    'created_at', s.created_at,
    'confirmed_at', s.confirmed_at
  )
  into payload
  from public.sales s
  left join public.customers c on c.id = s.customer_id
  left join public.profiles p on p.id = s.created_by
  where s.id = target_sale_id;

  if payload is null then
    raise exception 'Продажа не найдена.';
  end if;

  for rec in
    select
      l.id,
      l.item_id,
      i.name as item_name,
      i.code as item_code,
      i.article as item_article,
      i.barcode as item_barcode,
      coalesce(u.name, '') as unit_name,
      l.quantity,
      l.unit_price,
      l.amount,
      l.sort_order
    from public.sale_lines l
    join public.inventory_items i on i.id = l.item_id
    left join public.reference_items u on u.id = i.unit_id
    where l.sale_id = target_sale_id
    order by l.sort_order, l.created_at, l.id
  loop
    stock_qty := public.inventory_item_stock_qty(rec.item_id);

    if payload->>'status' = 'draft' then
      preview := public.preview_inventory_fifo(rec.item_id, rec.quantity);
    else
      preview := jsonb_build_object('lines', '[]'::jsonb, 'enough', true, 'shortfall', 0);
    end if;

    lines_json := lines_json || jsonb_build_array(jsonb_build_object(
      'id', rec.id,
      'item_id', rec.item_id,
      'item_name', rec.item_name,
      'item_code', rec.item_code,
      'item_article', rec.item_article,
      'item_barcode', rec.item_barcode,
      'unit_name', rec.unit_name,
      'quantity', rec.quantity,
      'unit_price', rec.unit_price,
      'amount', rec.amount,
      'stock_quantity', stock_qty,
      'fifo_preview', preview,
      'allocations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id,
          'batch_id', a.batch_id,
          'movement_id', a.movement_id,
          'quantity', a.quantity,
          'unit_cost', a.unit_cost,
          'receipt_date', b.receipt_date,
          'supplier', coalesce(b.supplier, '')
        ) order by b.receipt_date, a.created_at)
        from public.sale_allocations a
        join public.inventory_batches b on b.id = a.batch_id
        where a.line_id = rec.id
      ), '[]'::jsonb)
    ));
  end loop;

  return payload || jsonb_build_object('lines', lines_json);
end;
$$;

create or replace function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  safe_page integer;
  safe_size integer;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('orders:read')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для просмотра склада.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  with stock as (
    select m.item_id, coalesce(sum(m.quantity), 0) as qty
    from public.inventory_movements m
    group by m.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where btrim(coalesce(search_query, '')) = ''
     or i.name ilike term escape '\'
     or i.code ilike term escape '\'
     or i.article ilike term escape '\'
     or i.barcode ilike term escape '\'
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.find_inventory_items_by_barcode(barcode_query text)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  code_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для поиска по штрихкоду.';
  end if;

  code_value := btrim(coalesce(barcode_query, ''));
  if code_value = '' then
    return;
  end if;

  return query
  with stock as (
    select m.item_id, coalesce(sum(m.quantity), 0) as qty
    from public.inventory_movements m
    group by m.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where i.barcode = code_value
     or i.code = code_value
  order by i.name
  limit 20;
end;
$$;

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'name', i.name,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then coalesce(o.number, '—')
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then coalesce(nullif(sa.invoice_number, ''), nullif(legacy.invoice_number, ''), '—')
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            when 'inventory_count' then 'Инвентаризация ' || coalesce(c.number, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.sales sa on m.reference_type = 'sale' and sa.id = m.reference_id
        left join public.inventory_sales legacy on m.reference_type = 'sale' and legacy.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        left join public.inventory_counts c on m.reference_type = 'inventory_count' and c.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

alter table public.sales enable row level security;
alter table public.sale_lines enable row level security;
alter table public.sale_allocations enable row level security;

drop policy if exists sales_select on public.sales;
create policy sales_select
  on public.sales
  for select
  to authenticated
  using (public.has_permission('sales:read'));

drop policy if exists sale_lines_select on public.sale_lines;
create policy sale_lines_select
  on public.sale_lines
  for select
  to authenticated
  using (public.has_permission('sales:read'));

drop policy if exists sale_allocations_select on public.sale_allocations;
create policy sale_allocations_select
  on public.sale_allocations
  for select
  to authenticated
  using (public.has_permission('sales:read'));

revoke all on function public.assert_sales_read() from public;
revoke all on function public.assert_sales_write() from public;
revoke all on function public.assert_sales_create() from public;
revoke all on function public.lock_sale(uuid) from public;
revoke all on function public.assert_sale_draft(public.sales) from public;
revoke all on function public.refresh_sale_total(uuid) from public;
revoke all on function public.next_sale_invoice_number() from public;
revoke all on function public.preview_inventory_fifo(uuid, numeric) from public;
revoke all on function public.create_sale(uuid, date, text, uuid) from public;
revoke all on function public.update_sale(uuid, uuid, date, text) from public;
revoke all on function public.add_sale_line(uuid, uuid, numeric, numeric) from public;
revoke all on function public.set_sale_line(uuid, numeric, numeric) from public;
revoke all on function public.remove_sale_line(uuid) from public;
revoke all on function public.confirm_sale(uuid) from public;
revoke all on function public.cancel_sale(uuid) from public;
revoke all on function public.list_sales(text, text, integer, integer) from public;
revoke all on function public.get_sale(uuid) from public;

grant execute on function public.preview_inventory_fifo(uuid, numeric) to authenticated;
grant execute on function public.create_sale(uuid, date, text, uuid) to authenticated;
grant execute on function public.update_sale(uuid, uuid, date, text) to authenticated;
grant execute on function public.add_sale_line(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.set_sale_line(uuid, numeric, numeric) to authenticated;
grant execute on function public.remove_sale_line(uuid) to authenticated;
grant execute on function public.confirm_sale(uuid) to authenticated;
grant execute on function public.cancel_sale(uuid) to authenticated;
grant execute on function public.list_sales(text, text, integer, integer) to authenticated;
grant execute on function public.get_sale(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [12/18 | was 12/151] 20260826100000_documents.sql
-- -----------------------------------------------------------------------------

-- Эндотека: документы и шаблоны печатных форм. Плейсхолдеры только из явного набора полей.

create sequence if not exists public.document_number_seq;

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  kind text not null,
  page_size text not null default 'a4',
  body jsonb not null default '[]'::jsonb,
  is_system boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_templates_code_present check (btrim(code) <> ''),
  constraint document_templates_name_present check (btrim(name) <> ''),
  constraint document_templates_kind_check check (
    kind in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom')
  ),
  constraint document_templates_page_size_check check (page_size in ('a4', 'label')),
  constraint document_templates_body_array check (jsonb_typeof(body) = 'array')
);

create unique index if not exists document_templates_code_unique
  on public.document_templates (code);

create index if not exists document_templates_kind_idx
  on public.document_templates (kind, name);

create trigger document_templates_set_updated_at
  before update on public.document_templates
  for each row execute procedure public.set_updated_at();

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  template_id uuid not null references public.document_templates (id) on delete restrict,
  title text not null,
  kind text not null,
  source_type text not null default 'none',
  source_id uuid,
  status text not null default 'draft',
  body jsonb not null default '[]'::jsonb,
  context jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  constraint documents_number_present check (btrim(number) <> ''),
  constraint documents_title_present check (btrim(title) <> ''),
  constraint documents_kind_check check (
    kind in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom')
  ),
  constraint documents_source_type_check check (source_type in ('order', 'sale', 'item', 'none')),
  constraint documents_source_required check (
    (source_type = 'none' and source_id is null)
    or (source_type <> 'none' and source_id is not null)
  ),
  constraint documents_status_check check (status in ('draft', 'issued')),
  constraint documents_issued_at_check check (
    (status = 'issued' and issued_at is not null)
    or (status = 'draft' and issued_at is null)
  ),
  constraint documents_body_array check (jsonb_typeof(body) = 'array')
);

create unique index if not exists documents_number_unique
  on public.documents (number);

create index if not exists documents_created_at_idx
  on public.documents (created_at desc);

create index if not exists documents_kind_idx
  on public.documents (kind, created_at desc);

create index if not exists documents_source_idx
  on public.documents (source_type, source_id);

create or replace function public.assert_documents_access()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('documents:read')
    or public.has_permission('documents:create')
    or public.has_permission('documents:print')
    or public.has_permission('documents:edit_templates')
  ) then
    raise exception 'Недостаточно прав для документов.';
  end if;
end;
$$;

create or replace function public.assert_documents_create()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('documents:create') then
    raise exception 'Недостаточно прав для создания документа.';
  end if;
end;
$$;

create or replace function public.assert_templates_edit()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('documents:edit_templates') then
    raise exception 'Недостаточно прав для изменения шаблонов.';
  end if;
end;
$$;

create or replace function public.empty_document_values()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'company.name', 'Эндотека',
    'document.number', '',
    'document.issuedAt', '',
    'order.number', '',
    'order.createdAt', '',
    'order.status', '',
    'order.claimedMalfunction', '',
    'order.completeness', '',
    'order.externalCondition', '',
    'order.deadline', '',
    'order.responsible', '',
    'customer.name', '',
    'customer.phone', '',
    'customer.email', '',
    'customer.inn', '',
    'customer.city', '',
    'customer.contactName', '',
    'device.serialNumber', '',
    'device.model', '',
    'device.brand', '',
    'device.group', '',
    'device.label', '',
    'sale.invoiceNumber', '',
    'sale.date', '',
    'sale.total', '',
    'sale.customerName', '',
    'sale.status', '',
    'item.name', '',
    'item.code', '',
    'item.article', '',
    'item.barcode', '',
    'part.name', '',
    'part.code', '',
    'part.article', '',
    'part.quantity', '',
    'part.unitName', '',
    'part.price', '',
    'line.name', '',
    'line.code', '',
    'line.article', '',
    'line.quantity', '',
    'line.unitName', '',
    'line.price', '',
    'line.amount', ''
  );
$$;

create or replace function public.build_document_context(
  p_source_type text,
  p_source_id uuid,
  p_document_number text default '',
  p_issued_at text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  doc_values jsonb := public.empty_document_values();
  parts jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  first_part jsonb;
  first_line jsonb;
begin
  doc_values := doc_values || jsonb_build_object(
    'document.number', coalesce(p_document_number, ''),
    'document.issuedAt', coalesce(p_issued_at, '')
  );

  if p_source_type = 'order' then
    if not public.has_permission('orders:read') then
      raise exception 'Недостаточно прав для данных заказа.';
    end if;

    select doc_values || jsonb_build_object(
      'order.number', o.number,
      'order.createdAt', to_char(o.created_at, 'DD.MM.YYYY'),
      'order.status', coalesce(st.name, ''),
      'order.claimedMalfunction', o.claimed_malfunction,
      'order.completeness', o.completeness,
      'order.externalCondition', o.external_condition,
      'order.deadline', coalesce(to_char(o.deadline, 'DD.MM.YYYY'), ''),
      'order.responsible', coalesce(resp.full_name, ''),
      'customer.name', coalesce(c.name, ''),
      'customer.phone', coalesce(c.phone, ''),
      'customer.email', coalesce(c.email, ''),
      'customer.inn', coalesce(c.inn, ''),
      'customer.city', coalesce(c.city, ''),
      'customer.contactName', coalesce(c.contact_name, ''),
      'device.serialNumber', coalesce(o.serial_number, ''),
      'device.model', coalesce(model.name, ''),
      'device.brand', coalesce(brand.name, ''),
      'device.group', coalesce(grp.name, ''),
      'device.label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), o.serial_number))
    )
    into doc_values
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join public.devices d on d.id = o.device_id
    left join public.reference_items st on st.id = o.status_id
    left join public.reference_items grp on grp.id = d.group_id
    left join public.reference_items brand on brand.id = d.brand_id
    left join public.reference_items model on model.id = d.model_id
    left join public.profiles resp on resp.id = o.responsible_id
    where o.id = p_source_id;

    if doc_values is null then
      raise exception 'Заказ не найден.';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'part.name', x.item_name,
      'part.code', x.item_code,
      'part.article', x.item_article,
      'part.quantity', x.quantity,
      'part.unitName', x.unit_name,
      'part.price', x.unit_price
    ) order by x.created_at), '[]'::jsonb)
    into parts
    from (
      select
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        trim(to_char(abs(m.quantity), '999999990.999')) as quantity,
        coalesce(u.name, '') as unit_name,
        trim(to_char(m.unit_price, '999999990.99')) as unit_price,
        m.created_at
      from public.inventory_movements m
      join public.inventory_items i on i.id = m.item_id
      left join public.reference_items u on u.id = i.unit_id
      where m.reference_type = 'order'
        and m.reference_id = p_source_id
        and m.movement_type = 'repair_consumption'
    ) x;

    first_part := parts -> 0;
    if first_part is not null then
      doc_values := doc_values || first_part;
    end if;
  elsif p_source_type = 'sale' then
    if not public.has_permission('sales:read') then
      raise exception 'Недостаточно прав для данных продажи.';
    end if;

    select doc_values || jsonb_build_object(
      'sale.invoiceNumber', s.invoice_number,
      'sale.date', to_char(s.sale_date, 'DD.MM.YYYY'),
      'sale.total', trim(to_char(s.total, '999999990.99')),
      'sale.customerName', coalesce(c.name, ''),
      'sale.status', case s.status
        when 'draft' then 'Черновик'
        when 'confirmed' then 'Подтверждена'
        when 'cancelled' then 'Отменена'
        else s.status
      end,
      'customer.name', coalesce(c.name, ''),
      'customer.phone', coalesce(c.phone, ''),
      'customer.email', coalesce(c.email, ''),
      'customer.inn', coalesce(c.inn, ''),
      'customer.city', coalesce(c.city, ''),
      'customer.contactName', coalesce(c.contact_name, '')
    )
    into doc_values
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.id = p_source_id;

    if doc_values is null then
      raise exception 'Продажа не найдена.';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'line.name', i.name,
      'line.code', i.code,
      'line.article', i.article,
      'line.quantity', trim(to_char(l.quantity, '999999990.999')),
      'line.unitName', coalesce(u.name, ''),
      'line.price', trim(to_char(l.unit_price, '999999990.99')),
      'line.amount', trim(to_char(l.amount, '999999990.99'))
    ) order by l.sort_order, l.created_at), '[]'::jsonb)
    into lines
    from public.sale_lines l
    join public.inventory_items i on i.id = l.item_id
    left join public.reference_items u on u.id = i.unit_id
    where l.sale_id = p_source_id;

    first_line := lines -> 0;
    if first_line is not null then
      doc_values := doc_values || first_line;
    end if;
  elsif p_source_type = 'item' then
    if not (
      public.can_read_inventory()
      or public.has_permission('orders:read')
      or public.has_permission('sales:read')
    ) then
      raise exception 'Недостаточно прав для данных номенклатуры.';
    end if;

    select doc_values || jsonb_build_object(
      'item.name', i.name,
      'item.code', i.code,
      'item.article', i.article,
      'item.barcode', i.barcode,
      'part.name', i.name,
      'part.code', i.code,
      'part.article', i.article
    )
    into doc_values
    from public.inventory_items i
    where i.id = p_source_id;

    if doc_values is null then
      raise exception 'Позиция не найдена.';
    end if;
  elsif p_source_type <> 'none' then
    raise exception 'Неизвестный источник документа.';
  end if;

  return jsonb_build_object(
    'values', doc_values,
    'parts', coalesce(parts, '[]'::jsonb),
    'lines', coalesce(lines, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_document_context(
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_documents_access();
  return public.build_document_context(p_source_type, p_source_id, '', '');
end;
$$;

create or replace function public.list_document_templates(
  kind_filter text default '',
  search_query text default ''
)
returns table (
  id uuid,
  code text,
  name text,
  kind text,
  page_size text,
  is_system boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  kind_value text;
begin
  perform public.assert_documents_access();

  kind_value := coalesce(nullif(btrim(kind_filter), ''), '');
  if kind_value <> '' and kind_value not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип шаблона.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select
    t.id,
    t.code,
    t.name,
    t.kind,
    t.page_size,
    t.is_system,
    t.updated_at
  from public.document_templates t
  where (kind_value = '' or t.kind = kind_value)
    and (
      btrim(coalesce(search_query, '')) = ''
      or t.name ilike term escape '\'
      or t.code ilike term escape '\'
    )
  order by t.is_system desc, t.name;
end;
$$;

create or replace function public.get_document_template(target_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_documents_access();

  select jsonb_build_object(
    'id', t.id,
    'code', t.code,
    'name', t.name,
    'kind', t.kind,
    'page_size', t.page_size,
    'body', t.body,
    'is_system', t.is_system,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
  into payload
  from public.document_templates t
  where t.id = target_template_id;

  if payload is null then
    raise exception 'Шаблон не найден.';
  end if;

  return payload;
end;
$$;

create or replace function public.create_document_template(
  template_name text,
  template_kind text,
  template_page_size text default 'a4',
  template_body jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
begin
  perform public.assert_templates_edit();

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите название шаблона.';
  end if;

  if template_kind is null or template_kind not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип шаблона.';
  end if;

  if coalesce(template_page_size, 'a4') not in ('a4', 'label') then
    raise exception 'Неизвестный формат страницы.';
  end if;

  if jsonb_typeof(coalesce(template_body, '[]'::jsonb)) <> 'array' then
    raise exception 'Тело шаблона должно быть списком блоков.';
  end if;

  next_code := 'custom-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

  insert into public.document_templates (code, name, kind, page_size, body, is_system, created_by)
  values (
    next_code,
    btrim(template_name),
    template_kind,
    coalesce(template_page_size, 'a4'),
    coalesce(template_body, '[]'::jsonb),
    false,
    auth.uid()
  )
  returning id into result_id;

  perform public.record_audit(
    'document.template_created',
    'document_template',
    result_id::text,
    jsonb_build_object('name', btrim(template_name), 'kind', template_kind)
  );

  return result_id;
end;
$$;

create or replace function public.update_document_template(
  target_template_id uuid,
  template_name text,
  template_kind text,
  template_page_size text,
  template_body jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.document_templates%rowtype;
begin
  perform public.assert_templates_edit();

  select * into current_row
  from public.document_templates
  where id = target_template_id
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите название шаблона.';
  end if;

  if jsonb_typeof(coalesce(template_body, '[]'::jsonb)) <> 'array' then
    raise exception 'Тело шаблона должно быть списком блоков.';
  end if;

  if current_row.is_system then
    update public.document_templates
    set name = btrim(template_name),
        page_size = case when template_page_size in ('a4', 'label') then template_page_size else page_size end,
        body = coalesce(template_body, body)
    where id = target_template_id;
  else
    if template_kind is null or template_kind not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
      raise exception 'Неизвестный тип шаблона.';
    end if;

    if template_page_size is null or template_page_size not in ('a4', 'label') then
      raise exception 'Неизвестный формат страницы.';
    end if;

    update public.document_templates
    set name = btrim(template_name),
        kind = template_kind,
        page_size = template_page_size,
        body = coalesce(template_body, body)
    where id = target_template_id;
  end if;

  perform public.record_audit(
    'document.template_updated',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', btrim(template_name))
  );
end;
$$;

create or replace function public.delete_document_template(target_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.document_templates%rowtype;
begin
  perform public.assert_templates_edit();

  select * into current_row
  from public.document_templates
  where id = target_template_id
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  if current_row.is_system then
    raise exception 'Системный шаблон нельзя удалить.';
  end if;

  if exists (select 1 from public.documents where template_id = target_template_id) then
    raise exception 'Шаблон уже использован в документах.';
  end if;

  delete from public.document_templates
  where id = target_template_id;

  perform public.record_audit(
    'document.template_deleted',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

create or replace function public.list_documents(
  search_query text default '',
  kind_filter text default '',
  source_type_filter text default '',
  source_id_filter uuid default null,
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  number text,
  title text,
  kind text,
  source_type text,
  source_id uuid,
  source_label text,
  status text,
  created_by_name text,
  created_at timestamptz,
  issued_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  kind_value text;
  source_value text;
  safe_page integer;
  safe_size integer;
begin
  perform public.assert_documents_access();

  kind_value := coalesce(nullif(btrim(kind_filter), ''), '');
  if kind_value <> '' and kind_value not in ('act_acceptance', 'act_completed_work', 'waybill', 'label', 'custom') then
    raise exception 'Неизвестный тип документа.';
  end if;

  source_value := coalesce(nullif(btrim(source_type_filter), ''), '');
  if source_value <> '' and source_value not in ('order', 'sale', 'item', 'none') then
    raise exception 'Неизвестный источник.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    d.id,
    d.number,
    d.title,
    d.kind,
    d.source_type,
    d.source_id,
    case d.source_type
      when 'order' then coalesce(o.number, '')
      when 'sale' then coalesce(s.invoice_number, '')
      when 'item' then coalesce(i.name, '')
      else ''
    end as source_label,
    d.status,
    coalesce(p.full_name, '') as created_by_name,
    d.created_at,
    d.issued_at,
    count(*) over() as total_count
  from public.documents d
  left join public.orders o on d.source_type = 'order' and o.id = d.source_id
  left join public.sales s on d.source_type = 'sale' and s.id = d.source_id
  left join public.inventory_items i on d.source_type = 'item' and i.id = d.source_id
  left join public.profiles p on p.id = d.created_by
  where (kind_value = '' or d.kind = kind_value)
    and (source_value = '' or d.source_type = source_value)
    and (source_id_filter is null or d.source_id = source_id_filter)
    and (
      btrim(coalesce(search_query, '')) = ''
      or d.number ilike term escape '\'
      or d.title ilike term escape '\'
      or o.number ilike term escape '\'
      or s.invoice_number ilike term escape '\'
      or i.name ilike term escape '\'
    )
  order by d.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_document(target_document_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_documents_access();

  select jsonb_build_object(
    'id', d.id,
    'number', d.number,
    'title', d.title,
    'kind', d.kind,
    'status', d.status,
    'source_type', d.source_type,
    'source_id', d.source_id,
    'source_label', case d.source_type
      when 'order' then coalesce(o.number, '')
      when 'sale' then coalesce(s.invoice_number, '')
      when 'item' then coalesce(i.name, '')
      else ''
    end,
    'template_id', d.template_id,
    'template_name', t.name,
    'page_size', t.page_size,
    'body', case when d.status = 'issued' then d.body else t.body end,
    'context', d.context,
    'created_by', d.created_by,
    'created_by_name', coalesce(p.full_name, ''),
    'created_at', d.created_at,
    'issued_at', d.issued_at
  )
  into payload
  from public.documents d
  join public.document_templates t on t.id = d.template_id
  left join public.orders o on d.source_type = 'order' and o.id = d.source_id
  left join public.sales s on d.source_type = 'sale' and s.id = d.source_id
  left join public.inventory_items i on d.source_type = 'item' and i.id = d.source_id
  left join public.profiles p on p.id = d.created_by
  where d.id = target_document_id;

  if payload is null then
    raise exception 'Документ не найден.';
  end if;

  return payload;
end;
$$;

create or replace function public.create_document(
  target_template_id uuid,
  p_source_type text default 'none',
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row public.document_templates%rowtype;
  result_id uuid;
  next_number text;
  source_type text;
  context jsonb;
begin
  perform public.assert_documents_create();

  select * into template_row
  from public.document_templates
  where id = target_template_id;

  if template_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  source_type := coalesce(nullif(btrim(p_source_type), ''), 'none');
  if source_type not in ('order', 'sale', 'item', 'none') then
    raise exception 'Неизвестный источник.';
  end if;

  if source_type = 'none' then
    p_source_id := null;
  elsif p_source_id is null then
    raise exception 'Укажите объект документа.';
  end if;

  next_number := 'ДОК-' || lpad(nextval('public.document_number_seq')::text, 6, '0');
  context := public.build_document_context(source_type, p_source_id, next_number, '');

  insert into public.documents (
    number, template_id, title, kind, source_type, source_id, status, body, context, created_by
  )
  values (
    next_number,
    template_row.id,
    template_row.name,
    template_row.kind,
    source_type,
    p_source_id,
    'draft',
    template_row.body,
    context,
    auth.uid()
  )
  returning id into result_id;

  perform public.record_audit(
    'document.created',
    'document',
    result_id::text,
    jsonb_build_object('number', next_number, 'template_id', template_row.id, 'source_type', source_type)
  );

  return result_id;
end;
$$;

create or replace function public.issue_document(target_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.documents%rowtype;
  template_body jsonb;
  issued_label text;
  context jsonb;
  updated_id uuid;
begin
  perform public.assert_documents_create();

  select * into current_row
  from public.documents
  where id = target_document_id
  for update;

  if current_row.id is null then
    raise exception 'Документ не найден.';
  end if;

  if current_row.status = 'issued' then
    raise exception 'Документ уже выпущен.';
  end if;

  select body into template_body
  from public.document_templates
  where id = current_row.template_id;

  issued_label := to_char(now(), 'DD.MM.YYYY HH24:MI');
  context := public.build_document_context(
    current_row.source_type,
    current_row.source_id,
    current_row.number,
    issued_label
  );

  update public.documents
  set status = 'issued',
      issued_at = now(),
      body = coalesce(template_body, body),
      context = context
  where id = target_document_id
    and status = 'draft'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'Документ уже выпущен.';
  end if;

  perform public.record_audit(
    'document.issued',
    'document',
    target_document_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

insert into public.document_templates (code, name, kind, page_size, is_system, body)
values
(
  'act_acceptance',
  'Акт приёма-передачи',
  'act_acceptance',
  'a4',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":1,"text":"Акт приёма-передачи"},
    {"id":"p0","type":"paragraph","text":"{{company.name}}"},
    {"id":"p1","type":"paragraph","text":"Заказ {{order.number}} от {{order.createdAt}}. Статус: {{order.status}}."},
    {"id":"f1","type":"placeholder","key":"customer.name"},
    {"id":"f2","type":"placeholder","key":"customer.phone"},
    {"id":"f3","type":"placeholder","key":"device.serialNumber"},
    {"id":"f4","type":"placeholder","key":"device.model"},
    {"id":"p2","type":"paragraph","text":"Заявленная неисправность: {{order.claimedMalfunction}}"},
    {"id":"p3","type":"paragraph","text":"Комплектность: {{order.completeness}}"},
    {"id":"p4","type":"paragraph","text":"Внешний вид: {{order.externalCondition}}"},
    {"id":"qr1","type":"qr","value":"{{order.number}}"},
    {"id":"h2","type":"heading","level":2,"text":"Подписи"},
    {"id":"t1","type":"table","source":"manual","headers":["Сдал","Принял"],"columns":["",""],"cells":[["________________","________________"]]}
  ]
  $json$::jsonb
),
(
  'act_completed_work',
  'Акт выполненных работ',
  'act_completed_work',
  'a4',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":1,"text":"Акт выполненных работ"},
    {"id":"p0","type":"paragraph","text":"{{company.name}}"},
    {"id":"p1","type":"paragraph","text":"Заказ {{order.number}} от {{order.createdAt}}."},
    {"id":"p2","type":"paragraph","text":"Клиент: {{customer.name}}, тел. {{customer.phone}}"},
    {"id":"p3","type":"paragraph","text":"Прибор: {{device.brand}} {{device.model}}, СН {{device.serialNumber}}"},
    {"id":"h2","type":"heading","level":2,"text":"Выполненные работы и запчасти"},
    {"id":"t1","type":"table","source":"order.parts","headers":["Наименование","Код","Кол-во","Ед."],"columns":["{{part.name}}","{{part.code}}","{{part.quantity}}","{{part.unitName}}"],"cells":[]},
    {"id":"p4","type":"paragraph","text":"Ответственный: {{order.responsible}}"},
    {"id":"qr1","type":"qr","value":"{{order.number}}"}
  ]
  $json$::jsonb
),
(
  'waybill',
  'Накладная',
  'waybill',
  'a4',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":1,"text":"Накладная {{sale.invoiceNumber}}"},
    {"id":"p0","type":"paragraph","text":"{{company.name}}"},
    {"id":"p1","type":"paragraph","text":"Дата: {{sale.date}}. Статус: {{sale.status}}."},
    {"id":"f1","type":"placeholder","key":"customer.name"},
    {"id":"f2","type":"placeholder","key":"customer.inn"},
    {"id":"h2","type":"heading","level":2,"text":"Товар"},
    {"id":"t1","type":"table","source":"sale.lines","headers":["Наименование","Кол-во","Цена","Сумма"],"columns":["{{line.name}}","{{line.quantity}} {{line.unitName}}","{{line.price}}","{{line.amount}}"],"cells":[]},
    {"id":"p2","type":"paragraph","text":"Итого: {{sale.total}}"},
    {"id":"bc1","type":"barcode","value":"{{sale.invoiceNumber}}"}
  ]
  $json$::jsonb
),
(
  'label_order',
  'Этикетка заказа',
  'label',
  'label',
  true,
  $json$
  [
    {"id":"h1","type":"heading","level":2,"text":"{{order.number}}"},
    {"id":"qr1","type":"qr","value":"{{order.number}}"},
    {"id":"p1","type":"text","text":"{{customer.name}}"},
    {"id":"p2","type":"text","text":"{{device.serialNumber}}"}
  ]
  $json$::jsonb
),
(
  'label_part',
  'Этикетка запчасти',
  'label',
  'label',
  true,
  $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.code}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
  $json$::jsonb
)
on conflict (code) do nothing;

alter table public.document_templates enable row level security;
alter table public.documents enable row level security;

drop policy if exists document_templates_select on public.document_templates;
create policy document_templates_select
  on public.document_templates
  for select
  to authenticated
  using (
    public.has_permission('documents:read')
    or public.has_permission('documents:create')
    or public.has_permission('documents:print')
    or public.has_permission('documents:edit_templates')
  );

drop policy if exists documents_select on public.documents;
create policy documents_select
  on public.documents
  for select
  to authenticated
  using (
    public.has_permission('documents:read')
    or public.has_permission('documents:create')
    or public.has_permission('documents:print')
    or public.has_permission('documents:edit_templates')
  );

revoke all on function public.assert_documents_access() from public;
revoke all on function public.assert_documents_create() from public;
revoke all on function public.assert_templates_edit() from public;
revoke all on function public.empty_document_values() from public;
revoke all on function public.build_document_context(text, uuid, text, text) from public;
revoke all on function public.get_document_context(text, uuid) from public;
revoke all on function public.list_document_templates(text, text) from public;
revoke all on function public.get_document_template(uuid) from public;
revoke all on function public.create_document_template(text, text, text, jsonb) from public;
revoke all on function public.update_document_template(uuid, text, text, text, jsonb) from public;
revoke all on function public.delete_document_template(uuid) from public;
revoke all on function public.list_documents(text, text, text, uuid, integer, integer) from public;
revoke all on function public.get_document(uuid) from public;
revoke all on function public.create_document(uuid, text, uuid) from public;
revoke all on function public.issue_document(uuid) from public;

grant execute on function public.get_document_context(text, uuid) to authenticated;
grant execute on function public.list_document_templates(text, text) to authenticated;
grant execute on function public.get_document_template(uuid) to authenticated;
grant execute on function public.create_document_template(text, text, text, jsonb) to authenticated;
grant execute on function public.update_document_template(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.delete_document_template(uuid) to authenticated;
grant execute on function public.list_documents(text, text, text, uuid, integer, integer) to authenticated;
grant execute on function public.get_document(uuid) to authenticated;
grant execute on function public.create_document(uuid, text, uuid) to authenticated;
grant execute on function public.issue_document(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- [13/18 | was 13/151] 20260826200000_tasks.sql
-- -----------------------------------------------------------------------------

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

-- -----------------------------------------------------------------------------
-- [14/18 | was 14/151] 20260826300000_notifications.sql
-- -----------------------------------------------------------------------------

-- Эндотека: событийные уведомления.
-- Действие → domain_events → обработка → in-app / email / telegram.
-- Сбой доставки не откатывает заказ и другие бизнес-операции.

create table if not exists public.notification_event_catalog (
  code text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_system boolean not null default true
);

insert into public.notification_event_catalog (code, name, description, sort_order)
values
  ('responsible_assigned', 'Назначение ответственного', 'Ответственный сотрудник назначен на заказ.', 0),
  ('task_assigned', 'Назначение задачи', 'Сотруднику назначена задача.', 1),
  ('order_status_changed', 'Смена статуса заказа', 'Статус заказа изменился.', 2),
  ('deadline_approaching', 'Приближается срок', 'Срок заказа скоро истечёт.', 3),
  ('deadline_overdue', 'Срок просрочен', 'Срок заказа истёк.', 4),
  ('order_in_repair', 'Заказ в ремонте', 'Заказ переведён в ремонт, склад может понадобиться.', 5)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

update public.reference_items i
set is_active = false
from public.reference_sets s
where s.code = 'notification_event_types'
  and i.set_id = s.id
  and i.code in (
    'order_assigned',
    'task_due',
    'inventory_low',
    'warehouse_repair_started',
    'order_deadline_approaching',
    'order_deadline_overdue'
  );

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, c.code, c.name, c.sort_order, true
from public.reference_sets s
join public.notification_event_catalog c on true
where s.code = 'notification_event_types'
on conflict do nothing;

alter table if exists public.notifications rename to notifications_legacy;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  title text not null,
  body text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

create index if not exists notifications_event_idx
  on public.notifications (event_code, created_at desc);

create table if not exists public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_recipients_read_at_check check (
    (is_read and read_at is not null) or (not is_read and read_at is null)
  )
);

create unique index if not exists notification_recipients_unique_idx
  on public.notification_recipients (notification_id, recipient_id);

create index if not exists notification_recipients_unread_idx
  on public.notification_recipients (recipient_id, created_at desc)
  where is_read = false;

insert into public.notifications (id, event_code, title, body, entity_type, entity_id, created_at)
select id, event_code, title, body, entity_type, entity_id, created_at
from public.notifications_legacy
on conflict (id) do nothing;

insert into public.notification_recipients (notification_id, recipient_id, is_read, read_at, created_at)
select
  id,
  recipient_id,
  is_read,
  case when is_read then created_at else null end,
  created_at
from public.notifications_legacy
on conflict do nothing;

drop table if exists public.notifications_legacy;

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  process_error text
);

create index if not exists domain_events_pending_idx
  on public.domain_events (created_at)
  where processed_at is null;

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  target_kind text not null check (target_kind in ('role', 'responsible', 'assignee')),
  role_id uuid references public.roles (id) on delete cascade,
  channel_in_app boolean not null default true,
  channel_email boolean not null default false,
  channel_telegram boolean not null default false,
  is_active boolean not null default true,
  constraint notification_rules_role_required check (
    (target_kind = 'role' and role_id is not null)
    or (target_kind <> 'role' and role_id is null)
  )
);

create unique index if not exists notification_rules_unique_idx
  on public.notification_rules (
    event_code,
    target_kind,
    coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

insert into public.notification_rules (event_code, target_kind, role_id, channel_in_app)
select
  case r.event_code
    when 'warehouse_repair_started' then 'order_in_repair'
    when 'order_assigned' then 'responsible_assigned'
    when 'order_deadline_approaching' then 'deadline_approaching'
    when 'order_deadline_overdue' then 'deadline_overdue'
    else r.event_code
  end,
  r.target_kind,
  r.role_id,
  true
from public.notification_routes r
on conflict do nothing;

insert into public.notification_rules (event_code, target_kind, role_id, channel_in_app)
values
  ('responsible_assigned', 'responsible', null, true),
  ('task_assigned', 'assignee', null, true),
  ('order_status_changed', 'responsible', null, true),
  ('deadline_approaching', 'responsible', null, true),
  ('deadline_overdue', 'responsible', null, true)
on conflict do nothing;

insert into public.notification_rules (event_code, target_kind, role_id, channel_in_app)
select 'order_in_repair', 'role', r.id, true
from public.roles r
where r.code = 'storekeeper'
on conflict do nothing;

drop table if exists public.notification_routes;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('email', 'telegram')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  error text,
  sent_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (status, created_at)
  where status = 'pending';

create index if not exists notification_deliveries_failed_idx
  on public.notification_deliveries (created_at desc)
  where status = 'failed';

create table if not exists public.telegram_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  chat_id text,
  telegram_username text,
  link_code text,
  link_code_expires_at timestamptz,
  linked_at timestamptz,
  constraint telegram_links_chat_or_code check (chat_id is not null or link_code is not null)
);

create unique index if not exists telegram_links_chat_unique_idx
  on public.telegram_links (chat_id)
  where chat_id is not null;

create unique index if not exists telegram_links_code_unique_idx
  on public.telegram_links (link_code)
  where link_code is not null;

insert into public.app_settings (key, value)
values (
  'notifications',
  jsonb_build_object(
    'email_enabled', false,
    'from_name', 'Эндотека',
    'from_email', '',
    'telegram_enabled', false,
    'telegram_bot_username', ''
  )
)
on conflict (key) do nothing;

create or replace function public.notification_channel_settings()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select value
      from public.app_settings
      where key = 'notifications'
    ),
    jsonb_build_object(
      'email_enabled', false,
      'from_name', 'Эндотека',
      'from_email', '',
      'telegram_enabled', false,
      'telegram_bot_username', ''
    )
  );
$$;

create or replace function public.assert_notification_settings_read()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:read') then
    raise exception 'Недостаточно прав для настроек уведомлений.';
  end if;
end;
$$;

create or replace function public.assert_notification_settings_update()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения правил уведомлений.';
  end if;
end;
$$;

create or replace function public.assert_service_role()
returns void
language plpgsql
stable
as $$
begin
  if auth.uid() is not null then
    raise exception 'Только служебный вызов.';
  end if;
end;
$$;

create or replace function public.collect_event_recipients(event_payload jsonb, p_event_code text)
returns table (recipient_id uuid, channel_in_app boolean, channel_email boolean, channel_telegram boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid;
  order_uuid uuid;
  task_uuid uuid;
  responsible uuid;
  assignee uuid;
begin
  actor := nullif(event_payload ->> 'actor_id', '')::uuid;
  order_uuid := nullif(event_payload ->> 'order_id', '')::uuid;
  task_uuid := nullif(event_payload ->> 'task_id', '')::uuid;

  if order_uuid is not null then
    select o.responsible_id into responsible from public.orders o where o.id = order_uuid;
  end if;
  if responsible is null and nullif(event_payload ->> 'responsible_id', '') is not null then
    responsible := (event_payload ->> 'responsible_id')::uuid;
  end if;

  if task_uuid is not null then
    select t.assignee_id into assignee from public.tasks t where t.id = task_uuid;
  end if;
  if assignee is null and nullif(event_payload ->> 'assignee_id', '') is not null then
    assignee := (event_payload ->> 'assignee_id')::uuid;
  end if;

  return query
  with resolved as (
    select
      case
        when r.target_kind = 'role' then ur.user_id
        when r.target_kind = 'responsible' then responsible
        when r.target_kind = 'assignee' then assignee
      end as user_id,
      r.channel_in_app,
      r.channel_email,
      r.channel_telegram
    from public.notification_rules r
    left join public.user_roles ur on r.target_kind = 'role' and ur.role_id = r.role_id
    where r.is_active = true
      and r.event_code = p_event_code
  )
  select
    resolved.user_id,
    bool_or(resolved.channel_in_app) as channel_in_app,
    bool_or(resolved.channel_email) as channel_email,
    bool_or(resolved.channel_telegram) as channel_telegram
  from resolved
  join public.profiles p on p.id = resolved.user_id
  where resolved.user_id is not null
    and p.is_active = true
    and resolved.user_id is distinct from actor
  group by resolved.user_id;
end;
$$;

create or replace function public.process_domain_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.domain_events%rowtype;
  notification_id uuid;
  title_value text;
  body_value text;
  rec record;
  settings jsonb;
  email_on boolean;
  telegram_on boolean;
  has_any boolean := false;
begin
  select * into event_row
  from public.domain_events
  where id = target_event_id
  for update;

  if event_row.id is null then
    return;
  end if;

  if event_row.processed_at is not null then
    return;
  end if;

  settings := public.notification_channel_settings();
  email_on := coalesce((settings ->> 'email_enabled')::boolean, false);
  telegram_on := coalesce((settings ->> 'telegram_enabled')::boolean, false);

  title_value := coalesce(nullif(btrim(event_row.payload ->> 'title'), ''), 'Уведомление');
  body_value := coalesce(nullif(btrim(event_row.payload ->> 'body'), ''), '');

  for rec in
    select * from public.collect_event_recipients(event_row.payload, event_row.event_code)
  loop
    if not has_any then
      insert into public.notifications (event_code, title, body, entity_type, entity_id, payload)
      values (
        event_row.event_code,
        title_value,
        body_value,
        event_row.entity_type,
        event_row.entity_id,
        event_row.payload
      )
      returning id into notification_id;
      has_any := true;
    end if;

    if rec.channel_in_app then
      insert into public.notification_recipients (notification_id, recipient_id)
      values (notification_id, rec.recipient_id)
      on conflict do nothing;
    end if;

    if rec.channel_email and email_on then
      insert into public.notification_deliveries (notification_id, recipient_id, channel)
      values (notification_id, rec.recipient_id, 'email');
    end if;

    if rec.channel_telegram and telegram_on then
      insert into public.notification_deliveries (notification_id, recipient_id, channel)
      values (notification_id, rec.recipient_id, 'telegram');
    end if;
  end loop;

  update public.domain_events
  set processed_at = now(),
      process_error = null
  where id = target_event_id;
end;
$$;

create or replace function public.emit_domain_event(
  event_code text,
  entity_type text,
  entity_id text,
  payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
  code_value text := btrim(coalesce(event_code, ''));
begin
  if code_value = '' then
    return null;
  end if;

  insert into public.domain_events (event_code, entity_type, entity_id, payload, actor_id)
  values (
    code_value,
    entity_type,
    entity_id,
    coalesce(payload, '{}'::jsonb),
    coalesce(nullif(payload ->> 'actor_id', '')::uuid, auth.uid())
  )
  returning id into event_id;

  begin
    perform public.process_domain_event(event_id);
  exception
    when others then
      update public.domain_events
      set process_error = left(sqlerrm, 500)
      where id = event_id;
  end;

  return event_id;
exception
  when others then
    return null;
end;
$$;

create or replace function public.fanout_notification(
  event_code text,
  title text,
  body text,
  entity_type text,
  entity_id text,
  source_order_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  mapped text;
begin
  mapped := case event_code
    when 'warehouse_repair_started' then 'order_in_repair'
    when 'order_assigned' then 'responsible_assigned'
    when 'order_deadline_approaching' then 'deadline_approaching'
    when 'order_deadline_overdue' then 'deadline_overdue'
    else event_code
  end;

  perform public.emit_domain_event(
    mapped,
    entity_type,
    entity_id,
    jsonb_build_object(
      'title', title,
      'body', body,
      'actor_id', auth.uid(),
      'order_id', source_order_id
    )
  );
end;
$$;

create or replace function public.process_pending_domain_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  processed integer := 0;
begin
  perform public.assert_service_role();

  for rec in
    select id from public.domain_events
    where processed_at is null
    order by created_at
    limit 50
  loop
    begin
      perform public.process_domain_event(rec.id);
      processed := processed + 1;
    exception
      when others then
        update public.domain_events
        set process_error = left(sqlerrm, 500)
        where id = rec.id;
    end;
  end loop;

  return processed;
end;
$$;

create or replace function public.list_my_notifications(page_size integer default 30)
returns table (
  id uuid,
  event_code text,
  title text,
  body text,
  entity_type text,
  entity_id text,
  is_read boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_size integer;
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  safe_size := least(greatest(coalesce(page_size, 30), 1), 100);

  return query
  select
    n.id,
    n.event_code,
    n.title,
    n.body,
    n.entity_type,
    n.entity_id,
    r.is_read,
    n.created_at
  from public.notification_recipients r
  join public.notifications n on n.id = r.notification_id
  where r.recipient_id = auth.uid()
  order by n.created_at desc
  limit safe_size;
end;
$$;

create or replace function public.count_unread_notifications()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result bigint;
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  select count(*) into result
  from public.notification_recipients
  where recipient_id = auth.uid() and is_read = false;

  return coalesce(result, 0);
end;
$$;

create or replace function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  update public.notification_recipients
  set is_read = true,
      read_at = now()
  where recipient_id = auth.uid()
    and is_read = false;
end;
$$;

create or replace function public.mark_notification_read(target_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('notifications:read') then
    raise exception 'Недостаточно прав для уведомлений.';
  end if;

  update public.notification_recipients
  set is_read = true,
      read_at = now()
  where recipient_id = auth.uid()
    and notification_id = target_notification_id
    and is_read = false;
end;
$$;

create or replace function public.list_notification_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_notification_settings_read();

  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', c.code,
        'name', c.name,
        'description', c.description
      ) order by c.sort_order, c.name)
      from public.notification_event_catalog c
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'code', r.code,
        'name', r.name
      ) order by r.name)
      from public.roles r
    ), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'event_code', n.event_code,
        'target_kind', n.target_kind,
        'role_id', n.role_id,
        'role_name', r.name,
        'channel_in_app', n.channel_in_app,
        'channel_email', n.channel_email,
        'channel_telegram', n.channel_telegram,
        'is_active', n.is_active
      ) order by n.event_code, n.target_kind)
      from public.notification_rules n
      left join public.roles r on r.id = n.role_id
    ), '[]'::jsonb),
    'channels', public.notification_channel_settings(),
    'failed_deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'channel', d.channel,
        'status', d.status,
        'error', d.error,
        'attempts', d.attempts,
        'title', n.title,
        'recipient_name', coalesce(p.full_name, p.email, ''),
        'created_at', d.created_at
      ) order by d.created_at desc)
      from (
        select * from public.notification_deliveries
        where status = 'failed'
        order by created_at desc
        limit 30
      ) d
      join public.notifications n on n.id = d.notification_id
      join public.profiles p on p.id = d.recipient_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_notification_rule(
  target_id uuid,
  p_event_code text,
  p_target_kind text,
  p_role_id uuid default null,
  p_channel_in_app boolean default true,
  p_channel_email boolean default false,
  p_channel_telegram boolean default false,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  event_value text := btrim(coalesce(p_event_code, ''));
  kind_value text := btrim(coalesce(p_target_kind, ''));
begin
  perform public.assert_notification_settings_update();

  if not exists (select 1 from public.notification_event_catalog where code = event_value) then
    raise exception 'Неизвестное событие.';
  end if;

  if kind_value not in ('role', 'responsible', 'assignee') then
    raise exception 'Неизвестный получатель.';
  end if;

  if kind_value = 'role' then
    if p_role_id is null or not exists (select 1 from public.roles where id = p_role_id) then
      raise exception 'Укажите роль.';
    end if;
  else
    p_role_id := null;
  end if;

  if target_id is null then
    insert into public.notification_rules (
      event_code, target_kind, role_id, channel_in_app, channel_email, channel_telegram, is_active
    )
    values (
      event_value, kind_value, p_role_id,
      coalesce(p_channel_in_app, true),
      coalesce(p_channel_email, false),
      coalesce(p_channel_telegram, false),
      coalesce(p_is_active, true)
    )
    returning id into result_id;
  else
    update public.notification_rules
    set event_code = event_value,
        target_kind = kind_value,
        role_id = p_role_id,
        channel_in_app = coalesce(p_channel_in_app, true),
        channel_email = coalesce(p_channel_email, false),
        channel_telegram = coalesce(p_channel_telegram, false),
        is_active = coalesce(p_is_active, true)
    where id = target_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Правило не найдено.';
    end if;
  end if;

  perform public.record_audit(
    'notifications.rule_saved',
    'notification_rule',
    result_id::text,
    jsonb_build_object('event_code', event_value, 'target_kind', kind_value)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Такое правило уже есть.';
end;
$$;

create or replace function public.delete_notification_rule(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_notification_settings_update();

  delete from public.notification_rules where id = target_id;
  if not found then
    raise exception 'Правило не найдено.';
  end if;

  perform public.record_audit('notifications.rule_deleted', 'notification_rule', target_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.save_notification_channel_settings(
  p_email_enabled boolean,
  p_from_name text,
  p_from_email text,
  p_telegram_enabled boolean,
  p_telegram_bot_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  from_email text := btrim(coalesce(p_from_email, ''));
  bot_name text := btrim(coalesce(p_telegram_bot_username, ''));
begin
  perform public.assert_notification_settings_update();

  if bot_name like '@%' then
    bot_name := substr(bot_name, 2);
  end if;

  insert into public.app_settings (key, value)
  values (
    'notifications',
    jsonb_build_object(
      'email_enabled', coalesce(p_email_enabled, false),
      'from_name', coalesce(nullif(btrim(p_from_name), ''), 'Эндотека'),
      'from_email', from_email,
      'telegram_enabled', coalesce(p_telegram_enabled, false),
      'telegram_bot_username', bot_name
    )
  )
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now();

  perform public.record_audit('notifications.channels_saved', 'app_settings', 'notifications', '{}'::jsonb);
end;
$$;

create or replace function public.claim_notification_deliveries(batch_size integer default 20)
returns table (
  id uuid,
  channel text,
  title text,
  body text,
  email text,
  chat_id text,
  recipient_name text,
  from_name text,
  from_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  settings jsonb;
  safe_size integer;
begin
  perform public.assert_service_role();
  settings := public.notification_channel_settings();
  safe_size := least(greatest(coalesce(batch_size, 20), 1), 50);

  return query
  with picked as (
    select d.id
    from public.notification_deliveries d
    where d.status = 'pending'
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
    order by d.created_at
    limit safe_size
    for update skip locked
  ),
  marked as (
    update public.notification_deliveries d
    set attempts = d.attempts + 1,
        claimed_at = now()
    from picked
    where d.id = picked.id
    returning d.id, d.channel, d.notification_id, d.recipient_id
  )
  select
    m.id,
    m.channel,
    n.title,
    n.body,
    p.email,
    t.chat_id,
    coalesce(p.full_name, p.email, ''),
    coalesce(settings ->> 'from_name', 'Эндотека'),
    coalesce(settings ->> 'from_email', '')
  from marked m
  join public.notifications n on n.id = m.notification_id
  join public.profiles p on p.id = m.recipient_id
  left join public.telegram_links t on t.user_id = m.recipient_id;
end;
$$;

create or replace function public.record_notification_delivery(
  target_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_service_role();

  if p_status not in ('sent', 'failed') then
    raise exception 'Неизвестный статус доставки.';
  end if;

  update public.notification_deliveries
  set status = p_status,
      error = case when p_status = 'failed' then left(coalesce(p_error, ''), 500) else null end,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = target_id;
end;
$$;

create or replace function public.get_my_telegram_link()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  settings jsonb := public.notification_channel_settings();
  link public.telegram_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Требуется вход.';
  end if;

  select * into link from public.telegram_links where user_id = auth.uid();

  return jsonb_build_object(
    'bot_username', coalesce(settings ->> 'telegram_bot_username', ''),
    'telegram_enabled', coalesce((settings ->> 'telegram_enabled')::boolean, false),
    'linked', link.chat_id is not null,
    'telegram_username', coalesce(link.telegram_username, ''),
    'pending_code', case
      when link.link_code is not null and link.link_code_expires_at > now() then link.link_code
      else ''
    end,
    'pending_expires_at', link.link_code_expires_at
  );
end;
$$;

create or replace function public.create_telegram_link_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
begin
  if auth.uid() is null then
    raise exception 'Требуется вход.';
  end if;

  insert into public.telegram_links (user_id, link_code, link_code_expires_at, chat_id, telegram_username, linked_at)
  values (auth.uid(), code, now() + interval '15 minutes', null, null, null)
  on conflict (user_id) do update
    set link_code = excluded.link_code,
        link_code_expires_at = excluded.link_code_expires_at,
        chat_id = public.telegram_links.chat_id,
        telegram_username = public.telegram_links.telegram_username,
        linked_at = public.telegram_links.linked_at;

  return public.get_my_telegram_link();
end;
$$;

create or replace function public.unlink_telegram()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Требуется вход.';
  end if;

  delete from public.telegram_links where user_id = auth.uid();
end;
$$;

create or replace function public.confirm_telegram_link(
  p_code text,
  p_chat_id text,
  p_username text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  code_value text := upper(btrim(coalesce(p_code, '')));
  chat_value text := btrim(coalesce(p_chat_id, ''));
  updated_id uuid;
begin
  perform public.assert_service_role();

  if code_value = '' or chat_value = '' then
    return false;
  end if;

  update public.telegram_links
  set chat_id = chat_value,
      telegram_username = nullif(btrim(coalesce(p_username, '')), ''),
      linked_at = now(),
      link_code = null,
      link_code_expires_at = null
  where link_code = code_value
    and link_code_expires_at > now()
  returning user_id into updated_id;

  return updated_id is not null;
end;
$$;

create or replace function public.create_order(
  target_customer_id uuid,
  target_device_id uuid,
  claimed_malfunction text,
  completeness text default '',
  external_condition text default '',
  target_deadline date default null,
  target_responsible_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  v_number text;
  v_seq integer;
  device_serial text;
  initial_status uuid;
  malfunction text;
begin
  if not public.has_permission('orders:create') then
    raise exception 'Недостаточно прав для создания заказа.';
  end if;

  malfunction := btrim(coalesce(claimed_malfunction, ''));
  if char_length(malfunction) < 1 then
    raise exception 'Укажите заявленную неисправность.';
  end if;

  if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
    raise exception 'Клиент не найден.';
  end if;

  select serial_number into device_serial from public.devices where id = target_device_id;
  if device_serial is null then
    raise exception 'Прибор не найден.';
  end if;

  select m.status_id into initial_status
  from public.order_status_meta m
  join public.reference_items i on i.id = m.status_id
  where m.is_initial = true and i.is_active = true
  order by i.sort_order
  limit 1;

  if initial_status is null then
    raise exception 'Не задан начальный статус заказа.';
  end if;

  if target_responsible_id is not null
     and not exists (select 1 from public.profiles where id = target_responsible_id and is_active = true) then
    raise exception 'Ответственный сотрудник не найден.';
  end if;

  select n.order_number, n.seq into v_number, v_seq from public.next_order_number() as n;

  insert into public.orders (
    number, number_seq, customer_id, device_id, serial_number,
    claimed_malfunction, completeness, external_condition,
    deadline, responsible_id, status_id, created_by
  )
  values (
    v_number, v_seq, target_customer_id, target_device_id, device_serial,
    malfunction, btrim(coalesce(completeness, '')), btrim(coalesce(external_condition, '')),
    target_deadline, target_responsible_id, initial_status, auth.uid()
  )
  returning id into result_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (result_id, null, initial_status, auth.uid(), jsonb_build_object('source', 'create'));

  perform public.record_audit(
    'orders.created',
    'order',
    result_id::text,
    jsonb_build_object('number', v_number)
  );

  if target_responsible_id is not null then
    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      result_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', result_id,
        'order_number', v_number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || v_number
      )
    );
  end if;

  return result_id;
end;
$$;

create or replace function public.update_order(
  target_order_id uuid,
  claimed_malfunction text default null,
  completeness text default null,
  external_condition text default null,
  target_deadline date default null,
  clear_deadline boolean default false,
  target_responsible_id uuid default null,
  change_responsible boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if claimed_malfunction is not null or completeness is not null or external_condition is not null
     or target_deadline is not null or clear_deadline then
    if not public.has_permission('orders:update') then
      raise exception 'Недостаточно прав для изменения заказа.';
    end if;
  end if;

  if change_responsible and not (public.has_permission('orders:assign') or public.has_permission('orders:update')) then
    raise exception 'Недостаточно прав для назначения ответственного.';
  end if;

  if claimed_malfunction is not null and char_length(btrim(claimed_malfunction)) < 1 then
    raise exception 'Укажите заявленную неисправность.';
  end if;

  previous_responsible := current_row.responsible_id;

  update public.orders
  set
    claimed_malfunction = case
      when claimed_malfunction is not null then btrim(claimed_malfunction)
      else orders.claimed_malfunction
    end,
    completeness = case
      when completeness is not null then btrim(completeness)
      else orders.completeness
    end,
    external_condition = case
      when external_condition is not null then btrim(external_condition)
      else orders.external_condition
    end,
    deadline = case
      when clear_deadline then null
      when target_deadline is not null then target_deadline
      else orders.deadline
    end,
    responsible_id = case
      when change_responsible then target_responsible_id
      else orders.responsible_id
    end
  where id = target_order_id;

  if change_responsible and target_responsible_id is distinct from previous_responsible then
    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', target_order_id,
        'order_number', current_row.number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || current_row.number
      )
    );
  end if;

  perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.change_order_status(
  target_order_id uuid,
  target_status_id uuid,
  warranty_start date default null,
  warranty_end date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  transition public.order_status_transitions%rowtype;
  rule_code text;
  to_name text;
  to_code text;
  from_name text;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  select * into transition
  from public.order_status_transitions
  where from_status_id = current_row.status_id
    and to_status_id = target_status_id
    and is_active = true;

  if transition.id is null then
    raise exception 'Такой переход статуса не разрешён.';
  end if;

  if not public.has_permission(transition.required_permission) then
    raise exception 'Недостаточно прав для этого перехода.';
  end if;

  for rule_code in
    select r.rule_code from public.order_transition_rules r where r.transition_id = transition.id
  loop
    if not public.transition_rule_passed(rule_code, current_row) then
      if rule_code = 'diagnostics_conclusion' then
        raise exception 'Сначала заполните заключение диагностики.';
      end if;
      if rule_code = 'responsible_assigned' then
        raise exception 'Назначьте ответственного сотрудника.';
      end if;
      raise exception 'Не выполнено условие перехода.';
    end if;
  end loop;

  select name, code into to_name, to_code from public.reference_items where id = target_status_id;
  select name into from_name from public.reference_items where id = current_row.status_id;

  if to_code = 'issued' then
    if warranty_start is null or warranty_end is null then
      raise exception 'Укажите срок гарантии.';
    end if;
    if warranty_end < warranty_start then
      raise exception 'Дата окончания гарантии не может быть раньше начала.';
    end if;
  end if;

  update public.orders
  set status_id = target_status_id
  where id = target_order_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (
    target_order_id,
    current_row.status_id,
    target_status_id,
    auth.uid(),
    jsonb_build_object('from_name', from_name, 'to_name', to_name)
  );

  if to_code = 'issued' then
    insert into public.device_warranties (device_id, order_id, starts_on, ends_on, created_by)
    values (current_row.device_id, target_order_id, warranty_start, warranty_end, auth.uid());
  end if;

  perform public.emit_domain_event(
    'order_status_changed',
    'order',
    target_order_id::text,
    jsonb_build_object(
      'actor_id', auth.uid(),
      'order_id', target_order_id,
      'order_number', current_row.number,
      'responsible_id', current_row.responsible_id,
      'from_status', from_name,
      'to_status', to_name,
      'to_code', to_code,
      'title', 'Статус заказа изменён',
      'body', 'Заказ ' || current_row.number || ': ' || coalesce(from_name, '') || ' → ' || coalesce(to_name, '')
    )
  );

  if exists (
    select 1 from public.order_status_meta
    where status_id = target_status_id and notifies_warehouse = true
  ) then
    perform public.emit_domain_event(
      'order_in_repair',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', target_order_id,
        'order_number', current_row.number,
        'title', 'Заказ в ремонте',
        'body', 'Заказ ' || current_row.number || ' переведён в ремонт. Проверьте склад.'
      )
    );
  end if;

  perform public.record_audit(
    'orders.status_changed',
    'order',
    target_order_id::text,
    jsonb_build_object('from', current_row.status_id, 'to', target_status_id, 'to_code', to_code)
  );
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

create or replace function public.process_order_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  approaching_days integer := 2;
  sent integer := 0;
  rec record;
begin
  if auth.uid() is not null and not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав.';
  end if;

  select coalesce((value ->> 'approaching_days')::integer, 2)
    into approaching_days
  from public.app_settings
  where key = 'deadline';

  for rec in
    select o.id, o.number, o.deadline, o.responsible_id, meta.is_terminal
    from public.orders o
    left join public.order_status_meta meta on meta.status_id = o.status_id
    where o.deadline is not null
      and o.responsible_id is not null
      and coalesce(meta.is_terminal, false) = false
  loop
    if rec.deadline < current_date then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'overdue'
      ) then
        perform public.emit_domain_event(
          'deadline_overdue',
          'order',
          rec.id::text,
          jsonb_build_object(
            'order_id', rec.id,
            'order_number', rec.number,
            'responsible_id', rec.responsible_id,
            'title', 'Срок заказа просрочен',
            'body', 'Срок заказа ' || rec.number || ' истёк.'
          )
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'overdue');
        sent := sent + 1;
      end if;
    elsif rec.deadline <= current_date + approaching_days then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'approaching'
      ) then
        perform public.emit_domain_event(
          'deadline_approaching',
          'order',
          rec.id::text,
          jsonb_build_object(
            'order_id', rec.id,
            'order_number', rec.number,
            'responsible_id', rec.responsible_id,
            'title', 'Приближается срок заказа',
            'body', 'Срок заказа ' || rec.number || ' — ' || to_char(rec.deadline, 'DD.MM.YYYY') || '.'
          )
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'approaching');
        sent := sent + 1;
      end if;
    end if;
  end loop;

  return sent;
end;
$$;

alter table public.notifications enable row level security;
alter table public.notification_recipients enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_event_catalog enable row level security;
alter table public.domain_events enable row level security;
alter table public.telegram_links enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (
    exists (
      select 1 from public.notification_recipients r
      where r.notification_id = notifications.id and r.recipient_id = auth.uid()
    )
    or public.has_permission('settings:read')
  );

drop policy if exists notification_recipients_select_own on public.notification_recipients;
create policy notification_recipients_select_own
  on public.notification_recipients
  for select
  to authenticated
  using (recipient_id = auth.uid() or public.has_permission('settings:read'));

drop policy if exists notification_rules_select on public.notification_rules;
create policy notification_rules_select
  on public.notification_rules
  for select
  to authenticated
  using (public.has_permission('settings:read'));

drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select
  on public.notification_deliveries
  for select
  to authenticated
  using (public.has_permission('settings:read'));

drop policy if exists notification_event_catalog_select on public.notification_event_catalog;
create policy notification_event_catalog_select
  on public.notification_event_catalog
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists telegram_links_select_own on public.telegram_links;
create policy telegram_links_select_own
  on public.telegram_links
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.notifications to authenticated;
grant select on public.notification_recipients to authenticated;
grant select on public.notification_rules to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.notification_event_catalog to authenticated;
grant select on public.telegram_links to authenticated;

revoke all on function public.notification_channel_settings() from public;
revoke all on function public.assert_notification_settings_read() from public;
revoke all on function public.assert_notification_settings_update() from public;
revoke all on function public.assert_service_role() from public;
revoke all on function public.collect_event_recipients(jsonb, text) from public;
revoke all on function public.process_domain_event(uuid) from public;
revoke all on function public.emit_domain_event(text, text, text, jsonb) from public;
revoke all on function public.process_pending_domain_events() from public;
revoke all on function public.list_my_notifications(integer) from public;
revoke all on function public.count_unread_notifications() from public;
revoke all on function public.mark_notifications_read() from public;
revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.list_notification_admin() from public;
revoke all on function public.upsert_notification_rule(uuid, text, text, uuid, boolean, boolean, boolean, boolean) from public;
revoke all on function public.delete_notification_rule(uuid) from public;
revoke all on function public.save_notification_channel_settings(boolean, text, text, boolean, text) from public;
revoke all on function public.claim_notification_deliveries(integer) from public;
revoke all on function public.record_notification_delivery(uuid, text, text) from public;
revoke all on function public.get_my_telegram_link() from public;
revoke all on function public.create_telegram_link_code() from public;
revoke all on function public.unlink_telegram() from public;
revoke all on function public.confirm_telegram_link(text, text, text) from public;

grant execute on function public.list_my_notifications(integer) to authenticated;
grant execute on function public.count_unread_notifications() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.list_notification_admin() to authenticated;
grant execute on function public.upsert_notification_rule(uuid, text, text, uuid, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.delete_notification_rule(uuid) to authenticated;
grant execute on function public.save_notification_channel_settings(boolean, text, text, boolean, text) to authenticated;
grant execute on function public.get_my_telegram_link() to authenticated;
grant execute on function public.create_telegram_link_code() to authenticated;
grant execute on function public.unlink_telegram() to authenticated;

do $$
begin
  grant execute on function public.process_pending_domain_events() to service_role;
  grant execute on function public.claim_notification_deliveries(integer) to service_role;
  grant execute on function public.record_notification_delivery(uuid, text, text) to service_role;
  grant execute on function public.confirm_telegram_link(text, text, text) to service_role;
exception
  when undefined_object then
    null;
end;
$$;

-- -----------------------------------------------------------------------------
-- [15/18 | was 15/151] 20260826400000_audit_log.sql
-- -----------------------------------------------------------------------------

-- Неизменяемый журнал действий: IP, RLS только audit:read, постраничный список.

alter table public.audit_events
  add column if not exists ip_address text,
  add column if not exists user_agent text;

comment on table public.audit_events is 'Неизменяемый журнал действий. Правка и удаление запрещены.';
comment on column public.audit_events.actor_id is 'Пользователь, выполнивший действие (actor_user_id).';
comment on column public.audit_events.ip_address is 'IP клиента из заголовков запроса, если доступен.';
comment on column public.audit_events.user_agent is 'User-Agent клиента, если доступен.';

create index if not exists audit_events_action_created_idx
  on public.audit_events (action, created_at desc);

create index if not exists audit_events_actor_created_idx
  on public.audit_events (actor_id, created_at desc);

create index if not exists audit_events_entity_type_created_idx
  on public.audit_events (entity_type, created_at desc);

create index if not exists audit_events_ip_idx
  on public.audit_events (ip_address)
  where ip_address is not null;

create or replace function public.audit_request_headers()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  raw text;
begin
  begin
    raw := current_setting('request.headers', true);
  exception
    when others then
      return '{}'::jsonb;
  end;

  if raw is null or btrim(raw) = '' then
    return '{}'::jsonb;
  end if;

  begin
    return raw::jsonb;
  exception
    when others then
      return '{}'::jsonb;
  end;
end;
$$;

create or replace function public.audit_client_ip()
returns text
language plpgsql
set search_path = public
as $$
declare
  headers jsonb;
  forwarded text;
  ip text;
begin
  headers := public.audit_request_headers();
  forwarded := btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1));
  ip := coalesce(
    nullif(forwarded, ''),
    nullif(btrim(coalesce(headers ->> 'x-real-ip', '')), ''),
    nullif(btrim(coalesce(headers ->> 'cf-connecting-ip', '')), '')
  );

  if ip is null then
    begin
      ip := host(inet_client_addr());
    exception
      when others then
        ip := null;
    end;
  end if;

  if ip is null or ip = '' then
    return null;
  end if;

  return left(ip, 64);
end;
$$;

create or replace function public.audit_client_user_agent()
returns text
language plpgsql
set search_path = public
as $$
declare
  ua text;
begin
  ua := btrim(coalesce(public.audit_request_headers() ->> 'user-agent', ''));
  if ua = '' then
    return null;
  end if;
  return left(ua, 512);
end;
$$;

create or replace function public.write_audit_event(
  actor_user_id uuid,
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
  if btrim(coalesce(action, '')) = '' or btrim(coalesce(entity_type, '')) = '' then
    raise exception 'Некорректное событие аудита.';
  end if;

  insert into public.audit_events (
    actor_id, action, entity_type, entity_id, metadata, ip_address, user_agent
  )
  values (
    actor_user_id,
    btrim(action),
    btrim(entity_type),
    nullif(btrim(coalesce(entity_id, '')), ''),
    coalesce(metadata, '{}'::jsonb),
    public.audit_client_ip(),
    public.audit_client_user_agent()
  );
end;
$$;

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
  perform public.write_audit_event(
    auth.uid(),
    action,
    entity_type,
    entity_id,
    coalesce(metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.record_auth_event(event_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  action_code text := btrim(coalesce(event_action, ''));
begin
  if auth.uid() is null then
    raise exception 'Нельзя записать аудит без авторизации.';
  end if;

  if action_code not in ('auth.signed_in', 'auth.signed_out', 'auth.password_updated') then
    raise exception 'Неизвестное событие.';
  end if;

  perform public.record_audit(action_code, 'session', auth.uid()::text, '{}'::jsonb);
end;
$$;

create or replace function public.forbid_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Записи журнала нельзя изменять.';
end;
$$;

drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update
  before update or delete on public.audit_events
  for each row execute procedure public.forbid_audit_mutation();

drop policy if exists audit_events_insert_own on public.audit_events;
drop policy if exists audit_events_select_own_or_audit_read on public.audit_events;

create policy audit_events_select_audit_read
  on public.audit_events
  for select
  to authenticated
  using (public.has_permission('audit:read'));

revoke all on table public.audit_events from public, anon, authenticated;

create or replace function public.list_audit_events(
  search_query text default '',
  actor_filter uuid default null,
  entity_type_filter text default '',
  action_filter text default '',
  from_date date default null,
  to_date date default null,
  page_number integer default 1,
  page_size integer default 50
)
returns table (
  id uuid,
  actor_id uuid,
  actor_name text,
  actor_email text,
  action text,
  entity_type text,
  entity_id text,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  escaped text;
  entity_value text;
  action_value text;
  safe_page integer;
  safe_size integer;
  from_ts timestamptz;
  to_ts timestamptz;
begin
  if not public.has_permission('audit:read') then
    raise exception 'Недостаточно прав для просмотра журнала.';
  end if;

  entity_value := nullif(btrim(coalesce(entity_type_filter, '')), '');
  action_value := nullif(btrim(coalesce(action_filter, '')), '');
  term := nullif(btrim(coalesce(search_query, '')), '');
  if term is not null then
    escaped := replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_');
    term := '%' || escaped || '%';
  end if;

  if from_date is not null then
    from_ts := from_date::timestamp at time zone 'Europe/Moscow';
  end if;
  if to_date is not null then
    to_ts := (to_date + 1)::timestamp at time zone 'Europe/Moscow';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 50), 1), 50);

  return query
  select
    e.id,
    e.actor_id,
    case
      when e.actor_id is null then 'Система'
      else coalesce(nullif(btrim(p.full_name), ''), p.email, 'Пользователь')
    end as actor_name,
    coalesce(p.email, '') as actor_email,
    e.action,
    e.entity_type,
    e.entity_id,
    e.metadata,
    e.ip_address,
    e.user_agent,
    e.created_at,
    count(*) over () as total_count
  from public.audit_events e
  left join public.profiles p on p.id = e.actor_id
  where (actor_filter is null or e.actor_id = actor_filter)
    and (entity_value is null or e.entity_type = entity_value)
    and (action_value is null or e.action = action_value)
    and (from_ts is null or e.created_at >= from_ts)
    and (to_ts is null or e.created_at < to_ts)
    and (
      term is null
      or e.action ilike term escape '\'
      or e.entity_type ilike term escape '\'
      or coalesce(e.entity_id, '') ilike term escape '\'
      or coalesce(p.full_name, '') ilike term escape '\'
      or coalesce(p.email, '') ilike term escape '\'
      or coalesce(e.ip_address, '') ilike term escape '\'
    )
  order by e.created_at desc, e.id desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

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
    or public.has_permission('audit:read')
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

    perform public.write_audit_event(
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

create or replace function public.create_order(
  target_customer_id uuid,
  target_device_id uuid,
  claimed_malfunction text,
  completeness text default '',
  external_condition text default '',
  target_deadline date default null,
  target_responsible_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  v_number text;
  v_seq integer;
  device_serial text;
  initial_status uuid;
  malfunction text;
begin
  if not public.has_permission('orders:create') then
    raise exception 'Недостаточно прав для создания заказа.';
  end if;

  malfunction := btrim(coalesce(claimed_malfunction, ''));
  if char_length(malfunction) < 1 then
    raise exception 'Укажите заявленную неисправность.';
  end if;

  if not exists (select 1 from public.customers where id = target_customer_id and is_active = true) then
    raise exception 'Клиент не найден.';
  end if;

  select serial_number into device_serial from public.devices where id = target_device_id;
  if device_serial is null then
    raise exception 'Прибор не найден.';
  end if;

  select m.status_id into initial_status
  from public.order_status_meta m
  join public.reference_items i on i.id = m.status_id
  where m.is_initial = true and i.is_active = true
  order by i.sort_order
  limit 1;

  if initial_status is null then
    raise exception 'Не задан начальный статус заказа.';
  end if;

  if target_responsible_id is not null
     and not exists (select 1 from public.profiles where id = target_responsible_id and is_active = true) then
    raise exception 'Ответственный сотрудник не найден.';
  end if;

  select n.order_number, n.seq into v_number, v_seq from public.next_order_number() as n;

  insert into public.orders (
    number, number_seq, customer_id, device_id, serial_number,
    claimed_malfunction, completeness, external_condition,
    deadline, responsible_id, status_id, created_by
  )
  values (
    v_number, v_seq, target_customer_id, target_device_id, device_serial,
    malfunction, btrim(coalesce(completeness, '')), btrim(coalesce(external_condition, '')),
    target_deadline, target_responsible_id, initial_status, auth.uid()
  )
  returning id into result_id;

  insert into public.order_status_events (order_id, from_status_id, to_status_id, actor_id, metadata)
  values (result_id, null, initial_status, auth.uid(), jsonb_build_object('source', 'create'));

  perform public.record_audit(
    'orders.created',
    'order',
    result_id::text,
    jsonb_build_object('number', v_number)
  );

  if target_responsible_id is not null then
    perform public.record_audit(
      'orders.assigned',
      'order',
      result_id::text,
      jsonb_build_object('responsible_id', target_responsible_id, 'number', v_number)
    );

    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      result_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', result_id,
        'order_number', v_number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || v_number
      )
    );
  end if;

  return result_id;
end;
$$;

create or replace function public.update_order(
  target_order_id uuid,
  claimed_malfunction text default null,
  completeness text default null,
  external_condition text default null,
  target_deadline date default null,
  clear_deadline boolean default false,
  target_responsible_id uuid default null,
  change_responsible boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
  previous_responsible uuid;
  field_changed boolean;
  assigned boolean;
begin
  select * into current_row from public.orders where id = target_order_id for update;
  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  if claimed_malfunction is not null or completeness is not null or external_condition is not null
     or target_deadline is not null or clear_deadline then
    if not public.has_permission('orders:update') then
      raise exception 'Недостаточно прав для изменения заказа.';
    end if;
  end if;

  if change_responsible and not (public.has_permission('orders:assign') or public.has_permission('orders:update')) then
    raise exception 'Недостаточно прав для назначения ответственного.';
  end if;

  if claimed_malfunction is not null and char_length(btrim(claimed_malfunction)) < 1 then
    raise exception 'Укажите заявленную неисправность.';
  end if;

  previous_responsible := current_row.responsible_id;
  field_changed := claimed_malfunction is not null
    or completeness is not null
    or external_condition is not null
    or target_deadline is not null
    or clear_deadline;
  assigned := change_responsible and target_responsible_id is distinct from previous_responsible;

  update public.orders
  set
    claimed_malfunction = case
      when claimed_malfunction is not null then btrim(claimed_malfunction)
      else orders.claimed_malfunction
    end,
    completeness = case
      when completeness is not null then btrim(completeness)
      else orders.completeness
    end,
    external_condition = case
      when external_condition is not null then btrim(external_condition)
      else orders.external_condition
    end,
    deadline = case
      when clear_deadline then null
      when target_deadline is not null then target_deadline
      else orders.deadline
    end,
    responsible_id = case
      when change_responsible then target_responsible_id
      else orders.responsible_id
    end
  where id = target_order_id;

  if assigned then
    perform public.emit_domain_event(
      'responsible_assigned',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'actor_id', auth.uid(),
        'order_id', target_order_id,
        'order_number', current_row.number,
        'responsible_id', target_responsible_id,
        'title', 'Назначен заказ',
        'body', 'Вам назначен заказ ' || current_row.number
      )
    );

    perform public.record_audit(
      'orders.assigned',
      'order',
      target_order_id::text,
      jsonb_build_object(
        'previous_responsible_id', previous_responsible,
        'responsible_id', target_responsible_id,
        'number', current_row.number
      )
    );
  end if;

  if field_changed then
    perform public.record_audit('orders.updated', 'order', target_order_id::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.delete_document_template(target_template_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.document_templates%rowtype;
begin
  perform public.assert_templates_edit();

  select * into current_row
  from public.document_templates
  where id = target_template_id
  for update;

  if current_row.id is null then
    raise exception 'Шаблон не найден.';
  end if;

  if current_row.is_system then
    raise exception 'Системный шаблон нельзя удалить.';
  end if;

  if exists (select 1 from public.documents where template_id = target_template_id) then
    raise exception 'Шаблон уже использован в документах.';
  end if;

  delete from public.document_templates
  where id = target_template_id;

  perform public.record_audit(
    'document.template_deactivated',
    'document_template',
    target_template_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.code = 'audit:read'
where r.code = 'manager'
on conflict do nothing;

revoke all on function public.audit_request_headers() from public, anon, authenticated;
revoke all on function public.audit_client_ip() from public, anon, authenticated;
revoke all on function public.audit_client_user_agent() from public, anon, authenticated;
revoke all on function public.write_audit_event(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_audit(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_auth_event(text) from public, anon, authenticated;
revoke all on function public.forbid_audit_mutation() from public, anon, authenticated;
revoke all on function public.list_audit_events(text, uuid, text, text, date, date, integer, integer) from public, anon, authenticated;

grant execute on function public.record_auth_event(text) to authenticated;
grant execute on function public.list_audit_events(text, uuid, text, text, date, date, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- [16/18 | was 16/151] 20260826500000_data_import.sql
-- -----------------------------------------------------------------------------

-- Журнал импорта: идемпотентные ключи источника, прогон, ошибки по строкам.
-- Импорт выполняется скриптами со service_role, не из React.

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('full', 'delta')),
  status text not null check (status in ('preview', 'running', 'completed', 'failed', 'interrupted')),
  dry_run boolean not null default false,
  source_dir text not null default '',
  totals jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create index if not exists import_runs_started_idx
  on public.import_runs (started_at desc);

create table if not exists public.import_source_keys (
  dataset text not null,
  source_key text not null,
  entity_type text not null,
  entity_id text not null,
  payload_hash text not null,
  last_run_id uuid references public.import_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dataset, source_key)
);

create index if not exists import_source_keys_entity_idx
  on public.import_source_keys (entity_type, entity_id);

create trigger import_source_keys_set_updated_at
  before update on public.import_source_keys
  for each row execute procedure public.set_updated_at();

create table if not exists public.import_row_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.import_runs (id) on delete cascade,
  dataset text not null,
  row_number integer not null,
  source_key text,
  status text not null check (status in ('created', 'updated', 'skipped', 'failed')),
  missing_fields text[] not null default '{}',
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists import_row_results_run_idx
  on public.import_row_results (run_id, dataset, row_number);

create index if not exists import_row_results_failed_idx
  on public.import_row_results (run_id, status)
  where status = 'failed';

comment on table public.import_runs is 'Прогоны миграции данных (полный и дельта). Не часть UI.';
comment on table public.import_source_keys is 'Стабильные ключи источника для идемпотентного импорта.';
comment on table public.import_row_results is 'Результат по каждой строке: создано/обновлено/пропущено/ошибка.';

alter table public.import_runs enable row level security;
alter table public.import_source_keys enable row level security;
alter table public.import_row_results enable row level security;

revoke all on table public.import_runs from public, anon, authenticated;
revoke all on table public.import_source_keys from public, anon, authenticated;
revoke all on table public.import_row_results from public, anon, authenticated;

grant all on table public.import_runs to service_role;
grant all on table public.import_source_keys to service_role;
grant all on table public.import_row_results to service_role;

-- -----------------------------------------------------------------------------
-- [17/18 | was 17/151] 20260826600000_dashboard.sql
-- -----------------------------------------------------------------------------

-- Операционный рабочий стол и фильтр нулевого остатка для перехода со сводки.

drop function if exists public.search_inventory_items(text, integer, integer);
drop function if exists public.search_inventory_items(text, integer, integer, text);

create function public.search_inventory_items(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  stock_filter text default 'all'
)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  term text;
  safe_page integer;
  safe_size integer;
  stock_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('orders:read')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для просмотра склада.';
  end if;

  stock_value := coalesce(nullif(btrim(stock_filter), ''), 'all');
  if stock_value not in ('all', 'zero') then
    raise exception 'Неизвестный фильтр остатка.';
  end if;

  term := '%' || replace(replace(replace(btrim(coalesce(search_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  with stock as (
    select m.item_id, coalesce(sum(m.quantity), 0) as qty
    from public.inventory_movements m
    group by m.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where (
      btrim(coalesce(search_query, '')) = ''
      or i.name ilike term escape '\'
      or i.code ilike term escape '\'
      or i.article ilike term escape '\'
      or i.barcode ilike term escape '\'
    )
    and (stock_value <> 'zero' or coalesce(stock.qty, 0) <= 0)
  order by i.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_operational_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  can_orders boolean := public.has_permission('orders:read');
  can_tasks boolean := public.has_permission('tasks:read');
  can_inventory boolean := public.has_permission('inventory:read');
  can_notifications boolean := public.has_permission('notifications:read');
  result jsonb;
begin
  if not public.has_permission('dashboard:read') then
    raise exception 'Недостаточно прав.';
  end if;

  result := jsonb_build_object(
    'can_orders', can_orders,
    'can_tasks', can_tasks,
    'can_inventory', can_inventory,
    'can_notifications', can_notifications,
    'can_diagnostics', public.has_permission('diagnostics:read')
  );

  if can_orders then
    result := result || jsonb_build_object(
      'orders', jsonb_build_object(
        'active', (select count(*) from public.order_list_items where not is_terminal),
        'attention', (
          select count(*) from public.order_list_items
          where not is_terminal
            and (
              deadline_state in ('overdue', 'approaching')
              or status_code = 'waiting_approval'
            )
        ),
        'overdue', (
          select count(*) from public.order_list_items
          where not is_terminal and deadline_state = 'overdue'
        ),
        'approaching', (
          select count(*) from public.order_list_items
          where not is_terminal and deadline_state = 'approaching'
        ),
        'waiting_approval', (
          select count(*) from public.order_list_items
          where not is_terminal and status_code = 'waiting_approval'
        ),
        'repair', (
          select count(*) from public.order_list_items
          where not is_terminal and status_code = 'repair'
        ),
        'diagnostics', (
          select count(*) from public.order_list_items
          where not is_terminal and status_code = 'diagnostics'
        ),
        'mine_active', (
          select count(*) from public.order_list_items
          where not is_terminal and responsible_id = auth.uid()
        ),
        'mine_overdue', (
          select count(*) from public.order_list_items
          where not is_terminal and responsible_id = auth.uid() and deadline_state = 'overdue'
        ),
        'mine_diagnostics', (
          select count(*) from public.order_list_items
          where not is_terminal and responsible_id = auth.uid() and status_code = 'diagnostics'
        ),
        'overdue_items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'number', o.number,
                'customer_name', o.customer_name,
                'status_code', o.status_code,
                'status_name', o.status_name,
                'deadline', o.deadline,
                'deadline_state', o.deadline_state,
                'responsible_name', o.responsible_name
              )
              order by o.deadline, o.number
            ),
            '[]'::jsonb
          )
          from (
            select id, number, customer_name, status_code, status_name, deadline, deadline_state, responsible_name
            from public.order_list_items
            where not is_terminal and deadline_state = 'overdue'
            order by deadline, number
            limit 5
          ) o
        ),
        'mine_items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'number', o.number,
                'customer_name', o.customer_name,
                'status_code', o.status_code,
                'status_name', o.status_name,
                'deadline', o.deadline,
                'deadline_state', o.deadline_state,
                'responsible_name', o.responsible_name
              )
              order by o.priority, o.deadline nulls last, o.number
            ),
            '[]'::jsonb
          )
          from (
            select
              id,
              number,
              customer_name,
              status_code,
              status_name,
              deadline,
              deadline_state,
              responsible_name,
              case deadline_state when 'overdue' then 0 when 'approaching' then 1 else 2 end as priority
            from public.order_list_items
            where not is_terminal and responsible_id = auth.uid()
            order by
              case deadline_state when 'overdue' then 0 when 'approaching' then 1 else 2 end,
              deadline nulls last,
              number
            limit 5
          ) o
        ),
        'repair_items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'number', o.number,
                'customer_name', o.customer_name,
                'status_code', o.status_code,
                'status_name', o.status_name,
                'deadline', o.deadline,
                'deadline_state', o.deadline_state,
                'responsible_name', o.responsible_name
              )
              order by o.updated_at desc
            ),
            '[]'::jsonb
          )
          from (
            select id, number, customer_name, status_code, status_name, deadline, deadline_state, responsible_name, updated_at
            from public.order_list_items
            where not is_terminal and status_code = 'repair'
            order by updated_at desc
            limit 5
          ) o
        )
      )
    );
  end if;

  if can_tasks then
    result := result || jsonb_build_object(
      'tasks', jsonb_build_object(
        'open', (select count(*) from public.tasks where not completed),
        'mine_open', (select count(*) from public.tasks where not completed and assignee_id = auth.uid()),
        'mine_today', (
          select count(*) from public.tasks
          where not completed and assignee_id = auth.uid() and due_date = current_date
        ),
        'mine_overdue', (
          select count(*) from public.tasks
          where not completed and assignee_id = auth.uid() and due_date is not null and due_date < current_date
        ),
        'mine_items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'title', t.title,
                'due_date', t.due_date,
                'priority', t.priority,
                'order_number', coalesce(o.number, '')
              )
              order by t.sort_key, t.due_date nulls last, t.created_at
            ),
            '[]'::jsonb
          )
          from (
            select
              tasks.id,
              tasks.title,
              tasks.due_date,
              tasks.priority,
              tasks.order_id,
              tasks.created_at,
              case
                when tasks.due_date is not null and tasks.due_date < current_date then 0
                when tasks.due_date = current_date then 1
                else 2
              end as sort_key
            from public.tasks
            where not completed and assignee_id = auth.uid()
            order by
              case
                when due_date is not null and due_date < current_date then 0
                when due_date = current_date then 1
                else 2
              end,
              due_date nulls last,
              created_at
            limit 5
          ) t
          left join public.orders o on o.id = t.order_id
        )
      )
    );
  end if;

  if can_notifications then
    result := result || jsonb_build_object(
      'notifications', jsonb_build_object(
        'unread', (
          select count(*) from public.notification_recipients nr
          where nr.recipient_id = auth.uid() and not nr.is_read
        ),
        'items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', n.id,
                'title', n.title,
                'body', n.body,
                'entity_type', n.entity_type,
                'entity_id', n.entity_id,
                'created_at', n.created_at
              )
              order by n.created_at desc
            ),
            '[]'::jsonb
          )
          from (
            select n.id, n.title, n.body, n.entity_type, n.entity_id, n.created_at
            from public.notification_recipients nr
            join public.notifications n on n.id = nr.notification_id
            where nr.recipient_id = auth.uid() and not nr.is_read
            order by n.created_at desc
            limit 5
          ) n
        )
      )
    );
  end if;

  if can_inventory then
    result := result || jsonb_build_object(
      'inventory', jsonb_build_object(
        'zero_stock', (
          select count(*) from (
            select i.id, coalesce(sum(m.quantity), 0) as qty
            from public.inventory_items i
            left join public.inventory_movements m on m.item_id = i.id
            group by i.id
          ) s
          where s.qty <= 0
        ),
        'items', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', s.id,
                'name', s.name,
                'code', s.code,
                'stock_quantity', s.qty
              )
              order by s.name
            ),
            '[]'::jsonb
          )
          from (
            select i.id, i.name, i.code, coalesce(sum(m.quantity), 0) as qty
            from public.inventory_items i
            left join public.inventory_movements m on m.item_id = i.id
            group by i.id, i.name, i.code
            having coalesce(sum(m.quantity), 0) <= 0
            order by i.name
            limit 5
          ) s
        )
      )
    );
  end if;

  return result;
end;
$$;

revoke all on function public.search_inventory_items(text, integer, integer, text) from public, anon;
revoke all on function public.get_operational_dashboard() from public, anon;

grant execute on function public.search_inventory_items(text, integer, integer, text) to authenticated;
grant execute on function public.get_operational_dashboard() to authenticated;

-- -----------------------------------------------------------------------------
-- [18/18 | was 18/151] 20260826700000_security_hardening.sql
-- -----------------------------------------------------------------------------

-- Ужесточение доступа: приглашения, RLS, хранилище, служебные вызовы.

alter table public.profiles
  alter column is_active set default false;

drop policy if exists profiles_update_own on public.profiles;

drop policy if exists roles_select_authenticated on public.roles;
create policy roles_select_authenticated
  on public.roles
  for select
  to authenticated
  using (
    public.has_permission('roles:read')
    or public.has_permission('users:read')
    or public.has_permission('users:invite')
  );

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select
  on public.app_settings
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('settings:read')
      or (
        key in ('order_number', 'deadline')
        and (
          public.has_permission('orders:read')
          or public.has_permission('orders:create')
        )
      )
    )
  );

create or replace function public.assert_service_role()
returns void
language plpgsql
stable
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Только служебный вызов.';
  end if;
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
  invited boolean := false;
begin
  select *
    into invitation
  from public.invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
  order by created_at desc
  limit 1;

  invited := invitation.id is not null;

  insert into public.profiles (id, full_name, email, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    invited
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when profiles.full_name = '' then excluded.full_name
          else profiles.full_name
        end,
        is_active = public.profiles.is_active or excluded.is_active;

  if invited then
    insert into public.user_roles (user_id, role_id, assigned_by)
    values (new.id, invitation.role_id, invitation.invited_by)
    on conflict (user_id) do nothing;

    update public.invitations
    set status = 'accepted',
        accepted_at = now(),
        auth_user_id = new.id
    where id = invitation.id;

    perform public.write_audit_event(
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

create or replace function public.set_role_permissions(target_role_id uuid, permission_codes text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_codes text[];
  unknown_code text;
  target_code text;
  next_codes text[] := coalesce(permission_codes, '{}'::text[]);
begin
  if not public.has_permission('roles:update') or not public.has_role('director') then
    raise exception 'Изменять матрицу прав может только руководитель.';
  end if;

  select code into target_code from public.roles where id = target_role_id;
  if target_code is null then
    raise exception 'Роль не найдена.';
  end if;

  select c.code
    into unknown_code
  from unnest(next_codes) as c(code)
  left join public.permissions p on p.code = c.code
  where p.id is null
  limit 1;

  if unknown_code is not null then
    raise exception 'Неизвестный код права.';
  end if;

  if target_code = 'director' then
    if not (
      'roles:update' = any (next_codes)
      and 'users:update' = any (next_codes)
      and 'users:invite' = any (next_codes)
    ) then
      raise exception 'У руководителя нельзя убрать управление доступом.';
    end if;
  elsif 'roles:update' = any (next_codes) then
    raise exception 'Право на изменение ролей можно оставить только у руководителя.';
  end if;

  select array_agg(p.code order by p.code)
    into previous_codes
  from public.role_permissions rp
  join public.permissions p on p.id = rp.permission_id
  where rp.role_id = target_role_id;

  delete from public.role_permissions where role_id = target_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, p.id
  from public.permissions p
  where p.code = any (next_codes);

  perform public.record_audit(
    'roles.permissions_changed',
    'role',
    target_role_id::text,
    jsonb_build_object(
      'previous_codes', to_jsonb(coalesce(previous_codes, '{}'::text[])),
      'codes', to_jsonb(next_codes)
    )
  );
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

  insert into public.order_attachments (
    order_id, kind, file_path, file_name, mime_type, file_size, caption, created_by
  )
  values (
    target_order_id,
    kind,
    normalized_path,
    left(btrim(coalesce(file_name, 'file')), 200),
    mime_type,
    file_size,
    btrim(coalesce(caption, '')),
    auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

drop policy if exists order_attachments_insert on storage.objects;
create policy order_attachments_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'order-attachments'
    and (public.has_permission('orders:create') or public.has_permission('orders:update'))
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 1
  );

drop policy if exists order_attachments_select on storage.objects;
create policy order_attachments_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'order-attachments'
    and public.has_permission('orders:read')
    and exists (
      select 1
      from public.order_attachments a
      where a.file_path = name
        and public.has_permission('orders:read')
    )
  );

revoke all on function public.process_order_deadline_notifications() from public, anon, authenticated;
revoke all on function public.assert_service_role() from public, anon, authenticated;
revoke all on function public.set_role_permissions(uuid, text[]) from public, anon, authenticated;
revoke all on function public.register_order_file(uuid, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.register_order_file(uuid, text, text, text, integer, text) to authenticated;

do $$
begin
  grant execute on function public.process_order_deadline_notifications() to service_role;
  grant execute on function public.assert_service_role() to service_role;
exception
  when undefined_object then
    null;
end;
$$;

do $$
declare
  rel record;
begin
  for rel in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format(
      'revoke insert, update, delete, truncate on table public.%I from public, anon, authenticated',
      rel.name
    );
  end loop;
end;
$$;

