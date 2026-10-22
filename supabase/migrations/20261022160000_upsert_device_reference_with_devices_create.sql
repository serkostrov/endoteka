-- Создание типа/производителя/модели/модификации прибора при приёмке:
-- достаточно devices:create (как у кладовщика), не только settings:update.

create or replace function public.upsert_reference_item(
  target_id uuid,
  target_set_id uuid,
  item_code text,
  item_name text,
  item_description text default '',
  parent_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_code text;
  normalized_name text;
  current_row public.reference_items%rowtype;
  result_id uuid;
  next_sort integer;
  requires_parent boolean;
  parent_set uuid;
  set_code text;
  can_write_settings boolean;
  can_create_device_ref boolean;
begin
  select rs.code, rs.parent_set_id
  into set_code, parent_set
  from public.reference_sets rs
  where rs.id = target_set_id;

  if set_code is null then
    raise exception 'Справочник не найден.';
  end if;

  can_write_settings := public.has_permission('settings:update');
  can_create_device_ref :=
    target_id is null
    and public.has_permission('devices:create')
    and set_code in (
      'device_groups',
      'device_brands',
      'device_models',
      'device_modifications'
    );

  if not can_write_settings and not can_create_device_ref then
    raise exception 'Недостаточно прав для изменения справочника.';
  end if;

  requires_parent := parent_set is not null;
  if requires_parent and parent_item_id is null then
    raise exception 'Укажите родителя записи.';
  end if;

  if parent_item_id is not null then
    if not exists (
      select 1
      from public.reference_items p
      where p.id = parent_item_id
        and p.set_id = parent_set
    ) then
      raise exception 'Родительская запись не найдена.';
    end if;
  end if;

  normalized_name := btrim(coalesce(item_name, ''));
  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if exists (
    select 1
    from public.reference_items i
    where i.set_id = target_set_id
      and i.parent_id is not distinct from parent_item_id
      and lower(btrim(i.name)) = lower(normalized_name)
      and (target_id is null or i.id <> target_id)
  ) then
    raise exception 'Запись с таким названием уже есть на этом уровне.';
  end if;

  if target_id is not null then
    select * into current_row from public.reference_items where id = target_id and set_id = target_set_id;
    if current_row.id is null then
      raise exception 'Запись справочника не найдена.';
    end if;

    if current_row.is_system then
      normalized_code := current_row.code;
    else
      normalized_code := public.allocate_reference_item_code(
        target_set_id,
        parent_item_id,
        item_code,
        target_id
      );
    end if;

    update public.reference_items
    set
      code = normalized_code,
      name = normalized_name,
      description = btrim(coalesce(item_description, '')),
      parent_id = parent_item_id
    where id = current_row.id
    returning id into result_id;
  else
    normalized_code := public.allocate_reference_item_code(
      target_set_id,
      parent_item_id,
      item_code,
      null
    );

    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.reference_items
    where set_id = target_set_id;

    insert into public.reference_items (set_id, parent_id, code, name, description, sort_order)
    values (
      target_set_id,
      parent_item_id,
      normalized_code,
      normalized_name,
      btrim(coalesce(item_description, '')),
      next_sort
    )
    returning id into result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'references.item_created' else 'references.item_updated' end,
    'reference_item',
    result_id::text,
    jsonb_build_object('set_id', target_set_id, 'code', normalized_code)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Запись с таким названием уже есть на этом уровне.';
end;
$$;
