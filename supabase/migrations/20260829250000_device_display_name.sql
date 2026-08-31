-- Название прибора: тип → производитель → модель. Серийный номер отдельно.

create or replace function public.device_display_name(group_name text, brand_name text, model_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      concat_ws(
        ' · ',
        nullif(btrim(coalesce(group_name, '')), ''),
        nullif(btrim(coalesce(brand_name, '')), ''),
        nullif(btrim(coalesce(model_name, '')), '')
      ),
      ''
    ),
    'Прибор'
  );
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
  public.device_display_name(grp.name, brand.name, model.name) as label,
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
  public.device_display_name(grp.name, brand.name, model.name) as device_label,
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
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

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
    'label', public.device_display_name(grp.name, brand.name, model.name),
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
          'label', public.device_display_name(grp.name, brand.name, model.name),
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

create or replace function public.write_order_journal_on_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.device_id is not distinct from old.device_id then
    return new;
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    new.id,
    'device_changed',
    auth.uid(),
    'Прибор: серийный номер ' || coalesce(nullif(old.serial_number, ''), '—')
      || ' → серийный номер ' || coalesce(nullif(new.serial_number, ''), '—'),
    jsonb_build_object(
      'device_id', new.device_id,
      'previous_device_id', old.device_id,
      'serial_number', new.serial_number,
      'previous_serial_number', old.serial_number
    )
  );

  return new;
end;
$$;

notify pgrst, 'reload schema';
