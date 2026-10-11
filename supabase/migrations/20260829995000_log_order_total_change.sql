-- Журнал: изменение суммы заказа (состав работ / запчасти).

create or replace function public.log_order_total_change(
  target_order_id uuid,
  old_total numeric,
  new_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_amount numeric := round(coalesce(old_total, 0)::numeric, 2);
  next_amount numeric := round(coalesce(new_total, 0)::numeric, 2);
begin
  if not (
    public.has_permission('orders:update')
    or public.has_permission('orders:create')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для записи в журнал.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  if prev_amount = next_amount then
    return;
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'total_changed',
    auth.uid(),
    'Сумма заказа',
    jsonb_build_object(
      'old_total', prev_amount,
      'new_total', next_amount,
      'changes', jsonb_build_array(
        jsonb_build_object(
          'field', 'total',
          'label', 'Сумма заказа',
          'from', prev_amount,
          'to', next_amount
        )
      )
    )
  );
end;
$$;

revoke all on function public.log_order_total_change(uuid, numeric, numeric) from public, anon;
grant execute on function public.log_order_total_change(uuid, numeric, numeric) to authenticated;
