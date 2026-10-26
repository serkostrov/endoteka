-- CRUD ролей: is_system, create_role / update_role / delete_role.

alter table public.roles
  add column if not exists is_system boolean not null default false;

update public.roles
set is_system = true
where code in (
  'manager',
  'diagnostic_engineer',
  'chief_engineer',
  'storekeeper',
  'director'
);

create unique index if not exists roles_name_lower_uidx
  on public.roles (lower(btrim(name)));

-- Генерация code из названия (кириллица → латиница, snake_case).
create or replace function public.slugify_role_code(raw_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  src text;
  result text;
begin
  src := lower(btrim(coalesce(raw_name, '')));
  src := replace(src, 'ё', 'e');
  src := replace(src, 'ж', 'zh');
  src := replace(src, 'х', 'h');
  src := replace(src, 'ц', 'c');
  src := replace(src, 'ч', 'ch');
  src := replace(src, 'ш', 'sh');
  src := replace(src, 'щ', 'sch');
  src := replace(src, 'ъ', '');
  src := replace(src, 'ь', '');
  src := replace(src, 'ю', 'yu');
  src := replace(src, 'я', 'ya');
  src := translate(src, 'абвгдезийклмнопрстуфыэ', 'abvgdeziyklmnoprstufye');
  result := regexp_replace(src, '[^a-z0-9]+', '_', 'g');
  result := regexp_replace(result, '^_+|_+$', '', 'g');
  result := regexp_replace(result, '_+', '_', 'g');

  if result = '' or result !~ '^[a-z]' then
    result := 'custom_' || coalesce(nullif(result, ''), 'role');
  end if;

  if length(result) > 60 then
    result := left(result, 60);
    result := regexp_replace(result, '_+$', '', 'g');
  end if;

  return result;
end;
$$;

create or replace function public.create_role(
  p_name text,
  p_description text default null,
  p_copy_from_role_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_name text;
  normalized_description text;
  base_code text;
  next_code text;
  suffix integer := 1;
  new_id uuid;
  source_code text;
begin
  if not public.has_permission('roles:update') or not public.has_role('director') then
    raise exception 'Создавать роли может только руководитель.';
  end if;

  normalized_name := btrim(coalesce(p_name, ''));
  if normalized_name = '' then
    raise exception 'Укажите название роли.';
  end if;

  if length(normalized_name) > 80 then
    raise exception 'Название роли слишком длинное.';
  end if;

  if exists (
    select 1 from public.roles r where lower(btrim(r.name)) = lower(normalized_name)
  ) then
    raise exception 'Роль с таким названием уже существует.';
  end if;

  normalized_description := nullif(btrim(coalesce(p_description, '')), '');

  base_code := public.slugify_role_code(normalized_name);
  if exists (select 1 from public.roles r where r.code = base_code and r.is_system) then
    base_code := 'custom_' || base_code;
    if length(base_code) > 60 then
      base_code := left(base_code, 60);
      base_code := regexp_replace(base_code, '_+$', '', 'g');
    end if;
  end if;

  next_code := base_code;
  while exists (select 1 from public.roles r where r.code = next_code) loop
    suffix := suffix + 1;
    next_code := left(base_code, greatest(1, 60 - length('_' || suffix::text))) || '_' || suffix::text;
  end loop;

  if p_copy_from_role_id is not null then
    select code into source_code from public.roles where id = p_copy_from_role_id;
    if source_code is null then
      raise exception 'Роль для копирования прав не найдена.';
    end if;
  end if;

  insert into public.roles (code, name, description, is_system)
  values (next_code, normalized_name, normalized_description, false)
  returning id into new_id;

  if p_copy_from_role_id is not null then
    insert into public.role_permissions (role_id, permission_id)
    select new_id, rp.permission_id
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    where rp.role_id = p_copy_from_role_id
      and p.code <> 'roles:update';
  end if;

  perform public.record_audit(
    'roles.created',
    'role',
    new_id::text,
    jsonb_build_object(
      'code', next_code,
      'name', normalized_name,
      'copy_from_role_id', p_copy_from_role_id
    )
  );

  return new_id;
end;
$$;

create or replace function public.update_role(
  p_role_id uuid,
  p_name text,
  p_description text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.roles%rowtype;
  normalized_name text;
  normalized_description text;
begin
  if not public.has_permission('roles:update') or not public.has_role('director') then
    raise exception 'Изменять роли может только руководитель.';
  end if;

  select * into current_row from public.roles where id = p_role_id;
  if current_row.id is null then
    raise exception 'Роль не найдена.';
  end if;

  normalized_name := btrim(coalesce(p_name, ''));
  if normalized_name = '' then
    raise exception 'Укажите название роли.';
  end if;

  if length(normalized_name) > 80 then
    raise exception 'Название роли слишком длинное.';
  end if;

  if exists (
    select 1
    from public.roles r
    where lower(btrim(r.name)) = lower(normalized_name)
      and r.id <> p_role_id
  ) then
    raise exception 'Роль с таким названием уже существует.';
  end if;

  normalized_description := nullif(btrim(coalesce(p_description, '')), '');

  update public.roles
  set
    name = normalized_name,
    description = normalized_description
  where id = p_role_id;

  perform public.record_audit(
    'roles.updated',
    'role',
    p_role_id::text,
    jsonb_build_object(
      'code', current_row.code,
      'previous_name', current_row.name,
      'name', normalized_name,
      'previous_description', current_row.description,
      'description', normalized_description
    )
  );
end;
$$;

create or replace function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.roles%rowtype;
  users_count integer;
  invites_count integer;
begin
  if not public.has_permission('roles:update') or not public.has_role('director') then
    raise exception 'Удалять роли может только руководитель.';
  end if;

  select * into current_row from public.roles where id = p_role_id;
  if current_row.id is null then
    raise exception 'Роль не найдена.';
  end if;

  if current_row.is_system then
    raise exception 'Системную роль удалить нельзя.';
  end if;

  select count(*)::integer into users_count
  from public.user_roles
  where role_id = p_role_id;

  if users_count > 0 then
    raise exception 'Сначала назначьте сотрудникам другую роль.';
  end if;

  select count(*)::integer into invites_count
  from public.invitations
  where role_id = p_role_id
    and status = 'pending';

  if invites_count > 0 then
    raise exception 'Есть незавершённые приглашения с этой ролью. Отмените их или дождитесь принятия.';
  end if;

  if exists (select 1 from public.invitations where role_id = p_role_id) then
    raise exception 'Роль использовалась в приглашениях и не может быть удалена.';
  end if;

  delete from public.roles where id = p_role_id;

  perform public.record_audit(
    'roles.deleted',
    'role',
    p_role_id::text,
    jsonb_build_object(
      'code', current_row.code,
      'name', current_row.name
    )
  );
end;
$$;

drop function if exists public.get_assignable_roles();

create or replace function public.get_assignable_roles()
returns table (
  id uuid,
  code text,
  name text,
  description text,
  is_system boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.code, r.name, r.description, r.is_system
  from public.roles r
  where public.can_assign_role(r.id)
  order by r.name;
$$;

revoke all on function public.slugify_role_code(text) from public, anon, authenticated;
revoke all on function public.create_role(text, text, uuid) from public, anon, authenticated;
revoke all on function public.update_role(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_role(uuid) from public, anon, authenticated;
revoke all on function public.get_assignable_roles() from public, anon, authenticated;

grant execute on function public.create_role(text, text, uuid) to authenticated;
grant execute on function public.update_role(uuid, text, text) to authenticated;
grant execute on function public.delete_role(uuid) to authenticated;
grant execute on function public.get_assignable_roles() to authenticated;
