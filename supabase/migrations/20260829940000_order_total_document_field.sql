-- Поле шаблона «Сумма заказа»: работы + запчасти (как Итог в списке заказов).

create or replace function public.empty_document_values()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'company.name', 'Эндотека',
    'document.number', '',
    'document.issuedAt', '',
    'order.number', '',
    'order.createdAt', '',
    'order.status', '',
    'order.claimedMalfunction', '',
    'order.completeness', '',
    'order.externalCondition', '',
    'order.deadline', '',
    'order.readyDate', '',
    'order.responsible', '',
    'order.total', '',
    'customer.name', '',
    'customer.phone', '',
    'customer.email', '',
    'customer.inn', '',
    'customer.city', '',
    'customer.contactName', '',
    'device.serialNumber', '',
    'device.model', '',
    'device.brand', '',
    'device.group', '',
    'device.label', '',
    'sale.invoiceNumber', '',
    'sale.date', '',
    'sale.total', '',
    'sale.customerName', '',
    'sale.status', '',
    'item.name', '',
    'item.code', '',
    'item.article', '',
    'item.barcode', '',
    'part.name', '',
    'part.code', '',
    'part.article', '',
    'part.quantity', '',
    'part.unitName', '',
    'part.price', '',
    'line.name', '',
    'line.code', '',
    'line.article', '',
    'line.quantity', '',
    'line.unitName', '',
    'line.price', '',
    'line.amount', ''
  );
$$;

create or replace function public.build_document_context(
  p_source_type text,
  p_source_id uuid,
  p_document_number text default '',
  p_issued_at text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  doc_values jsonb := public.empty_document_values();
  parts jsonb := '[]'::jsonb;
  lines jsonb := '[]'::jsonb;
  first_part jsonb;
  first_line jsonb;
  order_customer_id uuid;
  order_device_id uuid;
begin
  doc_values := doc_values || jsonb_build_object(
    'document.number', coalesce(p_document_number, ''),
    'document.issuedAt', coalesce(p_issued_at, '')
  );

  if p_source_type = 'order' then
    if not public.has_permission('orders:read') then
      raise exception 'Недостаточно прав для данных заказа.';
    end if;

    select
      doc_values || jsonb_build_object(
        'order.number', o.number,
        'order.createdAt', to_char(o.created_at, 'YYYY-MM-DD'),
        'order.status', coalesce(st.name, ''),
        'order.claimedMalfunction', o.claimed_malfunction,
        'order.completeness', o.completeness,
        'order.externalCondition', o.external_condition,
        'order.deadline', coalesce(to_char(o.deadline, 'YYYY-MM-DD'), ''),
        'order.readyDate', coalesce(to_char(o.ready_date, 'YYYY-MM-DD'), ''),
        'order.responsible', coalesce(resp.full_name, ''),
        'order.total', trim(to_char(public.order_total_amount(o.id), '999999990.99')),
        'customer.name', coalesce(c.name, ''),
        'customer.phone', coalesce(c.phone, ''),
        'customer.email', coalesce(c.email, ''),
        'customer.inn', coalesce(c.inn, ''),
        'customer.city', coalesce(c.city, ''),
        'customer.contactName', coalesce(c.contact_name, ''),
        'device.serialNumber', coalesce(o.serial_number, ''),
        'device.model', coalesce(model.name, ''),
        'device.brand', coalesce(brand.name, ''),
        'device.group', coalesce(grp.name, ''),
        'device.label', trim(both ' ' from concat_ws(' ', coalesce(brand.name, ''), coalesce(model.name, ''), o.serial_number))
      ),
      o.customer_id,
      o.device_id
    into doc_values, order_customer_id, order_device_id
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    left join public.devices d on d.id = o.device_id
    left join public.reference_items st on st.id = o.status_id
    left join public.reference_items grp on grp.id = d.group_id
    left join public.reference_items brand on brand.id = d.brand_id
    left join public.reference_items model on model.id = d.model_id
    left join public.profiles resp on resp.id = o.responsible_id
    where o.id = p_source_id;

    if doc_values is null then
      raise exception 'Заказ не найден.';
    end if;

    doc_values := doc_values
      || public.document_dynamic_field_values('orders', p_source_id)
      || public.document_dynamic_field_values('customers', order_customer_id)
      || public.document_dynamic_field_values('devices', order_device_id)
      || public.document_dynamic_field_values('diagnostics', p_source_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'part.name', x.item_name,
      'part.code', x.item_code,
      'part.article', x.item_article,
      'part.quantity', x.quantity,
      'part.unitName', x.unit_name,
      'part.price', x.unit_price
    ) order by x.created_at), '[]'::jsonb)
    into parts
    from (
      select
        i.name as item_name,
        i.code as item_code,
        i.article as item_article,
        trim(to_char(l.quantity, '999999990.999')) as quantity,
        coalesce(u.name, '') as unit_name,
        trim(to_char(l.unit_price, '999999990.99')) as unit_price,
        l.created_at
      from public.order_part_lines l
      join public.inventory_items i on i.id = l.item_id
      left join public.reference_items u on u.id = i.unit_id
      where l.order_id = p_source_id
    ) x;

    first_part := parts -> 0;
    if first_part is not null then
      doc_values := doc_values || first_part;
    end if;
  elsif p_source_type = 'sale' then
    if not public.has_permission('sales:read') then
      raise exception 'Недостаточно прав для данных продажи.';
    end if;

    select
      doc_values || jsonb_build_object(
        'sale.invoiceNumber', s.invoice_number,
        'sale.date', to_char(s.sale_date, 'YYYY-MM-DD'),
        'sale.total', trim(to_char(s.total, '999999990.99')),
        'sale.customerName', coalesce(c.name, ''),
        'sale.status', case s.status
          when 'draft' then 'Черновик'
          when 'confirmed' then 'Подтверждена'
          when 'cancelled' then 'Отменена'
          else s.status
        end,
        'customer.name', coalesce(c.name, ''),
        'customer.phone', coalesce(c.phone, ''),
        'customer.email', coalesce(c.email, ''),
        'customer.inn', coalesce(c.inn, ''),
        'customer.city', coalesce(c.city, ''),
        'customer.contactName', coalesce(c.contact_name, '')
      ),
      s.customer_id
    into doc_values, order_customer_id
    from public.sales s
    left join public.customers c on c.id = s.customer_id
    where s.id = p_source_id;

    if doc_values is null then
      raise exception 'Продажа не найдена.';
    end if;

    doc_values := doc_values || public.document_dynamic_field_values('customers', order_customer_id);

    select coalesce(jsonb_agg(jsonb_build_object(
      'line.name', i.name,
      'line.code', i.code,
      'line.article', i.article,
      'line.quantity', trim(to_char(l.quantity, '999999990.999')),
      'line.unitName', coalesce(u.name, ''),
      'line.price', trim(to_char(l.unit_price, '999999990.99')),
      'line.amount', trim(to_char(l.amount, '999999990.99'))
    ) order by l.sort_order, l.created_at), '[]'::jsonb)
    into lines
    from public.sale_lines l
    join public.inventory_items i on i.id = l.item_id
    left join public.reference_items u on u.id = i.unit_id
    where l.sale_id = p_source_id;

    first_line := lines -> 0;
    if first_line is not null then
      doc_values := doc_values || first_line;
    end if;
  elsif p_source_type = 'item' then
    if not (
      public.can_read_inventory()
      or public.has_permission('orders:read')
      or public.has_permission('sales:read')
    ) then
      raise exception 'Недостаточно прав для данных номенклатуры.';
    end if;

    select doc_values || jsonb_build_object(
      'item.name', i.name,
      'item.code', i.code,
      'item.article', i.article,
      'item.barcode', i.barcode,
      'part.name', i.name,
      'part.code', i.code,
      'part.article', i.article
    )
    into doc_values
    from public.inventory_items i
    where i.id = p_source_id;

    if doc_values is null then
      raise exception 'Позиция не найдена.';
    end if;

    doc_values := doc_values || public.document_dynamic_field_values('inventory', p_source_id);
  elsif p_source_type <> 'none' then
    raise exception 'Неизвестный источник документа.';
  end if;

  return jsonb_build_object(
    'values', doc_values,
    'parts', coalesce(parts, '[]'::jsonb),
    'lines', coalesce(lines, '[]'::jsonb)
  );
end;
$$;

