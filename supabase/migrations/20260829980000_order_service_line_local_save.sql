-- Сохранение правок услуги только в строке заказа (без изменения справочника).
-- Отвязывает строку от шаблона, чтобы последующие правки каталога её не перезаписывали.

create or replace function public.update_order_service_line_for_order(
  target_line_id uuid,
  line_name text,
  line_description text default '',
  line_unit_price numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.order_service_lines%rowtype;
  clean_name text := btrim(coalesce(line_name, ''));
  clean_description text := btrim(coalesce(line_description, ''));
  clean_price numeric := coalesce(line_unit_price, 0);
begin
  if not public.has_permission('orders:update') then
    raise exception 'Недостаточно прав для изменения состава заказа.';
  end if;

  select * into current_row
  from public.order_service_lines
  where id = target_line_id
  for update;

  if current_row.id is null then
    raise exception 'Строка услуги в заказе не найдена.';
  end if;

  if clean_name = '' then
    raise exception 'Укажите наименование.';
  end if;

  if clean_price < 0 then
    raise exception 'Цена не может быть отрицательной.';
  end if;

  update public.order_service_lines
  set
    template_id = null,
    name = clean_name,
    description = clean_description,
    unit_price = clean_price
  where id = target_line_id;

  perform public.record_audit(
    'orders.service_line_updated_local',
    'order',
    current_row.order_id::text,
    jsonb_build_object(
      'line_id', target_line_id,
      'previous_template_id', current_row.template_id,
      'name', clean_name,
      'unit_price', clean_price
    )
  );
end;
$$;

revoke all on function public.update_order_service_line_for_order(uuid, text, text, numeric) from public, anon;
grant execute on function public.update_order_service_line_for_order(uuid, text, text, numeric) to authenticated;
