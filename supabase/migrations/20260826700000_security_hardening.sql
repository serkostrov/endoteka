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
