-- Удаление вида/бренда/модели: дочерние записи справочника сами по себе
-- не блокируют удаление. Блокируем только реальные связи (приборы, склад, статусы).
-- Пустое поддерево удаляется каскадом (листья → корень).

create or replace function public.reference_item_external_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.orders where status_id = target_item_id) +
    (
      select count(*)
      from public.devices
      where group_id = target_item_id
         or brand_id = target_item_id
         or model_id = target_item_id
         or modification_id = target_item_id
    ) +
    (
      select count(*)
      from public.inventory_items
      where category_id = target_item_id or unit_id = target_item_id
    ) +
    (
      select count(*)
      from public.order_status_transitions
      where from_status_id = target_item_id or to_status_id = target_item_id
    )
  )::integer;
$$;

create or replace function public.reference_item_usage_count(target_item_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  -- Для UI/проверки: только внешние связи. Дочерние reference_items
  -- удаляются вместе с родителем, если у поддерева нет внешних ссылок.
  select public.reference_item_external_usage_count(target_item_id);
$$;

create or replace function public.delete_reference_item(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.reference_items%rowtype;
  leaf_row public.reference_items%rowtype;
  subtree_usage integer;
begin
  perform public.assert_settings_write();

  select * into current_row from public.reference_items where id = target_id;
  if current_row.id is null then
    raise exception 'Запись справочника не найдена.';
  end if;

  with recursive tree as (
    select id, 0 as depth
    from public.reference_items
    where id = target_id
    union all
    select child.id, tree.depth + 1
    from public.reference_items child
    join tree on child.parent_id = tree.id
  )
  select coalesce(sum(public.reference_item_external_usage_count(tree.id)), 0)::integer
  into subtree_usage
  from tree;

  if subtree_usage > 0 then
    raise exception 'Запись используется и не может быть удалена. Скройте её, чтобы не показывать в списках.';
  end if;

  -- Доп. поля карточки видов приборов на всём поддереве
  delete from public.dynamic_field_values
  where entity_code = 'devices'
    and record_id in (
      with recursive tree as (
        select id
        from public.reference_items
        where id = target_id
        union all
        select child.id
        from public.reference_items child
        join tree on child.parent_id = tree.id
      )
      select id from tree
    );

  -- Листья сначала: parent_id ON DELETE RESTRICT
  for leaf_row in
    with recursive tree as (
      select id, 0 as depth
      from public.reference_items
      where id = target_id
      union all
      select child.id, tree.depth + 1
      from public.reference_items child
      join tree on child.parent_id = tree.id
    )
    select ri.*
    from tree
    join public.reference_items ri on ri.id = tree.id
    order by tree.depth desc
  loop
    delete from public.reference_items where id = leaf_row.id;
  end loop;

  perform public.record_audit(
    'references.item_deleted',
    'reference_item',
    target_id::text,
    jsonb_build_object('code', current_row.code, 'set_id', current_row.set_id, 'name', current_row.name)
  );
end;
$$;

revoke all on function public.reference_item_external_usage_count(uuid) from public, anon;
grant execute on function public.reference_item_external_usage_count(uuid) to authenticated;
revoke all on function public.reference_item_usage_count(uuid) from public, anon;
grant execute on function public.reference_item_usage_count(uuid) to authenticated;
revoke all on function public.delete_reference_item(uuid) from public, anon;
grant execute on function public.delete_reference_item(uuid) to authenticated;
