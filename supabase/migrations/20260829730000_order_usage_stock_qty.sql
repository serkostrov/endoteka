-- Остаток склада в составе работ — для ограничения количества в UI.

create or replace function public.get_order_inventory_usage(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.has_permission('orders:read')
    or public.can_read_inventory()
  ) then
    raise exception 'Недостаточно прав.';
  end if;

  if not exists (select 1 from public.orders where id = target_order_id) then
    raise exception 'Заказ не найден.';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        l.id,
        l.item_id,
        coalesce(nullif(btrim(l.name), ''), i.name, '') as item_name,
        coalesce(i.code, '') as item_code,
        coalesce(i.article, '') as item_article,
        coalesce(i.barcode, '') as item_barcode,
        coalesce(u.name, 'шт') as unit_name,
        l.quantity,
        l.unit_price,
        case
          when l.item_id is null then null
          else coalesce((
            select sum(b.remaining_quantity)
            from public.inventory_batches b
            where b.item_id = l.item_id
          ), 0)
        end as stock_quantity,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'receipt_date', b.receipt_date,
            'supplier', b.supplier,
            'quantity', b.net_qty
          ) order by b.last_at desc)
          from (
            select
              bt.receipt_date,
              bt.supplier,
              -sum(m.quantity) as net_qty,
              max(m.created_at) as last_at
            from public.inventory_movements m
            join public.inventory_batches bt on bt.id = m.batch_id
            where m.reference_type = 'order'
              and m.reference_id = l.order_id
              and m.item_id = l.item_id
              and m.movement_type in ('repair_consumption', 'repair_return')
            group by bt.id, bt.receipt_date, bt.supplier
            having -sum(m.quantity) > 0
          ) b
        ), '[]'::jsonb) as batches,
        coalesce(p.full_name, '') as actor_name,
        l.created_at
      from public.order_part_lines l
      left join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      left join public.profiles p on p.id = l.created_by
      where l.order_id = target_order_id
    ) x
  ), '[]'::jsonb);
end;
$$;
