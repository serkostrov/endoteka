create table public.service_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  unit_price numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_templates_name_present check (btrim(name) <> ''),
  constraint service_templates_price_nonneg check (unit_price >= 0)
);

create unique index service_templates_name_unique
  on public.service_templates (lower(btrim(name)));

create trigger service_templates_set_updated_at
  before update on public.service_templates
  for each row execute procedure public.set_updated_at();

create table public.order_service_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  template_id uuid references public.service_templates (id) on delete set null,
  name text not null,
  quantity numeric(14, 3) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_service_lines_name_present check (btrim(name) <> ''),
  constraint order_service_lines_qty_positive check (quantity > 0),
  constraint order_service_lines_price_nonneg check (unit_price >= 0)
);

create unique index order_service_lines_order_template_unique
  on public.order_service_lines (order_id, template_id)
  where template_id is not null;

create index order_service_lines_order_id_idx on public.order_service_lines (order_id);

create trigger order_service_lines_set_updated_at
  before update on public.order_service_lines
  for each row execute procedure public.set_updated_at();

alter table public.service_templates enable row level security;
alter table public.order_service_lines enable row level security;

revoke all on table public.service_templates from public, anon, authenticated;
revoke all on table public.order_service_lines from public, anon, authenticated;

create or replace function public.search_service_templates(
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20,
  active_only boolean default false
)
returns table (
  id uuid,
  name text,
  description text,
  unit_price numeric,
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
  term text := btrim(coalesce(search_query, ''));
  safe_page integer := greatest(coalesce(page_number, 1), 1);
  safe_size integer := least(greatest(coalesce(page_size, 20), 1), 100);
begin
  if not (
    public.has_permission('settings:read')
    or public.has_permission('orders:read')
  ) then
    raise exception 'Недостаточно прав для просмотра услуг.';
  end if;

  return query
  with filtered as (
    select t.*
    from public.service_templates t
    where (not active_only or t.is_active)
      and (
        term = ''
        or t.name ilike '%' || term || '%'
        or t.description ilike '%' || term || '%'
      )
  )
  select
    f.id,
    f.name,
    f.description,
    f.unit_price,
    f.is_active,
    f.created_at,
    f.updated_at,
    (select count(*) from filtered) as total_count
  from filtered f
  order by f.name
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.create_service_template(
  template_name text,
  template_description text default '',
  template_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not (
    public.has_permission('settings:update')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для создания услуги.';
  end if;

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(template_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if exists (
    select 1
    from public.service_templates
    where lower(btrim(name)) = lower(btrim(template_name))
  ) then
    raise exception 'Такое наименование уже в справочнике';
  end if;

  insert into public.service_templates (name, description, unit_price, created_by)
  values (
    btrim(template_name),
    btrim(coalesce(template_description, '')),
    coalesce(template_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_created',
    'service_template',
    new_id::text,
    jsonb_build_object('name', btrim(template_name))
  );

  return new_id;
end;
$$;

create or replace function public.update_service_template(
  target_id uuid,
  template_name text,
  template_description text default '',
  template_unit_price numeric default 0,
  template_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения услуги.';
  end if;

  if btrim(coalesce(template_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(template_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if exists (
    select 1
    from public.service_templates
    where lower(btrim(name)) = lower(btrim(template_name))
      and id <> target_id
  ) then
    raise exception 'Такое наименование уже в справочнике';
  end if;

  update public.service_templates
  set
    name = btrim(template_name),
    description = btrim(coalesce(template_description, '')),
    unit_price = coalesce(template_unit_price, 0),
    is_active = coalesce(template_is_active, true)
  where id = target_id;

  if not found then
    raise exception 'Услуга не найдена.';
  end if;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_updated',
    'service_template',
    target_id::text,
    jsonb_build_object('name', btrim(template_name))
  );
end;
$$;

create or replace function public.delete_service_template(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  template_name text;
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для удаления услуги.';
  end if;

  if exists (select 1 from public.order_service_lines where template_id = target_id) then
    raise exception 'Услуга используется в заказах. Удаление недоступно.';
  end if;

  select name into template_name from public.service_templates where id = target_id;
  if template_name is null then
    raise exception 'Услуга не найдена.';
  end if;

  delete from public.service_templates where id = target_id;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_deleted',
    'service_template',
    target_id::text,
    jsonb_build_object('name', template_name)
  );
end;
$$;

create or replace function public.get_order_service_lines(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав для состава заказа.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'order_id', l.order_id,
      'template_id', l.template_id,
      'name', l.name,
      'description', coalesce(t.description, ''),
      'quantity', l.quantity,
      'unit_price', l.unit_price,
      'created_at', l.created_at
    ) order by l.created_at)
    from public.order_service_lines l
    left join public.service_templates t on t.id = l.template_id
    where l.order_id = target_order_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.add_order_service_line(
  target_order_id uuid,
  target_template_id uuid,
  line_quantity numeric,
  line_unit_price numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  template_name text;
  line_id uuid;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  select name into template_name
  from public.service_templates
  where id = target_template_id and is_active;

  if template_name is null then
    raise exception 'Услуга не найдена.';
  end if;

  insert into public.order_service_lines (
    order_id, template_id, name, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    target_template_id,
    template_name,
    line_quantity,
    line_unit_price,
    auth.uid()
  )
  on conflict (order_id, template_id) where template_id is not null
  do update set
    quantity = public.order_service_lines.quantity + excluded.quantity,
    unit_price = excluded.unit_price
  returning id into line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'service_added',
    auth.uid(),
    'Добавлена услуга: ' || template_name || ' × ' || trim(to_char(line_quantity, '999999990.999')),
    jsonb_build_object(
      'line_id', line_id,
      'template_id', target_template_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_added',
    'order',
    target_order_id::text,
    jsonb_build_object('name', template_name, 'quantity', line_quantity)
  );

  return line_id;
end;
$$;

create or replace function public.set_order_service_line(
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
  target_order uuid;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_service_lines
  set quantity = line_quantity, unit_price = line_unit_price
  where id = target_line_id
  returning order_id into target_order;

  if target_order is null then
    raise exception 'Строка услуги не найдена.';
  end if;

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_updated',
    'order',
    target_order::text,
    jsonb_build_object('line_id', target_line_id, 'quantity', line_quantity, 'unit_price', line_unit_price)
  );
end;
$$;

create or replace function public.remove_order_service_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid;
  line_name text;
  line_qty numeric;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  select order_id, name, quantity
  into target_order, line_name, line_qty
  from public.order_service_lines
  where id = target_line_id;

  if target_order is null then
    raise exception 'Строка услуги не найдена.';
  end if;

  delete from public.order_service_lines where id = target_line_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order,
    'service_removed',
    auth.uid(),
    'Удалена услуга: ' || coalesce(line_name, 'услуга') || ' × ' || trim(to_char(coalesce(line_qty, 0), '999999990.999')),
    jsonb_build_object('line_id', target_line_id, 'name', line_name)
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_removed',
    'order',
    target_order::text,
    jsonb_build_object('name', line_name)
  );
end;
$$;

revoke all on function public.search_service_templates(text, integer, integer, boolean) from public, anon;
revoke all on function public.create_service_template(text, text, numeric) from public, anon;
revoke all on function public.update_service_template(uuid, text, text, numeric, boolean) from public, anon;
revoke all on function public.delete_service_template(uuid) from public, anon;
revoke all on function public.get_order_service_lines(uuid) from public, anon;
revoke all on function public.add_order_service_line(uuid, uuid, numeric, numeric) from public, anon;
revoke all on function public.set_order_service_line(uuid, numeric, numeric) from public, anon;
revoke all on function public.remove_order_service_line(uuid) from public, anon;

grant execute on function public.search_service_templates(text, integer, integer, boolean) to authenticated;
grant execute on function public.create_service_template(text, text, numeric) to authenticated;
grant execute on function public.update_service_template(uuid, text, text, numeric, boolean) to authenticated;
grant execute on function public.delete_service_template(uuid) to authenticated;
grant execute on function public.get_order_service_lines(uuid) to authenticated;
grant execute on function public.add_order_service_line(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.set_order_service_line(uuid, numeric, numeric) to authenticated;
grant execute on function public.remove_order_service_line(uuid) to authenticated;

notify pgrst, 'reload schema';
