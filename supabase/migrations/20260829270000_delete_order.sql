-- Удаление заказа. Право: orders:delete. Журнал склада не трогаем.

create or replace function public.delete_order(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.orders%rowtype;
begin
  if not public.has_permission('orders:delete') then
    raise exception 'Недостаточно прав для удаления заказа.';
  end if;

  select * into current_row
  from public.orders
  where id = target_order_id
  for update;

  if current_row.id is null then
    raise exception 'Заказ не найден.';
  end if;

  delete from public.device_warranties
  where order_id = target_order_id;

  delete from public.documents
  where source_type = 'order' and source_id = target_order_id;

  delete from public.dynamic_field_values
  where record_id = target_order_id
    and entity_code in ('orders', 'diagnostics');

  delete from public.orders
  where id = target_order_id;

  perform public.record_audit(
    'orders.deleted',
    'order',
    target_order_id::text,
    jsonb_build_object('number', current_row.number)
  );
end;
$$;

revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;
