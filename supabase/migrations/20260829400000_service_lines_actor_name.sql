-- Expose who added each service line (for work composition grouping).

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
      'description', coalesce(t.description, ''),
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
