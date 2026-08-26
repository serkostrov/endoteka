-- Эндотека: настраиваемые справочники и динамические поля.
-- Определения полей нормализованы. Значения записей хранятся в jsonb и проверяются на сервере.

create table if not exists public.reference_sets (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  parent_set_id uuid references public.reference_sets (id) on delete restrict,
  is_system boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_sets_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint reference_sets_code_unique unique (code)
);

drop trigger if exists reference_sets_set_updated_at on public.reference_sets;
create trigger reference_sets_set_updated_at
  before update on public.reference_sets
  for each row execute procedure public.set_updated_at();

create table if not exists public.reference_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.reference_sets (id) on delete restrict,
  parent_id uuid references public.reference_items (id) on delete restrict,
  code text not null,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_items_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint reference_items_set_code_unique unique (set_id, code)
);

create index if not exists reference_items_set_sort_idx
  on public.reference_items (set_id, sort_order, name);

create index if not exists reference_items_parent_idx
  on public.reference_items (parent_id);

drop trigger if exists reference_items_set_updated_at on public.reference_items;
create trigger reference_items_set_updated_at
  before update on public.reference_items
  for each row execute procedure public.set_updated_at();

create table if not exists public.field_entities (
  code text primary key,
  name text not null,
  description text,
  sort_order integer not null default 0,
  constraint field_entities_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$')
);

create table if not exists public.dynamic_field_types (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  constraint dynamic_field_types_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$')
);

create table if not exists public.dynamic_fields (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null references public.field_entities (code) on delete restrict,
  code text not null,
  name text not null,
  field_type text not null references public.dynamic_field_types (code) on delete restrict,
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_fields_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint dynamic_fields_entity_code_unique unique (entity_code, code)
);

create index if not exists dynamic_fields_entity_sort_idx
  on public.dynamic_fields (entity_code, sort_order, name);

drop trigger if exists dynamic_fields_set_updated_at on public.dynamic_fields;
create trigger dynamic_fields_set_updated_at
  before update on public.dynamic_fields
  for each row execute procedure public.set_updated_at();

create table if not exists public.dynamic_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.dynamic_fields (id) on delete cascade,
  code text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_field_options_code_format check (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint dynamic_field_options_field_code_unique unique (field_id, code)
);

create index if not exists dynamic_field_options_field_sort_idx
  on public.dynamic_field_options (field_id, sort_order, label);

drop trigger if exists dynamic_field_options_set_updated_at on public.dynamic_field_options;
create trigger dynamic_field_options_set_updated_at
  before update on public.dynamic_field_options
  for each row execute procedure public.set_updated_at();

create table if not exists public.dynamic_field_values (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.dynamic_fields (id) on delete restrict,
  entity_code text not null references public.field_entities (code) on delete restrict,
  record_id uuid not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dynamic_field_values_field_record_unique unique (field_id, record_id)
);

create index if not exists dynamic_field_values_record_idx
  on public.dynamic_field_values (entity_code, record_id);

drop trigger if exists dynamic_field_values_set_updated_at on public.dynamic_field_values;
create trigger dynamic_field_values_set_updated_at
  before update on public.dynamic_field_values
  for each row execute procedure public.set_updated_at();

create or replace view public.reference_set_summaries
with (security_invoker = true) as
select
  s.id,
  s.code,
  s.name,
  s.description,
  s.parent_set_id,
  ps.code as parent_set_code,
  ps.name as parent_set_name,
  s.is_system,
  s.sort_order,
  s.created_at,
  s.updated_at,
  count(i.id)::integer as item_count,
  count(i.id) filter (where i.is_active)::integer as active_item_count
from public.reference_sets s
left join public.reference_sets ps on ps.id = s.parent_set_id
left join public.reference_items i on i.set_id = s.id
group by s.id, ps.code, ps.name;

create or replace view public.field_entity_summaries
with (security_invoker = true) as
select
  e.code,
  e.name,
  e.description,
  e.sort_order,
  count(f.id)::integer as field_count,
  count(f.id) filter (where f.is_active)::integer as active_field_count
from public.field_entities e
left join public.dynamic_fields f on f.entity_code = e.code
group by e.code;

create or replace function public.assert_settings_write()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав для изменения настроек.';
  end if;
end;
$$;

create or replace function public.assert_reference_item_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_parent_set uuid;
  actual_parent_set uuid;
begin
  select parent_set_id into expected_parent_set
  from public.reference_sets
  where id = new.set_id;

  if expected_parent_set is null then
    if new.parent_id is not null then
      raise exception 'У этого справочника нет родительского справочника.';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    raise exception 'Выберите значение родительского справочника.';
  end if;

  select set_id into actual_parent_set
  from public.reference_items
  where id = new.parent_id;

  if actual_parent_set is null or actual_parent_set <> expected_parent_set then
    raise exception 'Родитель должен быть из связанного справочника.';
  end if;

  return new;
end;
$$;

drop trigger if exists reference_items_parent_check on public.reference_items;
create trigger reference_items_parent_check
  before insert or update on public.reference_items
  for each row execute procedure public.assert_reference_item_parent();

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.reference_items
  where parent_id = target_item_id;
$$;

create or replace function public.dynamic_field_usage_count(target_field_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.dynamic_field_values
  where field_id = target_field_id;
$$;

create or replace function public.dynamic_option_usage_count(target_field_id uuid, option_code text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.dynamic_field_values
  where field_id = target_field_id
    and jsonb_typeof(value) = 'string'
    and value #>> '{}' = option_code;
$$;

create or replace function public.validate_dynamic_field_value(target_field_id uuid, raw jsonb)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  value_type text;
  option_code text;
begin
  select * into field_row from public.dynamic_fields where id = target_field_id;
  if field_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  if raw is null or raw = 'null'::jsonb then
    if field_row.is_required and field_row.is_active then
      raise exception 'Заполните обязательное поле.';
    end if;
    return;
  end if;

  value_type := jsonb_typeof(raw);

  if field_row.field_type = 'text' then
    if value_type <> 'string' then
      raise exception 'Ожидается текстовое значение.';
    end if;
    if field_row.is_required and btrim(raw #>> '{}') = '' then
      raise exception 'Заполните обязательное поле.';
    end if;
    return;
  end if;

  if field_row.field_type = 'number' then
    if value_type <> 'number' then
      raise exception 'Ожидается числовое значение.';
    end if;
    return;
  end if;

  if field_row.field_type = 'select' then
    if value_type <> 'string' then
      raise exception 'Выберите значение из списка.';
    end if;
    option_code := raw #>> '{}';
    if not exists (
      select 1
      from public.dynamic_field_options
      where field_id = field_row.id
        and code = option_code
        and is_active = true
    ) then
      raise exception 'Выбранный вариант недоступен.';
    end if;
    return;
  end if;

  raise exception 'Неподдерживаемый тип поля.';
end;
$$;

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
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.reference_sets where id = target_set_id) then
    raise exception 'Справочник не найден.';
  end if;

  normalized_code := lower(btrim(coalesce(item_code, '')));
  normalized_name := btrim(coalesce(item_name, ''));

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if target_id is not null then
    select * into current_row from public.reference_items where id = target_id and set_id = target_set_id;
    if current_row.id is null then
      raise exception 'Запись справочника не найдена.';
    end if;

    if current_row.is_system and current_row.code <> normalized_code then
      raise exception 'Код системной записи нельзя изменить.';
    end if;

    update public.reference_items
    set
      code = case when current_row.is_system then current_row.code else normalized_code end,
      name = normalized_name,
      description = btrim(coalesce(item_description, '')),
      parent_id = parent_item_id
    where id = current_row.id
    returning id into result_id;
  else
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
    raise exception 'Запись с таким кодом уже есть в справочнике.';
end;
$$;

create or replace function public.set_reference_item_active(target_id uuid, next_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  if current_row.is_active = next_active then
    return;
  end if;

  update public.reference_items
  set is_active = next_active
  where id = target_id;

  perform public.record_audit(
    case when next_active then 'references.item_activated' else 'references.item_deactivated' end,
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id)
  );
end;
$$;

create or replace function public.reorder_reference_items(target_set_id uuid, item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  perform public.assert_settings_write();

  if item_ids is null or array_length(item_ids, 1) is null then
    raise exception 'Передайте порядок записей.';
  end if;

  select count(*) into expected_count from public.reference_items where set_id = target_set_id;

  select count(*) into matched_count
  from public.reference_items
  where set_id = target_set_id
    and id = any (item_ids);

  if expected_count <> array_length(item_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все записи справочника.';
  end if;

  update public.reference_items i
  set sort_order = o.ord - 1
  from unnest(item_ids) with ordinality as o(id, ord)
  where i.id = o.id
    and i.set_id = target_set_id;

  perform public.record_audit(
    'references.items_reordered',
    'reference_set',
    target_set_id::text,
    jsonb_build_object('count', expected_count)
  );
end;
$$;

create or replace function public.replace_dynamic_field_options(target_field_id uuid, options jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  option_row jsonb;
  option_code text;
  option_label text;
  option_sort integer;
  option_active boolean;
  seen_codes text[] := '{}';
  idx integer := 0;
begin
  if jsonb_typeof(coalesce(options, '[]'::jsonb)) <> 'array' then
    raise exception 'Варианты списка заданы некорректно.';
  end if;

  for option_row in select value from jsonb_array_elements(options)
  loop
    option_code := lower(btrim(coalesce(option_row ->> 'code', '')));
    option_label := btrim(coalesce(option_row ->> 'label', ''));
    option_sort := coalesce((option_row ->> 'sort_order')::integer, idx);
    option_active := coalesce((option_row ->> 'is_active')::boolean, true);

    if option_code !~ '^[a-z][a-z0-9_]{0,63}$' then
      raise exception 'Код варианта: латиница, цифры и подчёркивание, начинается с буквы.';
    end if;

    if char_length(option_label) < 1 then
      raise exception 'Укажите название варианта.';
    end if;

    if option_code = any (seen_codes) then
      raise exception 'Коды вариантов не должны повторяться.';
    end if;

    seen_codes := array_append(seen_codes, option_code);

    insert into public.dynamic_field_options (field_id, code, label, sort_order, is_active)
    values (target_field_id, option_code, option_label, option_sort, option_active)
    on conflict (field_id, code) do update
      set label = excluded.label,
          sort_order = excluded.sort_order,
          is_active = excluded.is_active;

    idx := idx + 1;
  end loop;

  update public.dynamic_field_options
  set is_active = false
  where field_id = target_field_id
    and not (code = any (seen_codes));
end;
$$;

create or replace function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  p_entity text := entity_code;
  p_type text := field_type;
  p_required boolean := coalesce(is_required, false);
  p_options jsonb := coalesce(options, '[]'::jsonb);
  normalized_code text;
  normalized_name text;
  current_row public.dynamic_fields%rowtype;
  result_id uuid;
  next_sort integer;
  usage_count integer;
begin
  perform public.assert_settings_write();

  if not exists (select 1 from public.field_entities where code = p_entity) then
    raise exception 'Раздел карточки не найден.';
  end if;

  if not exists (select 1 from public.dynamic_field_types where code = p_type) then
    raise exception 'Неизвестный тип поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));

  if normalized_code !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  if char_length(normalized_name) < 1 or char_length(normalized_name) > 120 then
    raise exception 'Укажите название длиной до 120 символов.';
  end if;

  if p_type = 'select' and (jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 1) then
    raise exception 'Для списка добавьте хотя бы один вариант.';
  end if;

  if target_id is not null then
    select * into current_row from public.dynamic_fields where id = target_id and dynamic_fields.entity_code = p_entity;
    if current_row.id is null then
      raise exception 'Поле не найдено.';
    end if;

    usage_count := public.dynamic_field_usage_count(current_row.id);
    if usage_count > 0 and current_row.field_type <> p_type then
      raise exception 'Нельзя сменить тип поля, которое уже используется в данных.';
    end if;

    if current_row.code <> normalized_code and usage_count > 0 then
      raise exception 'Нельзя сменить код поля, которое уже используется в данных.';
    end if;

    update public.dynamic_fields
    set
      code = case when usage_count > 0 then current_row.code else normalized_code end,
      name = normalized_name,
      field_type = p_type,
      is_required = p_required
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order)
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort
    )
    returning id into result_id;
  end if;

  if p_type = 'select' then
    perform public.replace_dynamic_field_options(result_id, p_options);
    if not exists (
      select 1 from public.dynamic_field_options
      where field_id = result_id and is_active = true
    ) then
      raise exception 'Для списка добавьте хотя бы один активный вариант.';
    end if;
  else
    update public.dynamic_field_options
    set is_active = false
    where field_id = result_id;
  end if;

  perform public.record_audit(
    case when target_id is null then 'fields.created' else 'fields.updated' end,
    'dynamic_field',
    result_id::text,
    jsonb_build_object('entity_code', p_entity, 'code', normalized_code, 'field_type', p_type)
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

create or replace function public.set_dynamic_field_active(target_id uuid, next_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
begin
  perform public.assert_settings_write();

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  if current_row.is_active = next_active then
    return;
  end if;

  update public.dynamic_fields
  set is_active = next_active
  where id = target_id;

  perform public.record_audit(
    case when next_active then 'fields.activated' else 'fields.deactivated' end,
    'dynamic_field',
    target_id::text,
    jsonb_build_object('entity_code', current_row.entity_code, 'code', current_row.code)
  );
end;
$$;

create or replace function public.reorder_dynamic_fields(target_entity_code text, field_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  matched_count integer;
begin
  perform public.assert_settings_write();

  if field_ids is null or array_length(field_ids, 1) is null then
    raise exception 'Передайте порядок полей.';
  end if;

  select count(*) into expected_count
  from public.dynamic_fields
  where entity_code = target_entity_code;

  select count(*) into matched_count
  from public.dynamic_fields
  where entity_code = target_entity_code
    and id = any (field_ids);

  if expected_count <> array_length(field_ids, 1) or matched_count <> expected_count then
    raise exception 'Порядок должен включать все поля раздела.';
  end if;

  update public.dynamic_fields f
  set sort_order = o.ord - 1
  from unnest(field_ids) with ordinality as o(id, ord)
  where f.id = o.id
    and f.entity_code = target_entity_code;

  perform public.record_audit(
    'fields.reordered',
    'field_entity',
    target_entity_code,
    jsonb_build_object('count', expected_count)
  );
end;
$$;

create or replace function public.save_dynamic_field_values(
  target_entity_code text,
  target_record_id uuid,
  field_values jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  field_row public.dynamic_fields%rowtype;
  raw jsonb;
  permission_code text;
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
  end if;

  if not public.has_permission(permission_code) then
    raise exception 'Недостаточно прав для сохранения полей.';
  end if;

  if jsonb_typeof(coalesce(field_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Значения полей заданы некорректно.';
  end if;

  for field_row in
    select *
    from public.dynamic_fields
    where entity_code = target_entity_code
      and is_active = true
  loop
    raw := field_values -> field_row.code;
    perform public.validate_dynamic_field_value(field_row.id, raw);

    if raw is null or raw = 'null'::jsonb or (jsonb_typeof(raw) = 'string' and btrim(raw #>> '{}') = '') then
      delete from public.dynamic_field_values
      where field_id = field_row.id
        and record_id = target_record_id;
    else
      insert into public.dynamic_field_values (field_id, entity_code, record_id, value)
      values (field_row.id, target_entity_code, target_record_id, raw)
      on conflict (field_id, record_id) do update
        set value = excluded.value;
    end if;
  end loop;
end;
$$;

insert into public.dynamic_field_types (code, name, sort_order)
values
  ('text', 'Текст', 0),
  ('number', 'Число', 1),
  ('select', 'Список', 2)
on conflict (code) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;

insert into public.field_entities (code, name, description, sort_order)
values
  ('orders', 'Заказы', 'Дополнительные поля ремонтного заказа', 0),
  ('customers', 'Клиенты', 'Дополнительные поля организации', 1),
  ('devices', 'Приборы', 'Дополнительные поля эндоскопа', 2),
  ('diagnostics', 'Диагностика', 'Поля протокола диагностики', 3),
  ('inventory', 'Склад', 'Дополнительные поля номенклатуры', 4),
  ('tasks', 'Задачи', 'Дополнительные поля задачи', 5)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into public.reference_sets (code, name, description, sort_order)
values
  ('order_statuses', 'Статусы заказов', 'Этапы ремонта и выдачи', 0),
  ('device_groups', 'Группы приборов', 'Типы эндоскопов и принадлежностей', 1),
  ('device_brands', 'Бренды приборов', 'Производители', 2),
  ('inventory_categories', 'Категории склада', 'Группы номенклатуры', 5),
  ('units_of_measure', 'Единицы измерения', 'Единицы учёта склада', 6),
  ('task_priorities', 'Приоритеты задач', 'Срочность работ', 7),
  ('notification_event_types', 'Типы уведомлений', 'События, по которым создаются уведомления', 8)
on conflict (code) do nothing;

insert into public.reference_sets (code, name, description, parent_set_id, sort_order)
select 'device_models', 'Модели приборов', 'Модели в рамках бренда', s.id, 3
from public.reference_sets s
where s.code = 'device_brands'
on conflict (code) do nothing;

insert into public.reference_sets (code, name, description, parent_set_id, sort_order)
select 'device_modifications', 'Модификации приборов', 'Модификации в рамках модели', s.id, 4
from public.reference_sets s
where s.code = 'device_models'
on conflict (code) do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('received', 'Принят', 0),
    ('diagnostics', 'Диагностика', 1),
    ('waiting_approval', 'Согласование', 2),
    ('waiting_parts', 'Ожидание запчастей', 3),
    ('repair', 'Ремонт', 4),
    ('quality_check', 'Контроль', 5),
    ('ready', 'Готов к выдаче', 6),
    ('issued', 'Выдан', 7),
    ('cancelled', 'Отменён', 8)
) as i(code, name, sort_order) on true
where s.code = 'order_statuses'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('flexible_endoscope', 'Гибкий эндоскоп', 0),
    ('rigid_endoscope', 'Жёсткий эндоскоп', 1),
    ('ultrasound_endoscope', 'УЗИ-эндоскоп', 2),
    ('accessory', 'Принадлежность', 3)
) as i(code, name, sort_order) on true
where s.code = 'device_groups'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('olympus', 'Olympus', 0),
    ('pentax', 'Pentax', 1),
    ('fujifilm', 'Fujifilm', 2),
    ('karl_storz', 'Karl Storz', 3),
    ('other', 'Другой', 4)
) as i(code, name, sort_order) on true
where s.code = 'device_brands'
on conflict do nothing;

insert into public.reference_items (set_id, parent_id, code, name, sort_order, is_system)
select model_set.id, brands.id, models.code, models.name, models.sort_order, true
from (
  values
    ('gif_q150', 'GIF-Q150', 0),
    ('cf_q150l', 'CF-Q150L', 1)
) as models(code, name, sort_order)
join public.reference_sets model_set on model_set.code = 'device_models'
join public.reference_items brands on brands.code = 'olympus'
join public.reference_sets brand_set on brand_set.id = brands.set_id and brand_set.code = 'device_brands'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('spare_parts', 'Запчасти', 0),
    ('consumables', 'Расходники', 1),
    ('tools', 'Инструмент', 2)
) as i(code, name, sort_order) on true
where s.code = 'inventory_categories'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('pcs', 'шт', 0),
    ('set', 'компл', 1),
    ('pack', 'упак', 2),
    ('m', 'м', 3)
) as i(code, name, sort_order) on true
where s.code = 'units_of_measure'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('low', 'Низкий', 0),
    ('normal', 'Обычный', 1),
    ('high', 'Высокий', 2),
    ('urgent', 'Срочный', 3)
) as i(code, name, sort_order) on true
where s.code = 'task_priorities'
on conflict do nothing;

insert into public.reference_items (set_id, code, name, sort_order, is_system)
select s.id, i.code, i.name, i.sort_order, true
from public.reference_sets s
join (
  values
    ('order_assigned', 'Назначение заказа', 0),
    ('order_status_changed', 'Смена статуса заказа', 1),
    ('task_due', 'Срок задачи', 2),
    ('inventory_low', 'Низкий остаток', 3)
) as i(code, name, sort_order) on true
where s.code = 'notification_event_types'
on conflict do nothing;

insert into public.dynamic_fields (entity_code, code, name, field_type, is_required, sort_order)
values
  ('customers', 'inn', 'ИНН', 'text', false, 0),
  ('customers', 'contract_number', 'Номер договора', 'text', false, 1),
  ('diagnostics', 'working_hours', 'Наработка, часы', 'number', false, 0),
  ('diagnostics', 'leak_test', 'Тест на герметичность', 'select', true, 1),
  ('diagnostics', 'notes', 'Комментарий диагноста', 'text', false, 2),
  ('devices', 'firmware_version', 'Версия ПО', 'text', false, 0)
on conflict do nothing;

insert into public.dynamic_field_options (field_id, code, label, sort_order)
select f.id, o.code, o.label, o.sort_order
from public.dynamic_fields f
join (
  values
    ('passed', 'Пройден', 0),
    ('failed', 'Не пройден', 1),
    ('not_performed', 'Не выполнялся', 2)
) as o(code, label, sort_order) on true
where f.entity_code = 'diagnostics' and f.code = 'leak_test'
on conflict do nothing;

alter table public.reference_sets enable row level security;
alter table public.reference_items enable row level security;
alter table public.field_entities enable row level security;
alter table public.dynamic_field_types enable row level security;
alter table public.dynamic_fields enable row level security;
alter table public.dynamic_field_options enable row level security;
alter table public.dynamic_field_values enable row level security;

drop policy if exists reference_sets_select_active on public.reference_sets;
create policy reference_sets_select_active
  on public.reference_sets
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists reference_items_select_active on public.reference_items;
create policy reference_items_select_active
  on public.reference_items
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists field_entities_select_active on public.field_entities;
create policy field_entities_select_active
  on public.field_entities
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_field_types_select_active on public.dynamic_field_types;
create policy dynamic_field_types_select_active
  on public.dynamic_field_types
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_fields_select_active on public.dynamic_fields;
create policy dynamic_fields_select_active
  on public.dynamic_fields
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_field_options_select_active on public.dynamic_field_options;
create policy dynamic_field_options_select_active
  on public.dynamic_field_options
  for select
  to authenticated
  using (public.is_active_user());

drop policy if exists dynamic_field_values_select_entity_read on public.dynamic_field_values;
create policy dynamic_field_values_select_entity_read
  on public.dynamic_field_values
  for select
  to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('settings:read')
      or public.has_permission(entity_code || ':read')
    )
  );

grant select on public.reference_set_summaries to authenticated;
grant select on public.field_entity_summaries to authenticated;

revoke all on function public.assert_settings_write() from public;
revoke all on function public.reference_item_usage_count(uuid) from public;
revoke all on function public.dynamic_field_usage_count(uuid) from public;
revoke all on function public.dynamic_option_usage_count(uuid, text) from public;
revoke all on function public.validate_dynamic_field_value(uuid, jsonb) from public;
revoke all on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) from public;
revoke all on function public.set_reference_item_active(uuid, boolean) from public;
revoke all on function public.reorder_reference_items(uuid, uuid[]) from public;
revoke all on function public.replace_dynamic_field_options(uuid, jsonb) from public;
revoke all on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb) from public;
revoke all on function public.set_dynamic_field_active(uuid, boolean) from public;
revoke all on function public.reorder_dynamic_fields(text, uuid[]) from public;
revoke all on function public.save_dynamic_field_values(text, uuid, jsonb) from public;

grant execute on function public.reference_item_usage_count(uuid) to authenticated;
grant execute on function public.dynamic_field_usage_count(uuid) to authenticated;
grant execute on function public.dynamic_option_usage_count(uuid, text) to authenticated;
grant execute on function public.validate_dynamic_field_value(uuid, jsonb) to authenticated;
grant execute on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.set_reference_item_active(uuid, boolean) to authenticated;
grant execute on function public.reorder_reference_items(uuid, uuid[]) to authenticated;
grant execute on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.set_dynamic_field_active(uuid, boolean) to authenticated;
grant execute on function public.reorder_dynamic_fields(text, uuid[]) to authenticated;
grant execute on function public.save_dynamic_field_values(text, uuid, jsonb) to authenticated;
