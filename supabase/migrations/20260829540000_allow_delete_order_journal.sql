-- Удаление заказа каскадом трогает order_journal_events, а триггер
-- запрещал DELETE → «Записи журнала нельзя изменять».
-- Журнал по-прежнему нельзя править (UPDATE); удалять строки можно
-- только вместе с заказом (cascade / delete_order). Прямого DELETE у клиентов нет.

create or replace function public.forbid_order_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Записи журнала нельзя изменять.';
end;
$$;

drop trigger if exists order_journal_events_no_update on public.order_journal_events;
create trigger order_journal_events_no_update
  before update on public.order_journal_events
  for each row execute procedure public.forbid_order_journal_mutation();

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

  -- Явно до cascade: журнал и вложения уходят вместе с заказом.
  delete from public.order_journal_events
  where order_id = target_order_id;

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
