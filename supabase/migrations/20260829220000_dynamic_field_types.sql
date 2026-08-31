-- Типы полей карточек: многострочный текст, дата, сотрудник, флажок.
-- Системные поля заказа получают настоящие типы вместо «text».

insert into public.dynamic_field_types (code, name, sort_order)
values
  ('text', 'Строка', 0),
  ('textarea', 'Многострочный текст', 1),
  ('number', 'Число', 2),
  ('date', 'Дата', 3),
  ('select', 'Список', 4),
  ('employee', 'Сотрудник', 5),
  ('checkbox', 'Флажок', 6)
on conflict (code) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order;

update public.dynamic_fields
set field_type = 'textarea'
where entity_code = 'orders'
  and code in ('claimed_malfunction', 'completeness')
  and field_type = 'text';

update public.dynamic_fields
set field_type = 'date'
where entity_code = 'orders'
  and code = 'deadline'
  and field_type = 'text';

update public.dynamic_fields
set field_type = 'employee'
where entity_code = 'orders'
  and code = 'responsible'
  and field_type = 'text';

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
  text_value text;
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

  if field_row.field_type in ('text', 'textarea') then
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

  if field_row.field_type = 'date' then
    if value_type <> 'string' then
      raise exception 'Укажите дату.';
    end if;
    text_value := btrim(raw #>> '{}');
    if text_value = '' then
      if field_row.is_required then
        raise exception 'Укажите дату.';
      end if;
      return;
    end if;
    if text_value !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Дата должна быть в формате ГГГГ-ММ-ДД.';
    end if;
    return;
  end if;

  if field_row.field_type = 'employee' then
    if value_type <> 'string' then
      raise exception 'Выберите сотрудника.';
    end if;
    text_value := btrim(raw #>> '{}');
    if text_value = '' then
      if field_row.is_required then
        raise exception 'Выберите сотрудника.';
      end if;
      return;
    end if;
    if not exists (
      select 1 from public.profiles
      where id::text = text_value and is_active = true
    ) then
      raise exception 'Сотрудник не найден.';
    end if;
    return;
  end if;

  if field_row.field_type = 'checkbox' then
    if value_type <> 'boolean' then
      raise exception 'Ожидается флажок.';
    end if;
    if field_row.is_required and raw is distinct from 'true'::jsonb then
      raise exception 'Отметьте поле.';
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
