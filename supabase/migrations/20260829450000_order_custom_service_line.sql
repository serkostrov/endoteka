-- Custom order service lines without catalog template.

alter table public.order_service_lines
  add column if not exists description text not null default '';

create or replace function public.get_order_service_lines(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('orders:read') then
    raise exception 'Недостаточно прав для состава заказа.';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'order_id', l.order_id,
      'template_id', l.template_id,
      'name', l.name,
      'description', coalesce(nullif(btrim(l.description), ''), t.description, ''),
      'quantity', l.quantity,
      'unit_price', l.unit_price,
      'actor_name', coalesce(p.full_name, p.email, ''),
      'created_at', l.created_at
    ) order by l.created_at)
    from public.order_service_lines l
    left join public.service_templates t on t.id = l.template_id
    left join public.profiles p on p.id = l.created_by
    where l.order_id = target_order_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.add_order_custom_service_line(
  target_order_id uuid,
  line_name text,
  line_description text default '',
  line_quantity numeric default 1,
  line_unit_price numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
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

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  insert into public.order_service_lines (
    order_id, template_id, name, description, quantity, unit_price, created_by
  )
  values (
    target_order_id,
    null,
    clean_name,
    clean_description,
    coalesce(line_quantity, 1),
    coalesce(line_unit_price, 0),
    auth.uid()
  )
  returning id into new_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    target_order_id,
    'service_added',
    auth.uid(),
    'Добавлена услуга: ' || clean_name || ' × ' || trim(to_char(coalesce(line_quantity, 1), '999999990.999')),
    jsonb_build_object(
      'line_id', new_id,
      'custom', true,
      'quantity', coalesce(line_quantity, 1),
      'unit_price', coalesce(line_unit_price, 0)
    )
  );

  perform public.write_audit_event(
    auth.uid(),
    'orders.service_line_added',
    'order',
    target_order_id::text,
    jsonb_build_object('line_id', new_id, 'name', clean_name, 'custom', true)
  );

  return new_id;
end;
$$;

revoke all on function public.add_order_custom_service_line(uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.add_order_custom_service_line(uuid, text, text, numeric, numeric) to authenticated;
