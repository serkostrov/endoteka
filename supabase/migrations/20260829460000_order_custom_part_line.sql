-- Custom order part lines without catalog inventory item (no stock move).

alter table public.order_part_lines
  alter column item_id drop not null;

alter table public.order_part_lines
  add column if not exists name text not null default '';

alter table public.order_part_lines
  drop constraint if exists order_part_lines_unique;

create unique index if not exists order_part_lines_order_item_unique
  on public.order_part_lines (order_id, item_id)
  where item_id is not null;

alter table public.order_part_lines
  drop constraint if exists order_part_lines_name_or_item;

alter table public.order_part_lines
  add constraint order_part_lines_name_or_item check (
    item_id is not null or btrim(name) <> ''
  );

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
        coalesce(nullif(btrim(l.name), ''), i.name, '') as item_name,
        coalesce(i.code, '') as item_code,
        coalesce(i.article, '') as item_article,
        coalesce(i.barcode, '') as item_barcode,
        coalesce(u.name, 'шт') as unit_name,
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
      left join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      left join public.profiles p on p.id = l.created_by
      where l.order_id = target_order_id
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.add_order_custom_part_line(
  target_order_id uuid,
  line_name text,
  line_quantity numeric default 1,
  line_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  clean_name text := btrim(coalesce(line_name, ''));
begin
  if not (
    public.has_permission('inventory:write_off')
    or public.has_permission('inventory:receive')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
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

  insert into public.order_part_lines (
    order_id, item_id, name, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    null,
    clean_name,
    coalesce(line_quantity, 1),
    coalesce(line_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'parts_consumed',
    auth.uid(),
    'Добавлена позиция: ' || clean_name || ' × ' || trim(to_char(coalesce(line_quantity, 1), '999999990.999')),
    jsonb_build_object(
      'line_id', new_id,
      'custom', true,
      'quantity', coalesce(line_quantity, 1),
      'unit_price', coalesce(line_unit_price, 0)
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'inventory.order_part_custom_added',
    'order',
    target_order_id::text,
    jsonb_build_object('line_id', new_id, 'name', clean_name, 'custom', true)
  );

  return new_id;
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
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is null then
    if not (
      public.has_permission('inventory:write_off')
      or public.has_permission('orders:update')
    ) then
      raise exception 'Недостаточно прав для изменения запчастей заказа.';
    end if;
  elsif not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  delta := line_quantity - current_row.quantity;

  if current_row.item_id is not null then
    if delta > 0 then
      perform public.consume_inventory_fifo(
        current_row.item_id,
        delta,
        'repair_consumption',
        'order',
        current_row.order_id,
        true
      );
    elsif delta < 0 then
      perform public.return_inventory_from_order(current_row.order_id, current_row.item_id, -delta);
    end if;
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
      'unit_price', line_unit_price,
      'custom', current_row.item_id is null
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
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is null then
    if not (
      public.has_permission('inventory:write_off')
      or public.has_permission('orders:update')
    ) then
      raise exception 'Недостаточно прав для удаления запчасти из заказа.';
    end if;
  elsif not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для удаления запчасти из заказа.';
  end if;

  if current_row.item_id is not null then
    perform public.return_inventory_from_order(
      current_row.order_id,
      current_row.item_id,
      current_row.quantity
    );
  end if;

  delete from public.order_part_lines
  where id = target_line_id;

  perform public.record_audit(
    'inventory.returned_repair',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'item_id', current_row.item_id,
      'quantity', current_row.quantity,
      'custom', current_row.item_id is null
    )
  );
end;
$$;

revoke all on function public.add_order_custom_part_line(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.add_order_custom_part_line(uuid, text, numeric, numeric) to authenticated;
