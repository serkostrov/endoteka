-- История позиции: агрегация по документам, контрагент, корректные продажи (public.sales).

create or replace function public.get_inventory_item_card(target_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  item_json jsonb;
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра карточки склада.';
  end if;

  select jsonb_build_object(
    'id', i.id,
    'code', i.code,
    'article', i.article,
    'barcode', i.barcode,
    'barcode_type', i.barcode_type,
    'name', i.name,
    'description', i.description,
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(b.remaining_quantity) from public.inventory_batches b where b.item_id = i.id
    ), 0),
    'created_at', i.created_at,
    'updated_at', i.updated_at
  )
  into item_json
  from public.inventory_items i
  left join public.reference_items cat on cat.id = i.category_id
  left join public.reference_items u on u.id = i.unit_id
  where i.id = target_item_id;

  if item_json is null then
    raise exception 'Позиция не найдена.';
  end if;

  return jsonb_build_object(
    'item', item_json,
    'batches', coalesce((
      select jsonb_agg(row_to_json(b)::jsonb order by b.receipt_date, b.created_at)
      from (
        select
          bt.id,
          bt.receipt_id,
          bt.supplier,
          rec.supplier_id,
          bt.receipt_date,
          bt.purchase_price,
          bt.quantity,
          bt.remaining_quantity,
          bt.created_at
        from public.inventory_batches bt
        left join public.inventory_receipts rec on rec.id = bt.receipt_id
        where bt.item_id = target_item_id
      ) b
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(row_to_json(mv)::jsonb order by mv.created_at desc)
      from (
        with raw as (
          select
            m.id,
            m.quantity,
            m.unit_price,
            m.movement_type,
            m.reference_type,
            m.reference_id,
            m.created_at,
            m.batch_id,
            bt.receipt_date as batch_receipt_date,
            bt.supplier as batch_supplier,
            coalesce(p.full_name, '') as actor_name,
            case m.reference_type
              when 'order' then 'Заказ ' || coalesce(o.number, '')
              when 'receipt' then
                case
                  when m.movement_type = 'shortage_cover' then 'Покрытие недостачи'
                  else 'Оприходование'
                end
              when 'sale' then
                'Продажа ' || coalesce(nullif(sa.invoice_number, ''), nullif(legacy.invoice_number, ''), '')
              when 'inventory_adjustment' then 'Инвентаризация'
              when 'inventory_count' then 'Инвентаризация ' || coalesce(c.number, '')
              when 'inventory_write_off' then
                case
                  when m.quantity > 0 then 'Отмена списания'
                  else 'Списание'
                end
              else coalesce(m.reference_type, 'Движение')
            end as document_title,
            case m.reference_type
              when 'order' then coalesce(oc.name, '')
              when 'sale' then coalesce(sc.name, '')
              when 'receipt' then coalesce(r.supplier, bt.supplier, '')
              when 'inventory_adjustment' then coalesce(a.reason, '')
              when 'inventory_write_off' then coalesce(w.reason, '')
              else ''
            end as counterparty_name,
            case m.reference_type
              when 'order' then
                case
                  when m.quantity < 0 then 'Со склада · Добавлено в заказ клиенту'
                  else 'Возврат на склад из заказа'
                end
              when 'sale' then 'Со склада · Продажа клиенту'
              when 'receipt' then
                case
                  when m.movement_type = 'shortage_cover' then 'Покрытие недостачи от поставщика'
                  else 'От поставщика на склад'
                end
              when 'inventory_adjustment' then 'Корректировка остатка'
              when 'inventory_count' then 'Пересчёт склада'
              when 'inventory_write_off' then
                case
                  when m.quantity > 0 then 'Возврат на склад после отмены списания'
                  else 'Списание со склада'
                end
              else ''
            end as description_prefix
          from public.inventory_movements m
          join public.inventory_batches bt on bt.id = m.batch_id
          left join public.profiles p on p.id = m.created_by
          left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
          left join public.customers oc on oc.id = o.customer_id
          left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
          left join public.sales sa on m.reference_type = 'sale' and sa.id = m.reference_id
          left join public.customers sc on sc.id = sa.customer_id
          left join public.inventory_sales legacy on m.reference_type = 'sale' and legacy.id = m.reference_id
          left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
          left join public.inventory_write_offs w on m.reference_type = 'inventory_write_off' and w.id = m.reference_id
          left join public.inventory_counts c on m.reference_type = 'inventory_count' and c.id = m.reference_id
          where m.item_id = target_item_id
        )
        select
          (array_agg(raw.id order by raw.created_at desc))[1] as id,
          sum(raw.quantity) as quantity,
          (array_agg(raw.unit_price order by raw.created_at desc))[1] as unit_price,
          raw.movement_type,
          raw.reference_type,
          raw.reference_id,
          max(raw.created_at) as created_at,
          (array_agg(raw.batch_id order by raw.created_at desc))[1] as batch_id,
          (array_agg(raw.batch_receipt_date order by raw.created_at desc))[1] as batch_receipt_date,
          (array_agg(raw.batch_supplier order by raw.created_at desc))[1] as batch_supplier,
          (array_agg(raw.actor_name order by raw.created_at desc))[1] as actor_name,
          (array_agg(raw.document_title order by raw.created_at desc))[1] as document_title,
          (array_agg(raw.counterparty_name order by raw.created_at desc))[1] as counterparty_name,
          (array_agg(raw.description_prefix order by raw.created_at desc))[1] as description_prefix,
          (array_agg(raw.document_title order by raw.created_at desc))[1] as destination
        from raw
        group by raw.reference_type, raw.reference_id, raw.movement_type
        order by max(raw.created_at) desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;
