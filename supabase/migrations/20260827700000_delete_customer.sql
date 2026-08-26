-- Удаление клиента, если по нему нет заказов и продаж.

create or replace function public.delete_customer(target_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.customers%rowtype;
begin
  if not public.has_permission('customers:delete') then
    raise exception 'Недостаточно прав для удаления клиента.';
  end if;

  select * into current_row
  from public.customers
  where id = target_customer_id
  for update;

  if current_row.id is null then
    raise exception 'Клиент не найден.';
  end if;

  if exists (select 1 from public.orders where customer_id = target_customer_id) then
    raise exception 'Клиента нельзя удалить: по нему есть заказы.';
  end if;

  if exists (select 1 from public.sales where customer_id = target_customer_id) then
    raise exception 'Клиента нельзя удалить: по нему есть продажи.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'customers' and record_id = target_customer_id;

  delete from public.customers
  where id = target_customer_id;

  perform public.record_audit(
    'customers.deleted',
    'customer',
    target_customer_id::text,
    jsonb_build_object('name', current_row.name)
  );
end;
$$;

revoke all on function public.delete_customer(uuid) from public;
grant execute on function public.delete_customer(uuid) to authenticated;
