-- Батч-сохранение позиций сборки + одна запись в историю.

create or replace function public.save_order_assembly_parts(
  target_order_id uuid,
  parts jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  incoming jsonb := coalesce(parts, '[]'::jsonb);
  existing_ids uuid[];
  keep_ids uuid[] := array[]::uuid[];
  changes jsonb := '[]'::jsonb;
  item jsonb;
  item_id uuid;
  item_name text;
  item_req numeric;
  item_col numeric;
  item_comment text;
  item_sort integer;
  current_row public.order_assembly_parts%rowtype;
  new_id uuid;
  idx integer := 0;
  completeness numeric;
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения сборки.';
  end if;

  if jsonb_typeof(incoming) <> 'array' then
    raise exception 'Список позиций сборки должен быть массивом.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  select coalesce(array_agg(p.id), array[]::uuid[])
  into existing_ids
  from public.order_assembly_parts p
  where p.order_id = target_order_id;

  for item in
    select value
    from jsonb_array_elements(incoming) with ordinality as t(value, ord)
    order by ord
  loop
    item_name := btrim(coalesce(item->>'name', ''));
    item_req := coalesce((item->>'qty_required')::numeric, 1);
    item_col := coalesce((item->>'qty_collected')::numeric, 0);
    item_comment := btrim(coalesce(item->>'comment', ''));
    item_sort := coalesce((item->>'sort_order')::integer, idx);
    idx := idx + 1;

    if item_name = '' then
      raise exception 'Укажите наименование запасной части.';
    end if;
    if item_req < 0 or item_col < 0 then
      raise exception 'Количество не может быть отрицательным.';
    end if;

    item_id := null;
    begin
      if coalesce(item->>'id', '') <> '' then
        item_id := (item->>'id')::uuid;
      end if;
    exception
      when invalid_text_representation then
        item_id := null;
    end;

    if item_id is not null and item_id = any (existing_ids) then
      select * into current_row
      from public.order_assembly_parts
      where id = item_id
      for update;

      if current_row.order_id is distinct from target_order_id then
        raise exception 'Позиция принадлежит другому заказу.';
      end if;

      if current_row.name is distinct from item_name
         or current_row.qty_required is distinct from item_req
         or current_row.qty_collected is distinct from item_col
         or current_row.comment is distinct from item_comment
         or current_row.sort_order is distinct from item_sort then
        update public.order_assembly_parts
        set name = item_name,
            qty_required = item_req,
            qty_collected = item_col,
            comment = item_comment,
            sort_order = item_sort,
            updated_at = now()
        where id = item_id;

        changes := changes || jsonb_build_array(
          jsonb_build_object(
            'action', 'updated',
            'part_id', item_id,
            'name', item_name,
            'from', jsonb_build_object(
              'name', current_row.name,
              'qty_required', current_row.qty_required,
              'qty_collected', current_row.qty_collected,
              'comment', current_row.comment
            ),
            'to', jsonb_build_object(
              'name', item_name,
              'qty_required', item_req,
              'qty_collected', item_col,
              'comment', item_comment
            )
          )
        );
      else
        -- Без изменений содержимого, но могли поменять только sort — уже сравнили.
        null;
      end if;

      keep_ids := array_append(keep_ids, item_id);
    else
      insert into public.order_assembly_parts (
        order_id, name, qty_required, qty_collected, comment, sort_order, created_by
      )
      values (
        target_order_id,
        item_name,
        item_req,
        item_col,
        item_comment,
        item_sort,
        auth.uid()
      )
      returning id into new_id;

      keep_ids := array_append(keep_ids, new_id);
      changes := changes || jsonb_build_array(
        jsonb_build_object(
          'action', 'added',
          'part_id', new_id,
          'name', item_name,
          'qty_required', item_req,
          'qty_collected', item_col,
          'comment', item_comment
        )
      );
    end if;
  end loop;

  for current_row in
    select *
    from public.order_assembly_parts p
    where p.order_id = target_order_id
      and (
        cardinality(keep_ids) = 0
        or p.id <> all (keep_ids)
      )
  loop
    delete from public.order_assembly_parts where id = current_row.id;
    changes := changes || jsonb_build_array(
      jsonb_build_object(
        'action', 'removed',
        'part_id', current_row.id,
        'name', current_row.name,
        'qty_required', current_row.qty_required,
        'qty_collected', current_row.qty_collected,
        'comment', current_row.comment
      )
    );
  end loop;

  if jsonb_array_length(changes) > 0 then
    insert into public.order_assembly_journal_events (order_id, event_type, actor_id, summary, payload)
    values (
      target_order_id,
      'assembly_updated',
      auth.uid(),
      'Изменения в сборке',
      jsonb_build_object('changes', changes)
    );
  end if;

  select case
    when coalesce(sum(p.qty_required), 0) <= 0 then 0
    else least(
      100,
      round(
        (
          100.0 * sum(least(greatest(p.qty_collected, 0), greatest(p.qty_required, 0)))
          / nullif(sum(greatest(p.qty_required, 0)), 0)
        )::numeric,
        2
      )
    )
  end
  into completeness
  from public.order_assembly_parts p
  where p.order_id = target_order_id;

  return jsonb_build_object(
    'completeness_pct', coalesce(completeness, 0),
    'changed', jsonb_array_length(changes) > 0,
    'changes_count', jsonb_array_length(changes)
  );
end;
$$;

revoke all on function public.save_order_assembly_parts(uuid, jsonb) from public, anon;
grant execute on function public.save_order_assembly_parts(uuid, jsonb) to authenticated;
