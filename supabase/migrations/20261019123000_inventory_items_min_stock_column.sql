-- На проде не было колонки min_stock, а update_inventory_item уже её пишет → 42703.

alter table public.inventory_items
  add column if not exists min_stock numeric(14, 0) not null default 0;

do $chk$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'inventory_items_min_stock_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_min_stock_check check (min_stock >= 0);
  end if;
end;
$chk$;

comment on column public.inventory_items.min_stock is
  'Минимальный остаток: при остатке ≤ минимума (и min_stock > 0) позиция в фильтре «Ниже минимума».';

-- Пересоздать update без зависимости от «забытой» колонки и с гарантированным GRANT.
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
);
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
);
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean
);

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
  item_description text default '',
  item_is_permanent boolean default true,
  item_min_stock numeric default null,
  item_barcode_type text default null
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
  permanent boolean := coalesce(item_is_permanent, true);
  current_min numeric;
  current_type text;
  min_qty numeric;
  safe_type text;
begin
  if not public.has_permission('inventory:update') then
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

  select i.min_stock, i.barcode_type
    into current_min, current_type
  from public.inventory_items i
  where i.id = target_item_id;

  if item_min_stock is null then
    min_qty := greatest(0, round(coalesce(current_min, 0)));
  else
    if item_min_stock < 0 or item_min_stock <> round(item_min_stock) then
      raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
    end if;
    min_qty := greatest(0, round(item_min_stock));
  end if;

  if item_barcode_type is null or btrim(item_barcode_type) = '' then
    safe_type := lower(btrim(coalesce(current_type, 'code128')));
  else
    safe_type := lower(btrim(item_barcode_type));
  end if;
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
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
    barcode_type = safe_type,
    name = clean_name,
    description = btrim(coalesce(item_description, '')),
    category_id = item_category_id,
    unit_id = item_unit_id,
    purchase_price = coalesce(item_purchase_price, 0),
    repair_price = clean_repair,
    retail_price = coalesce(item_retail_price, 0),
    is_permanent = permanent,
    min_stock = min_qty,
    updated_at = now()
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
    jsonb_build_object(
      'name', clean_name,
      'code', next_code,
      'is_permanent', permanent,
      'min_stock', min_qty,
      'barcode_type', safe_type
    )
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

revoke all on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;

grant execute on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;

-- Чтобы PostgREST подхватил новую сигнатуру / права.
notify pgrst, 'reload schema';
