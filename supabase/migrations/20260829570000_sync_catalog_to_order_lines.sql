-- Правка шаблона услуги / карточки товара синхронизирует строки в заказах
-- (название, описание, цена), которые ссылаются на справочник.

create or replace function public.update_service_template(
  target_id uuid,
  template_name text,
  template_description text default '',
  template_unit_price numeric default 0,
  template_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := btrim(coalesce(template_name, ''));
  clean_description text := btrim(coalesce(template_description, ''));
  clean_price numeric := coalesce(template_unit_price, 0);
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения услуги.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if clean_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  if exists (
    select 1
    from public.service_templates
    where lower(btrim(name)) = lower(clean_name)
      and id <> target_id
  ) then
    raise exception 'Такое наименование уже в справочнике';
  end if;

  update public.service_templates
  set
    name = clean_name,
    description = clean_description,
    unit_price = clean_price,
    is_active = coalesce(template_is_active, true)
  where id = target_id;

  if not found then
    raise exception 'Услуга не найдена.';
  end if;

  update public.order_service_lines
  set
    name = clean_name,
    description = clean_description,
    unit_price = clean_price
  where template_id = target_id;

  perform public.write_audit_event(
    auth.uid(),
    'services.template_updated',
    'service_template',
    target_id::text,
    jsonb_build_object('name', clean_name)
  );
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
  item_retail_price numeric default 0
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
