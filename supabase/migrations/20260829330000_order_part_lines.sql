-- Запчасти заказа: свои количество и цена, возврат на склад при удалении.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_type_check check (
    movement_type in ('receipt', 'repair_consumption', 'repair_return', 'sale', 'inventory_adjustment')
  );

create table if not exists public.order_part_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null default 0 check (unit_price >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_part_lines_unique unique (order_id, item_id)
);

create index if not exists order_part_lines_order_idx
  on public.order_part_lines (order_id, created_at);

drop trigger if exists order_part_lines_set_updated_at on public.order_part_lines;
create trigger order_part_lines_set_updated_at
  before update on public.order_part_lines
  for each row execute procedure public.set_updated_at();

alter table public.order_part_lines enable row level security;

drop policy if exists order_part_lines_select on public.order_part_lines;
create policy order_part_lines_select
  on public.order_part_lines
  for select
  to authenticated
  using (public.has_permission('orders:read') or public.can_read_inventory());

insert into public.order_part_lines (order_id, item_id, quantity, unit_price, created_by, created_at)
select
  m.reference_id,
  m.item_id,
  sum(-m.quantity),
  coalesce(round((sum(-m.quantity * m.unit_price) / nullif(sum(-m.quantity), 0))::numeric, 2), 0),
  (array_agg(m.created_by order by m.created_at))[1],
  min(m.created_at)
from public.inventory_movements m
where m.reference_type = 'order'
  and m.movement_type = 'repair_consumption'
  and exists (select 1 from public.orders o where o.id = m.reference_id)
  and not exists (
    select 1
    from public.order_part_lines l
    where l.order_id = m.reference_id and l.item_id = m.item_id
  )
group by m.reference_id, m.item_id
having sum(-m.quantity) > 0;

create or replace function public.return_inventory_from_order(
  target_order_id uuid,
  target_item_id uuid,
  return_quantity numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining numeric;
  rec record;
  take numeric;
begin
  if return_quantity is null or return_quantity <= 0 then
    raise exception 'Количество возврата должно быть больше нуля.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  remaining := return_quantity;

  for rec in
    select
      m.batch_id,
      -sum(m.quantity) as net_qty
    from public.inventory_movements m
    where m.reference_type = 'order'
      and m.reference_id = target_order_id
      and m.item_id = target_item_id
      and m.movement_type in ('repair_consumption', 'repair_return')
    group by m.batch_id
    having -sum(m.quantity) > 0
    order by max(m.created_at) desc, m.batch_id desc
  loop
    exit when remaining <= 0;
    take := least(rec.net_qty, remaining);

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    select
      target_item_id,
      rec.batch_id,
      take,
      b.purchase_price,
      'repair_return',
      'order',
      target_order_id,
      auth.uid()
    from public.inventory_batches b
    where b.id = rec.batch_id;

    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    raise exception 'Нельзя вернуть больше, чем списано в заказ.';
  end if;
end;
$$;

drop function if exists public.consume_inventory_for_order(uuid, uuid, numeric);

create or replace function public.consume_inventory_for_order(
  target_order_id uuid,
  target_item_id uuid,
  consume_quantity numeric,
  line_unit_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  next_price numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания в ремонт.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  next_price := line_unit_price;
  if next_price is null then
    select repair_price into next_price
    from public.inventory_items
    where id = target_item_id;
  end if;

  if next_price is null or next_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  result := public.consume_inventory_fifo(
    target_item_id,
    consume_quantity,
    'repair_consumption',
    'order',
    target_order_id
  );

  insert into public.order_part_lines (order_id, item_id, quantity, unit_price, created_by)
  values (target_order_id, target_item_id, consume_quantity, next_price, auth.uid())
  on conflict (order_id, item_id) do update
    set quantity = public.order_part_lines.quantity + excluded.quantity;

  perform public.record_audit(
    'inventory.consumed_repair',
    'order',
    target_order_id::text,
    jsonb_build_object('item_id', target_item_id, 'quantity', consume_quantity, 'unit_price', next_price)
  );

  return result;
end;
$$;

create or replace function public.set_order_part_line(
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
  current_row public.order_part_lines%rowtype;
  delta numeric;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  delta := line_quantity - current_row.quantity;

  if delta > 0 then
    perform public.consume_inventory_fifo(
      current_row.item_id,
      delta,
      'repair_consumption',
      'order',
      current_row.order_id
    );
  elsif delta < 0 then
    perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
  end if;

  update public.order_part_lines
  set quantity = line_quantity,
      unit_price = line_unit_price
  where id = target_line_id;

  perform public.record_audit(
    'inventory.order_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

create or replace function public.remove_order_part_line(target_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для удаления запчасти из заказа.';
  end if;

  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  perform public.return_inventory_from_order(
    current_row.order_id,
    current_row.item_id,
    current_row.quantity
  );

  delete from public.order_part_lines
  where id = target_line_id;

  perform public.record_audit(
    'inventory.returned_repair',
    'order',
    current_row.order_id::text,
    jsonb_build_object('item_id', current_row.item_id, 'quantity', current_row.quantity)
  );
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
        l.id,
        l.item_id,
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        i.barcode as item_barcode,
        coalesce(u.name, '') as unit_name,
        l.quantity,
        l.unit_price,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'receipt_date', b.receipt_date,
            'supplier', b.supplier,
            'quantity', b.net_qty
          ) order by b.last_at desc)
          from (
            select
              bt.receipt_date,
              bt.supplier,
              -sum(m.quantity) as net_qty,
              max(m.created_at) as last_at
            from public.inventory_movements m
            join public.inventory_batches bt on bt.id = m.batch_id
            where m.reference_type = 'order'
              and m.reference_id = l.order_id
              and m.item_id = l.item_id
              and m.movement_type in ('repair_consumption', 'repair_return')
            group by bt.id, bt.receipt_date, bt.supplier
            having -sum(m.quantity) > 0
          ) b
        ), '[]'::jsonb) as batches,
        coalesce(p.full_name, '') as actor_name,
        l.created_at
      from public.order_part_lines l
      join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      left join public.profiles p on p.id = l.created_by
      where l.order_id = target_order_id
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.write_order_journal_on_parts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.reference_type <> 'order'
     or new.movement_type not in ('repair_consumption', 'repair_return') then
    return new;
  end if;

  select name into item_name from public.inventory_items where id = new.item_id;

  if new.movement_type = 'repair_return' then
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_returned',
      auth.uid(),
      'Возвращено на склад: ' || coalesce(item_name, 'позиция') || ' × ' || trim(to_char(abs(new.quantity), '999999990.999')),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  else
    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      new.reference_id,
      'parts_consumed',
      auth.uid(),
      'Списано: ' || coalesce(item_name, 'позиция') || ' × ' || trim(to_char(abs(new.quantity), '999999990.999')),
      jsonb_build_object(
        'item_id', new.item_id,
        'quantity', abs(new.quantity),
        'movement_id', new.id
      )
    );
  end if;

  return new;
end;
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
        trim(to_char(l.quantity, '999999990.999')) as quantity,
        coalesce(u.name, '') as unit_name,
        trim(to_char(l.unit_price, '999999990.99')) as unit_price,
        l.created_at
      from public.order_part_lines l
      join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      where l.order_id = p_source_id
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

revoke all on function public.return_inventory_from_order(uuid, uuid, numeric) from public, anon;
revoke all on function public.consume_inventory_for_order(uuid, uuid, numeric, numeric) from public, anon;
revoke all on function public.set_order_part_line(uuid, numeric, numeric) from public, anon;
revoke all on function public.remove_order_part_line(uuid) from public, anon;

grant execute on function public.consume_inventory_for_order(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.set_order_part_line(uuid, numeric, numeric) to authenticated;
grant execute on function public.remove_order_part_line(uuid) to authenticated;

notify pgrst, 'reload schema';
