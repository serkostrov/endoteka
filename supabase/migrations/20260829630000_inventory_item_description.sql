-- Описание позиции номенклатуры.

alter table public.inventory_items
  add column if not exists description text not null default '';

create or replace function public.create_inventory_item(
  item_name text,
  item_code text default '',
  item_article text default '',
  item_barcode text default '',
  item_category_id uuid default null,
  item_unit_id uuid default null,
  item_purchase_price numeric default 0,
  item_repair_price numeric default 0,
  item_retail_price numeric default 0,
  item_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для создания номенклатуры.';
  end if;

  if btrim(coalesce(item_name, '')) = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null then
    raise exception 'Выберите категорию.';
  end if;

  if item_unit_id is null then
    raise exception 'Выберите единицу измерения.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or coalesce(item_repair_price, 0) < 0 or coalesce(item_retail_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    next_code := 'N-' || lpad(nextval('public.inventory_item_code_seq')::text, 6, '0');
  end if;

  insert into public.inventory_items (
    code, article, barcode, name, description, category_id, unit_id, purchase_price, repair_price, retail_price
  )
  values (
    next_code,
    btrim(coalesce(item_article, '')),
    btrim(coalesce(item_barcode, '')),
    btrim(item_name),
    btrim(coalesce(item_description, '')),
    item_category_id,
    item_unit_id,
    coalesce(item_purchase_price, 0),
    coalesce(item_repair_price, 0),
    coalesce(item_retail_price, 0)
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object('name', btrim(item_name), 'code', next_code)
  );

  return result_id;
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
    return null;
end;
$$;

create or replace function public.update_inventory_item(
  target_item_id uuid,
  item_name text,
  item_code text default '',
  item_article text default '',
  item_barcode text default '',
  item_category_id uuid default null,
  item_unit_id uuid default null,
  item_purchase_price numeric default 0,
  item_repair_price numeric default 0,
  item_retail_price numeric default 0,
  item_description text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_code text;
  clean_name text := btrim(coalesce(item_name, ''));
  clean_repair numeric := coalesce(item_repair_price, 0);
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения номенклатуры.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if item_category_id is null or item_unit_id is null then
    raise exception 'Категория и единица измерения обязательны.';
  end if;

  perform public.assert_inventory_category(item_category_id);
  perform public.assert_inventory_unit(item_unit_id);

  if coalesce(item_purchase_price, 0) < 0 or clean_repair < 0 or coalesce(item_retail_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    select code into next_code from public.inventory_items where id = target_item_id;
  end if;

  update public.inventory_items
  set
    code = next_code,
    article = btrim(coalesce(item_article, '')),
    barcode = btrim(coalesce(item_barcode, '')),
    name = clean_name,
    description = btrim(coalesce(item_description, '')),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = clean_repair,
    retail_price = coalesce(item_retail_price, 0)
  where id = target_item_id;

  update public.order_part_lines
  set
    name = clean_name,
    unit_price = clean_repair
  where item_id = target_item_id;

  perform public.record_audit(
    'inventory.item_updated',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', clean_name, 'code', next_code)
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
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
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
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
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
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
