-- Скрытие прихода (без изменения остатка) и полная отмена (сторнирование партий).

alter table public.inventory_receipts
  add column if not exists hidden_at timestamptz,
  add column if not exists reversed_at timestamptz;

create index if not exists inventory_receipts_visible_idx
  on public.inventory_receipts (created_at desc)
  where hidden_at is null;

create or replace function public.delete_inventory_receipt(
  target_receipt_id uuid,
  delete_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_receipts%rowtype;
  movement_row record;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления прихода.';
  end if;

  select *
    into current_row
  from public.inventory_receipts
  where id = target_receipt_id
  for update;

  if not found then
    raise exception 'Приход не найден.';
  end if;

  if current_row.reversed_at is not null then
    raise exception 'Приход уже отменён.';
  end if;

  if delete_mode = 'hide' then
    if current_row.hidden_at is not null then
      raise exception 'Приход уже скрыт.';
    end if;

    update public.inventory_receipts
    set hidden_at = now()
    where id = target_receipt_id;

    perform public.record_audit(
      'inventory.receipt_hidden',
      'inventory_receipt',
      target_receipt_id::text,
      jsonb_build_object('supplier', current_row.supplier)
    );

    return;
  end if;

  if delete_mode <> 'reverse' then
    raise exception 'Неверный режим удаления прихода.';
  end if;

  for movement_row in
    select
      m.id,
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price,
      b.remaining_quantity
    from public.inventory_movements m
    join public.inventory_batches b on b.id = m.batch_id
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    if movement_row.remaining_quantity < movement_row.quantity then
      raise exception 'Нельзя отменить приход: часть позиций уже списана.';
    end if;
  end loop;

  for movement_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    perform pg_advisory_xact_lock(871001, hashtext(movement_row.item_id::text));

    insert into public.inventory_movements (
      item_id,
      batch_id,
      quantity,
      unit_price,
      movement_type,
      reference_type,
      reference_id,
      created_by
    )
    values (
      movement_row.item_id,
      movement_row.batch_id,
      -movement_row.quantity,
      movement_row.unit_price,
      'inventory_adjustment',
      'receipt',
      target_receipt_id,
      auth.uid()
    );
  end loop;

  update public.inventory_receipts
  set hidden_at = coalesce(hidden_at, now()),
      reversed_at = now()
  where id = target_receipt_id;

  perform public.record_audit(
    'inventory.receipt_reversed',
    'inventory_receipt',
    target_receipt_id::text,
    jsonb_build_object('supplier', current_row.supplier)
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
  left join public.inventory_movements m
    on m.reference_type = 'receipt'
   and m.reference_id = r.id
   and m.movement_type = 'receipt'
  where r.hidden_at is null
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
  where r.id = target_receipt_id
    and r.hidden_at is null;

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
        where m.reference_type = 'receipt'
          and m.reference_id = target_receipt_id
          and m.movement_type = 'receipt'
      ) x
    ), '[]'::jsonb)
  );
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
  customer_name text;
  receipts jsonb := '[]'::jsonb;
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
  ),
    c.name
  into payload, customer_name
  from public.customers c
  where c.id = target_customer_id;

  if payload is null then
    return null;
  end if;

  if public.has_permission('inventory:read') or public.has_permission('inventory:receive') then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'id', r.id,
        'supplier', r.supplier,
        'receipt_date', r.receipt_date,
        'notes', r.notes,
        'created_at', r.created_at,
        'actor_name', coalesce(p.full_name, ''),
        'line_count', r.line_count,
        'total_quantity', r.total_quantity
      ) order by r.created_at desc),
      '[]'::jsonb
    )
    into receipts
    from (
      select
        rec.id,
        rec.supplier,
        rec.receipt_date,
        rec.notes,
        rec.created_at,
        rec.created_by,
        count(m.id) as line_count,
        coalesce(sum(m.quantity), 0) as total_quantity
      from public.inventory_receipts rec
      left join public.inventory_movements m
        on m.reference_type = 'receipt'
       and m.reference_id = rec.id
       and m.movement_type = 'receipt'
      where rec.hidden_at is null
        and (
          rec.supplier_id = target_customer_id
          or (
            rec.supplier_id is null
            and lower(btrim(rec.supplier)) = lower(btrim(customer_name))
          )
        )
      group by rec.id
      order by rec.created_at desc
      limit 50
    ) r
    left join public.profiles p on p.id = r.created_by;
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
    'receipts', coalesce(receipts, '[]'::jsonb),
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

revoke all on function public.delete_inventory_receipt(uuid, text) from public, anon;
grant execute on function public.delete_inventory_receipt(uuid, text) to authenticated;
