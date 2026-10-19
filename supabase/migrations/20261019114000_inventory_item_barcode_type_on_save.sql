-- Штрихкод и тип этикетки сохраняются вместе с карточкой (кнопка «Сохранить»),
-- а не отдельным автосейвом. Права на этикетку = inventory:update.
-- Сначала вернуть GRANT на текущую перегрузку (после align_permission_matrix
-- execute мог пропасть, если функция пересоздавалась без grant).

do $grant$
begin
  execute $sql$
    grant execute on function public.update_inventory_item(
      uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
    ) to authenticated
  $sql$;
exception
  when undefined_function then
    null;
end;
$grant$;

drop function if exists public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
);
drop function if exists public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric
);

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
  item_description text default '',
  item_is_permanent boolean default true,
  item_min_stock numeric default 0,
  item_barcode_type text default 'code128'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_code text;
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
  safe_type text;
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
  end if;

  safe_type := lower(btrim(coalesce(item_barcode_type, 'code128')));
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
  end if;

  next_code := btrim(coalesce(item_code, ''));
  if next_code = '' then
    next_code := 'N-' || lpad(nextval('public.inventory_item_code_seq')::text, 6, '0');
  end if;

  insert into public.inventory_items (
    code, article, barcode, barcode_type, name, description, category_id, unit_id,
    purchase_price, repair_price, retail_price, is_permanent, min_stock
  )
  values (
    next_code,
    btrim(coalesce(item_article, '')),
    btrim(coalesce(item_barcode, '')),
    safe_type,
    btrim(item_name),
    btrim(coalesce(item_description, '')),
    item_category_id,
    item_unit_id,
    coalesce(item_purchase_price, 0),
    coalesce(item_repair_price, 0),
    coalesce(item_retail_price, 0),
    coalesce(item_is_permanent, true),
    min_qty
  )
  returning id into result_id;

  perform public.record_audit(
    'inventory.item_created',
    'inventory_item',
    result_id::text,
    jsonb_build_object(
      'name', btrim(item_name),
      'code', next_code,
      'is_permanent', coalesce(item_is_permanent, true),
      'min_stock', min_qty,
      'barcode_type', safe_type
    )
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

  select min_stock, barcode_type
    into current_min, current_type
  from public.inventory_items
  where id = target_item_id;

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

create or replace function public.set_inventory_item_label(
  target_item_id uuid,
  item_barcode text default '',
  item_barcode_type text default 'code128'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_type text;
begin
  if not public.has_permission('inventory:update') then
    raise exception 'Недостаточно прав для изменения этикетки.';
  end if;

  safe_type := lower(btrim(coalesce(item_barcode_type, 'code128')));
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
  end if;

  update public.inventory_items
  set
    barcode = btrim(coalesce(item_barcode, '')),
    barcode_type = safe_type,
    updated_at = now()
  where id = target_item_id;

  if not found then
    raise exception 'Позиция не найдена.';
  end if;
end;
$$;

revoke all on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;
revoke all on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) from public, anon;
revoke all on function public.set_inventory_item_label(uuid, text, text) from public, anon;

grant execute on function public.create_inventory_item(
  text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;
grant execute on function public.update_inventory_item(
  uuid, text, text, text, text, uuid, uuid, numeric, numeric, numeric, text, boolean, numeric, text
) to authenticated;
grant execute on function public.set_inventory_item_label(uuid, text, text) to authenticated;
