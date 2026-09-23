-- order_list_items с security_invoker не может читать order_service_lines
-- (у authenticated revoke all). Итог считаем через security definer.

drop function if exists public.order_total_amount(uuid);

create function public.order_total_amount(target_order_id uuid)
returns numeric(14, 2)
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(
      (select sum(l.quantity * l.unit_price) from public.order_part_lines l where l.order_id = target_order_id),
      0
    )
    + coalesce(
      (select sum(l.quantity * l.unit_price) from public.order_service_lines l where l.order_id = target_order_id),
      0
    )
  )::numeric(14, 2);
$$;

revoke all on function public.order_total_amount(uuid) from public, anon;
grant execute on function public.order_total_amount(uuid) to authenticated;

create or replace view public.order_list_items
with (security_invoker = true) as
select
  o.id,
  o.number,
  o.number_seq,
  o.customer_id,
  c.name as customer_name,
  o.device_id,
  o.serial_number,
  d.group_id as device_group_id,
  d.brand_id as device_brand_id,
  d.model_id as device_model_id,
  coalesce(brand.name, '') as device_brand,
  coalesce(model.name, '') as device_model,
  public.device_display_name(grp.name, brand.name, model.name) as device_label,
  o.status_id,
  st.code as status_code,
  st.name as status_name,
  coalesce(meta.is_terminal, false) as is_terminal,
  o.responsible_id,
  coalesce(nullif(p.full_name, ''), p.email, '') as responsible_name,
  o.deadline,
  case
    when coalesce(meta.is_terminal, false) then 'closed'
    when o.deadline is null then 'none'
    when o.deadline < current_date then 'overdue'
    when o.deadline <= current_date + coalesce(
      ((select value ->> 'approaching_days' from public.app_settings where key = 'deadline')::integer),
      2
    ) then 'approaching'
    else 'normal'
  end as deadline_state,
  o.claimed_malfunction,
  o.created_at,
  o.updated_at,
  public.order_total_amount(o.id)::numeric(14, 2) as total_amount
from public.orders o
join public.customers c on c.id = o.customer_id
join public.devices d on d.id = o.device_id
join public.reference_items st on st.id = o.status_id
left join public.order_status_meta meta on meta.status_id = o.status_id
left join public.profiles p on p.id = o.responsible_id
left join public.reference_items grp on grp.id = d.group_id
left join public.reference_items brand on brand.id = d.brand_id
left join public.reference_items model on model.id = d.model_id;

grant select on public.order_list_items to authenticated;
