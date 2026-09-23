-- Недостача: остаток партии = сумма движений (отрицательный долг).
-- Приход сначала покрывает долг, затем увеличивает доступный остаток.
-- Карточка и список считают остаток одинаково — по remaining_quantity.

alter table public.inventory_batches
  drop constraint if exists inventory_batches_remaining_check;

alter table public.inventory_batches
  add constraint inventory_batches_remaining_check check (
    remaining_quantity <= quantity
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_type_check check (
    movement_type in (
      'receipt',
      'repair_consumption',
      'repair_return',
      'sale',
      'inventory_adjustment',
      'shortage_cover'
    )
  );

-- Старые партии «Недостача»: rem был 0 при движениях −N (фантом). Выравниваем rem = Σ движений.
update public.inventory_batches b
set remaining_quantity = coalesce((
  select sum(m.quantity)
  from public.inventory_movements m
  where m.batch_id = b.id
), 0)
where b.supplier = 'Недостача'
  and b.remaining_quantity is distinct from coalesce((
    select sum(m.quantity)
    from public.inventory_movements m
    where m.batch_id = b.id
  ), 0);

create or replace function public.settle_inventory_shortage(
  target_item_id uuid,
  source_batch_id uuid,
  target_receipt_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  short public.inventory_batches%rowtype;
  source_rem numeric;
  need numeric;
  take numeric;
  covered numeric := 0;
begin
  if target_item_id is null or source_batch_id is null or target_receipt_id is null then
    return 0;
  end if;

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  select remaining_quantity into source_rem
  from public.inventory_batches
  where id = source_batch_id
    and item_id = target_item_id;

  if source_rem is null or source_rem <= 0 then
    return 0;
  end if;

  for short in
    select *
    from public.inventory_batches
    where item_id = target_item_id
      and remaining_quantity < 0
    order by receipt_date asc, created_at asc, id asc
    for update
  loop
    select remaining_quantity into source_rem
    from public.inventory_batches
    where id = source_batch_id;

    exit when source_rem is null or source_rem <= 0;

    need := -short.remaining_quantity;
    take := least(need, source_rem);
    exit when take <= 0;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      short.id,
      take,
      0,
      'shortage_cover',
      'receipt',
      target_receipt_id,
      auth.uid()
    );

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      source_batch_id,
      -take,
      (
        select purchase_price
        from public.inventory_batches
        where id = source_batch_id
      ),
      'shortage_cover',
      'receipt',
      target_receipt_id,
      auth.uid()
    );

    covered := covered + take;
  end loop;

  return covered;
end;
$$;

revoke all on function public.settle_inventory_shortage(uuid, uuid, uuid) from public, anon;
grant execute on function public.settle_inventory_shortage(uuid, uuid, uuid) to authenticated;

-- Покрыть уже существующий долг текущими положительными партиями (FIFO).
do $$
declare
  item_rec record;
  batch_rec record;
begin
  for item_rec in
    select distinct item_id
    from public.inventory_batches
    where remaining_quantity < 0
  loop
    for batch_rec in
      select id
      from public.inventory_batches
      where item_id = item_rec.item_id
        and remaining_quantity > 0
        and receipt_id is not null
      order by receipt_date asc, created_at asc, id asc
    loop
      perform public.settle_inventory_shortage(
        item_rec.item_id,
        batch_rec.id,
        (
          select receipt_id
          from public.inventory_batches
          where id = batch_rec.id
        )
      );
    end loop;
  end loop;
end;
$$;

create or replace function public.consume_inventory_fifo(
  target_item_id uuid,
  consume_quantity numeric,
  target_movement_type text,
  target_reference_type text,
  target_reference_id uuid,
  allow_shortage boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  available numeric;
  remaining numeric;
  take numeric;
  batch_row public.inventory_batches%rowtype;
  shortage_batch_id uuid;
  movement_id uuid;
  lines jsonb := '[]'::jsonb;
begin
  if consume_quantity is null or consume_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  perform pg_advisory_xact_lock(871001, hashtext(target_item_id::text));

  perform 1
  from public.inventory_batches
  where item_id = target_item_id
  for update;

  select coalesce(sum(remaining_quantity), 0)
    into available
  from public.inventory_batches
  where item_id = target_item_id;

  if available < consume_quantity and not coalesce(allow_shortage, false) then
    raise exception 'Недостаточно остатка. Доступно: %, запрошено: %.', available, consume_quantity;
  end if;

  remaining := consume_quantity;

  for batch_row in
    select *
    from public.inventory_batches
    where item_id = target_item_id
      and remaining_quantity > 0
    order by receipt_date asc, created_at asc, id asc
    for update
  loop
    exit when remaining <= 0;

    take := least(batch_row.remaining_quantity, remaining);

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      batch_row.id,
      -take,
      batch_row.purchase_price,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', batch_row.id,
      'quantity', take,
      'unit_price', batch_row.purchase_price,
      'receipt_date', batch_row.receipt_date
    ));

    remaining := remaining - take;
  end loop;

  if remaining > 0 then
    if not coalesce(allow_shortage, false) then
      raise exception 'Недостаточно остатка.';
    end if;

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      target_item_id,
      null,
      'Недостача',
      current_date,
      0,
      remaining,
      0
    )
    returning id into shortage_batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      target_item_id,
      shortage_batch_id,
      -remaining,
      0,
      target_movement_type,
      target_reference_type,
      target_reference_id,
      auth.uid()
    )
    returning id into movement_id;

    lines := lines || jsonb_build_array(jsonb_build_object(
      'movement_id', movement_id,
      'batch_id', shortage_batch_id,
      'quantity', remaining,
      'unit_price', 0,
      'receipt_date', current_date,
      'shortage', true
    ));

    remaining := 0;
  end if;

  return jsonb_build_object(
    'item_id', target_item_id,
    'quantity', consume_quantity,
    'lines', lines
  );
end;
$$;

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

    perform public.settle_inventory_shortage(line.item_id, batch_id, receipt_id);
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

create or replace function public.find_inventory_items_by_barcode(barcode_query text)
returns table (
  id uuid,
  code text,
  article text,
  barcode text,
  name text,
  category_id uuid,
  category_name text,
  unit_id uuid,
  unit_name text,
  purchase_price numeric,
  repair_price numeric,
  retail_price numeric,
  stock_quantity numeric,
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
  code_value text;
begin
  if not (
    public.can_read_inventory()
    or public.has_permission('orders:update')
    or public.has_permission('sales:read')
    or public.has_permission('sales:create')
  ) then
    raise exception 'Недостаточно прав для поиска по штрихкоду.';
  end if;

  code_value := btrim(coalesce(barcode_query, ''));
  if code_value = '' then
    return;
  end if;

  return query
  with stock as (
    select b.item_id, coalesce(sum(b.remaining_quantity), 0) as qty
    from public.inventory_batches b
    group by b.item_id
  )
  select
    i.id,
    i.code,
    i.article,
    i.barcode,
    i.name,
    i.category_id,
    coalesce(cat.name, '') as category_name,
    i.unit_id,
    coalesce(u.name, '') as unit_name,
    i.purchase_price,
    i.repair_price,
    i.retail_price,
    coalesce(stock.qty, 0) as stock_quantity,
    i.created_at,
    i.updated_at,
    count(*) over() as total_count
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  left join stock on stock.item_id = i.id
  where i.barcode = code_value
     or i.code = code_value
  order by i.name
  limit 20;
end;
$$;

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
  cover_row record;
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

  -- Сначала откатываем покрытие недостачи этим приходом (возвращаем qty на партии прихода).
  for cover_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'shortage_cover'
    order by m.created_at desc, m.id desc
  loop
    perform pg_advisory_xact_lock(871001, hashtext(cover_row.item_id::text));

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      cover_row.item_id,
      cover_row.batch_id,
      -cover_row.quantity,
      cover_row.unit_price,
      'shortage_cover',
      'receipt',
      target_receipt_id,
      auth.uid()
    );
  end loop;

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

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'barcode_type', i.barcode_type,
    'name', i.name,
    'description', i.description,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(b.remaining_quantity) from public.inventory_batches b where b.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          rec.supplier_id,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        left join public.inventory_receipts rec on rec.id = bt.receipt_id
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        select
          m.id,
          m.quantity,
          m.unit_price,
          m.movement_type,
          m.reference_type,
          m.reference_id,
          m.created_at,
          m.batch_id,
          bt.receipt_date as batch_receipt_date,
          bt.supplier as batch_supplier,
          coalesce(p.full_name, '') as actor_name,
          case m.reference_type
            when 'order' then 'Заказ ' || coalesce(o.number, '')
            when 'receipt' then
              case
                when m.movement_type = 'shortage_cover' then 'Покрытие недостачи · ' || coalesce(r.supplier, '')
                else 'Приход · ' || coalesce(r.supplier, '')
              end
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;
