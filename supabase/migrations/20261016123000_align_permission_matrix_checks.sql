-- Матрица ролей и реальные проверки прав: отдельные чекбоксы «Изменение» / «Удаление»
-- больше не подменяются правом «Создание» (inventory:receive) или «users:update».

-- Убрать старую перегрузку без min_stock (там ещё был обход через inventory:receive).
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
  item_min_stock numeric default 0
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
  min_qty numeric := greatest(0, round(coalesce(item_min_stock, 0)));
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

  if coalesce(item_min_stock, 0) < 0
     or coalesce(item_min_stock, 0) <> round(coalesce(item_min_stock, 0)) then
    raise exception 'Минимальный остаток должен быть целым числом не меньше нуля.';
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
    retail_price = coalesce(item_retail_price, 0),
    is_permanent = permanent,
    min_stock = min_qty
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
      'min_stock', min_qty
    )
  );
exception
  when unique_violation then
    perform public.raise_inventory_name_duplicate(item_name);
end;
$$;

create or replace function public.delete_inventory_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_items%rowtype;
begin
  if not public.has_permission('inventory:delete') then
    raise exception 'Недостаточно прав для удаления номенклатуры.';
  end if;

  select * into current_row
  from public.inventory_items
  where id = target_item_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция не найдена.';
  end if;

  if exists (select 1 from public.inventory_batches where item_id = target_item_id)
    or exists (select 1 from public.inventory_movements where item_id = target_item_id)
    or exists (select 1 from public.sale_lines where item_id = target_item_id)
    or exists (select 1 from public.inventory_count_lines where item_id = target_item_id)
    or exists (select 1 from public.documents where source_type = 'item' and source_id = target_item_id)
  then
    raise exception 'Позицию нельзя удалить: по ней есть партии, движения или документы.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'inventory' and record_id = target_item_id;

  delete from public.inventory_item_photos
  where item_id = target_item_id;

  delete from public.inventory_items
  where id = target_item_id;

  perform public.record_audit(
    'inventory.item_deleted',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', current_row.name, 'code', current_row.code)
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.save_dynamic_field_values(target_entity_code text, target_record_id uuid, field_values jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  field_row public.dynamic_fields%rowtype;
  raw jsonb;
  permission_code text;
  journal_enabled boolean := false;
  old_fields jsonb := '{}'::jsonb;
  changes jsonb := '[]'::jsonb;
  old_value jsonb;
  new_value jsonb;
  old_norm text;
  new_norm text;
  summary_text text;
begin
  if not public.is_active_user() then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.field_entities where code = target_entity_code) then
    raise exception 'Раздел карточки не найден.';
  end if;

  permission_code := target_entity_code || ':update';
  if target_entity_code = 'diagnostics' then
    permission_code := 'diagnostics:update';
  elsif target_entity_code = 'inventory' then
    permission_code := 'inventory:update';
  elsif target_entity_code = 'order_work' then
    permission_code := 'orders:update';
  elsif target_entity_code = 'devices' then
    if not (
      public.has_permission('devices:update')
      or public.has_permission('settings:update')
    ) then
      raise exception 'Недостаточно прав для сохранения полей.';
    end if;
    permission_code := null;
  end if;

  if permission_code is not null and not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  journal_enabled :=
    target_entity_code in ('order_work', 'orders')
    and exists (select 1 from public.orders where id = target_record_id);

  if journal_enabled then
    select coalesce(jsonb_object_agg(f.code, v.value), '{}'::jsonb)
      into old_fields
    from public.dynamic_fields f
    left join public.dynamic_field_values v
      on v.field_id = f.id and v.record_id = target_record_id
    where f.entity_code = target_entity_code
      and f.is_active = true
      and not public.is_order_card_field(f.entity_code, f.code);
  end if;

  for field_row in
    select *
    from public.dynamic_fields
    where entity_code = target_entity_code
      and is_active = true
  loop
    if public.is_order_card_field(field_row.entity_code, field_row.code) then
      continue;
    end if;

    raw := field_values -> field_row.code;
    perform public.validate_dynamic_field_value(field_row.id, raw);

    if raw is null or raw = 'null'::jsonb or (jsonb_typeof(raw) = 'string' and btrim(raw #>> '{}') = '') then
      delete from public.dynamic_field_values
      where field_id = field_row.id
        and record_id = target_record_id;
      new_value := null;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
      new_value := raw;
    end if;

    if journal_enabled then
      old_value := old_fields -> field_row.code;
      old_norm := public.normalize_dynamic_field_journal_value(old_value);
      new_norm := public.normalize_dynamic_field_journal_value(new_value);

      if old_norm is distinct from new_norm then
        changes := changes || jsonb_build_array(jsonb_build_object(
          'field', field_row.code,
          'label', field_row.name,
          'from', to_jsonb(old_norm),
          'to', to_jsonb(new_norm)
        ));
      end if;
    end if;
  end loop;

  if journal_enabled and jsonb_array_length(changes) > 0 then
    summary_text := case
      when target_entity_code = 'order_work' then 'Изменены поля состава работы'
      else 'Изменения в заказе'
    end;

    insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      target_record_id,
      'order_updated',
      auth.uid(),
      summary_text,
      jsonb_build_object('changes', changes)
    );

    perform public.record_audit(
      'orders.updated',
      'order',
      target_record_id::text,
      jsonb_build_object(
        'entity_code', target_entity_code,
        'changes', changes
      )
    );
  end if;
end;
$function$;

create or replace function public.prepare_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_name text;
  current_email text;
  current_active boolean;
  current_role text;
begin
  if not public.has_permission('users:delete') then
    raise exception 'Недостаточно прав для удаления пользователя.';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Нельзя удалить собственную учётную запись.';
  end if;

  select p.full_name, p.email, p.is_active, r.code
    into current_name, current_email, current_active, current_role
  from public.profiles p
  left join public.user_roles ur on ur.user_id = p.id
  left join public.roles r on r.id = ur.role_id
  where p.id = target_user_id;

  if not found then
    raise exception 'Пользователь не найден.';
  end if;

  if current_role = 'director' and public.director_count(target_user_id) = 0 then
    raise exception 'Нельзя удалить последнего руководителя.';
  end if;

  perform public.record_audit(
    'users.deleted',
    'user',
    target_user_id::text,
    jsonb_build_object(
      'email', current_email,
      'full_name', current_name,
      'role_code', current_role,
      'is_active', current_active
    )
  );
end;
$$;
