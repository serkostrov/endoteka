-- Ширина и высота дополнительных полей на карточке. Настраиваются в предпросмотре.

alter table public.dynamic_fields
  add column if not exists layout_width text not null default 'half',
  add column if not exists layout_height text not null default 'default';

alter table public.dynamic_fields
  drop constraint if exists dynamic_fields_layout_width_check,
  drop constraint if exists dynamic_fields_layout_height_check;

alter table public.dynamic_fields
  add constraint dynamic_fields_layout_width_check
    check (layout_width in ('quarter', 'third', 'half', 'two_thirds', 'three_quarters', 'full')),
  add constraint dynamic_fields_layout_height_check
    check (layout_height in ('compact', 'default', 'tall', 'extra'));

update public.dynamic_fields
set layout_width = 'full', layout_height = 'tall'
where field_type = 'textarea';

update public.dynamic_fields
set layout_width = 'half', layout_height = 'compact'
where field_type = 'checkbox';

drop function if exists public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text);

create or replace function public.upsert_dynamic_field(
  target_id uuid,
  entity_code text,
  field_code text,
  field_name text,
  field_type text,
  is_required boolean default false,
  options jsonb default '[]'::jsonb,
  group_name text default '',
  layout_width text default 'half',
  layout_height text default 'default'
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
  p_width text := coalesce(nullif(btrim(layout_width), ''), 'half');
  p_height text := coalesce(nullif(btrim(layout_height), ''), 'default');
  normalized_code text;
  normalized_name text;
  normalized_group text;
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

  if p_width not in ('quarter', 'third', 'half', 'two_thirds', 'three_quarters', 'full') then
    raise exception 'Недопустимая ширина поля.';
  end if;

  if p_height not in ('compact', 'default', 'tall', 'extra') then
    raise exception 'Недопустимая высота поля.';
  end if;

  normalized_code := lower(btrim(coalesce(field_code, '')));
  normalized_name := btrim(coalesce(field_name, ''));
  normalized_group := left(btrim(coalesce(group_name, '')), 80);

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
      is_required = p_required,
      group_name = normalized_group,
      layout_width = p_width,
      layout_height = p_height
    where id = current_row.id
    returning id into result_id;
  else
    select coalesce(max(sort_order), -1) + 1 into next_sort
    from public.dynamic_fields
    where dynamic_fields.entity_code = p_entity;

    insert into public.dynamic_fields (
      entity_code, code, name, field_type, is_required, sort_order, group_name, layout_width, layout_height
    )
    values (
      p_entity,
      normalized_code,
      normalized_name,
      p_type,
      p_required,
      next_sort,
      normalized_group,
      p_width,
      p_height
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
    jsonb_build_object(
      'entity_code', p_entity,
      'code', normalized_code,
      'field_type', p_type,
      'layout_width', p_width,
      'layout_height', p_height
    )
  );

  return result_id;
exception
  when unique_violation then
    raise exception 'Поле с таким кодом уже есть в этом разделе.';
end;
$$;

create or replace function public.set_dynamic_field_layout(
  target_id uuid,
  next_width text,
  next_height text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.dynamic_fields%rowtype;
  p_width text := coalesce(nullif(btrim(next_width), ''), 'half');
  p_height text := coalesce(nullif(btrim(next_height), ''), 'default');
begin
  perform public.assert_settings_write();

  if p_width not in ('quarter', 'third', 'half', 'two_thirds', 'three_quarters', 'full') then
    raise exception 'Недопустимая ширина поля.';
  end if;

  if p_height not in ('compact', 'default', 'tall', 'extra') then
    raise exception 'Недопустимая высота поля.';
  end if;

  select * into current_row from public.dynamic_fields where id = target_id;
  if current_row.id is null then
    raise exception 'Поле не найдено.';
  end if;

  update public.dynamic_fields
  set layout_width = p_width, layout_height = p_height
  where id = current_row.id;

  perform public.record_audit(
    'fields.layout',
    'dynamic_field',
    current_row.id::text,
    jsonb_build_object(
      'entity_code', current_row.entity_code,
      'code', current_row.code,
      'layout_width', p_width,
      'layout_height', p_height
    )
  );
end;
$$;

revoke all on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text, text, text) from public;
revoke all on function public.set_dynamic_field_layout(uuid, text, text) from public;

grant execute on function public.upsert_dynamic_field(uuid, text, text, text, text, boolean, jsonb, text, text, text) to authenticated;
grant execute on function public.set_dynamic_field_layout(uuid, text, text) to authenticated;
grant execute on function public.set_dynamic_field_layout(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
