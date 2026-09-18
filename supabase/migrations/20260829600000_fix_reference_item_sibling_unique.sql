-- Код и название уникальны только среди соседей (один set + один parent).
-- Старый unique (set_id, code) и старый текст ошибки «таким кодом» ломали
-- одинаковые названия у разных родителей (тип «тест» + производитель «тест»).

alter table public.reference_items
  drop constraint if exists reference_items_set_code_unique;

drop index if exists public.reference_items_set_code_unique;
drop index if exists public.reference_items_set_code_uidx;

-- На всякий случай убрать любые другие unique только по (set_id, code).
do $$
declare
  idx record;
begin
  for idx in
    select i.relname as index_name
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'reference_items'
      and x.indisunique
      and not x.indisprimary
      and pg_get_indexdef(x.indexrelid) ~* '\(set_id,\s*code\)'
      and pg_get_indexdef(x.indexrelid) !~* 'parent_id'
  loop
    execute format('drop index if exists public.%I', idx.index_name);
  end loop;
end $$;

create unique index if not exists reference_items_set_parent_code_uidx
  on public.reference_items (set_id, parent_id, code)
  where parent_id is not null;

create unique index if not exists reference_items_set_root_code_uidx
  on public.reference_items (set_id, code)
  where parent_id is null;

do $$
begin
  if not exists (
    select 1
    from public.reference_items
    where parent_id is not null
    group by set_id, parent_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_parent_name_uidx
      on public.reference_items (set_id, parent_id, lower(btrim(name)))
      where parent_id is not null;
  end if;

  if not exists (
    select 1
    from public.reference_items
    where parent_id is null
    group by set_id, lower(btrim(name))
    having count(*) > 1
  ) then
    create unique index if not exists reference_items_set_root_name_uidx
      on public.reference_items (set_id, lower(btrim(name)))
      where parent_id is null;
  end if;
end $$;

create or replace function public.allocate_reference_item_code(
  p_set_id uuid,
  p_parent_id uuid,
  p_desired_code text,
  p_exclude_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer;
begin
  base := lower(btrim(coalesce(p_desired_code, '')));
  if base !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Код: латиница, цифры и подчёркивание, начинается с буквы.';
  end if;

  candidate := base;
  suffix := 2;
  while exists (
    select 1
    from public.reference_items i
    where i.set_id = p_set_id
      and i.parent_id is not distinct from p_parent_id
      and i.code = candidate
      and (p_exclude_id is null or i.id <> p_exclude_id)
  ) loop
    candidate := left(base, greatest(1, 64 - length('_' || suffix::text))) || '_' || suffix::text;
    suffix := suffix + 1;
    if suffix > 1000 then
      candidate := 'item_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      exit;
    end if;
  end loop;

  return candidate;
end;
$$;

drop function if exists public.upsert_reference_item(uuid, uuid, text, text, text, uuid);

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
begin
  perform public.assert_settings_write();

  select parent_set_id into parent_set
  from public.reference_sets
  where id = target_set_id;

  if not found then
    raise exception 'Справочник не найден.';
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

revoke all on function public.allocate_reference_item_code(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.upsert_reference_item(uuid, uuid, text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
