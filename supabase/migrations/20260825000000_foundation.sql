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
