-- Редактирование строк состава, созданных только для заказа (без справочника).

create or replace function public.update_order_custom_part_line(
  target_line_id uuid,
  line_name text,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_part_lines%rowtype;
  clean_name text := btrim(coalesce(line_name, ''));
begin
  select * into current_row
  from public.order_part_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция в заказе не найдена.';
  end if;

  if current_row.item_id is not null then
    raise exception 'Эта позиция из справочника. Измените карточку товара.';
  end if;

  if not (
    public.has_permission('inventory:write_off')
    or public.has_permission('orders:update')
  ) then
    raise exception 'Недостаточно прав для изменения запчастей заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if line_quantity is null or line_quantity <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if line_unit_price is null or line_unit_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_part_lines
  set
    name = clean_name,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id;

  perform public.record_audit(
    'inventory.order_custom_part_updated',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

create or replace function public.update_order_custom_service_line(
  target_line_id uuid,
  line_name text,
  line_description text,
  line_quantity numeric,
  line_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if coalesce(line_quantity, 0) <= 0 then
    raise exception 'Количество должно быть больше нуля.';
  end if;

  if coalesce(line_unit_price, 0) < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_service_lines
  set
    name = clean_name,
    description = clean_description,
    quantity = line_quantity,
    unit_price = line_unit_price
  where id = target_line_id
    and template_id is null
  returning order_id into target_order;

  if target_order is null then
    raise exception 'Строка услуги не найдена или это шаблон из справочника.';
  end if;

  perform public.write_audit_event(
    auth.uid(),
    'orders.custom_service_updated',
    'order',
    target_order::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'name', clean_name,
      'quantity', line_quantity,
      'unit_price', line_unit_price
    )
  );
end;
$$;

revoke all on function public.update_order_custom_part_line(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.update_order_custom_part_line(uuid, text, numeric, numeric) to authenticated;

revoke all on function public.update_order_custom_service_line(uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.update_order_custom_service_line(uuid, text, text, numeric, numeric) to authenticated;
