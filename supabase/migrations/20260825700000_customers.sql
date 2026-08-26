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
