-- Приход связан с контактом-поставщиком, чтобы в карточке организации были поставки.

alter table public.inventory_receipts
  add column if not exists supplier_id uuid references public.customers (id) on delete set null;

create index if not exists inventory_receipts_supplier_id_idx
  on public.inventory_receipts (supplier_id, created_at desc)
  where supplier_id is not null;

update public.inventory_receipts as receipt
set supplier_id = match.id
from (
  select distinct on (lower(btrim(c.name)))
    c.id,
    lower(btrim(c.name)) as name_key
  from public.customers c
  order by lower(btrim(c.name)), c.created_at
) as match
where receipt.supplier_id is null
  and lower(btrim(receipt.supplier)) = match.name_key;

drop function if exists public.receive_inventory(text, date, text, jsonb);

create or replace function public.receive_inventory(
  supplier_name text,
  doc_receipt_date date,
  doc_notes text,
  lines jsonb,
  supplier_customer_id uuid default null
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
  resolved_name text;
  resolved_supplier_id uuid;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  resolved_supplier_id := supplier_customer_id;
  resolved_name := btrim(coalesce(supplier_name, ''));

  if resolved_supplier_id is not null then
    select c.name into resolved_name
    from public.customers c
    where c.id = resolved_supplier_id;

    if resolved_name is null then
      raise exception 'Поставщик не найден.';
    end if;
  elsif resolved_name = '' then
    raise exception 'Укажите поставщика.';
  else
    select c.id
    into resolved_supplier_id
    from public.customers c
    where lower(btrim(c.name)) = lower(resolved_name)
    order by c.created_at
    limit 1;
  end if;

  if doc_receipt_date is null then
    raise exception 'Укажите дату прихода.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(lines, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  insert into public.inventory_receipts (supplier, supplier_id, receipt_date, notes, created_by)
  values (resolved_name, resolved_supplier_id, doc_receipt_date, btrim(coalesce(doc_notes, '')), auth.uid())
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
      resolved_name,
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
    jsonb_build_object('supplier', resolved_name, 'lines', line_count)
  );

  return receipt_id;
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
        on m.reference_type = 'receipt' and m.reference_id = rec.id
      where rec.supplier_id = target_customer_id
         or (
           rec.supplier_id is null
           and lower(btrim(rec.supplier)) = lower(btrim(customer_name))
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

revoke all on function public.receive_inventory(text, date, text, jsonb, uuid) from public;
grant execute on function public.receive_inventory(text, date, text, jsonb, uuid) to authenticated;
