-- Даты в уведомлениях о сроке — как в UI: дд.мм.гг

create or replace function public.process_order_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  approaching_days integer := 2;
  sent integer := 0;
  rec record;
begin
  if auth.uid() is not null and not public.has_permission('settings:update') then
    raise exception 'Недостаточно прав.';
  end if;

  select coalesce((value ->> 'approaching_days')::integer, 2)
    into approaching_days
  from public.app_settings
  where key = 'deadline';

  for rec in
    select o.id, o.number, o.deadline, o.responsible_id, meta.is_terminal
    from public.orders o
    left join public.order_status_meta meta on meta.status_id = o.status_id
    where o.deadline is not null
      and o.responsible_id is not null
      and coalesce(meta.is_terminal, false) = false
  loop
    if rec.deadline < current_date then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'overdue'
      ) then
        perform public.emit_domain_event(
          'deadline_overdue',
          'order',
          rec.id::text,
          jsonb_build_object(
            'order_id', rec.id,
            'order_number', rec.number,
            'responsible_id', rec.responsible_id,
            'title', 'Срок заказа просрочен',
            'body', 'Срок заказа ' || rec.number || ' истёк.'
          )
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'overdue');
        sent := sent + 1;
      end if;
    elsif rec.deadline <= current_date + approaching_days then
      if not exists (
        select 1 from public.order_deadline_flags f
        where f.order_id = rec.id and f.kind = 'approaching'
      ) then
        perform public.emit_domain_event(
          'deadline_approaching',
          'order',
          rec.id::text,
          jsonb_build_object(
            'order_id', rec.id,
            'order_number', rec.number,
            'responsible_id', rec.responsible_id,
            'title', 'Приближается срок заказа',
            'body', 'Срок заказа ' || rec.number || ' — ' || to_char(rec.deadline, 'DD.MM.YY') || '.'
          )
        );
        insert into public.order_deadline_flags (order_id, kind) values (rec.id, 'approaching');
        sent := sent + 1;
      end if;
    end if;
  end loop;

  return sent;
end;
$$;
