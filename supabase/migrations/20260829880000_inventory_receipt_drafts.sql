-- Черновики приходов: сохранение без проведения на склад.

alter table public.inventory_receipts
  add column if not exists status text not null default 'posted',
  add column if not exists draft_lines jsonb not null default '[]'::jsonb;

update public.inventory_receipts
set status = 'posted'
where status is distinct from 'posted' and status is distinct from 'draft';

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_status_check;

alter table public.inventory_receipts
  add constraint inventory_receipts_status_check
  check (status in ('draft', 'posted'));

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_supplier_present;

alter table public.inventory_receipts
  add constraint inventory_receipts_supplier_present
  check (status = 'draft' or btrim(supplier) <> '');

alter table public.inventory_receipts
  drop constraint if exists inventory_receipts_draft_lines_check;

alter table public.inventory_receipts
  add constraint inventory_receipts_draft_lines_check
  check (jsonb_typeof(draft_lines) = 'array');

create index if not exists inventory_receipts_status_idx
  on public.inventory_receipts (status, created_at desc)
  where hidden_at is null;

create or replace function public.save_inventory_receipt_draft(
  target_receipt_id uuid default null,
  supplier_name text default '',
  doc_receipt_date date default current_date,
  doc_notes text default '',
  lines jsonb default '[]'::jsonb,
  supplier_customer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_id uuid;
  resolved_name text;
  resolved_supplier_id uuid;
  line record;
  normalized_lines jsonb := '[]'::jsonb;
  line_count integer := 0;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный список позиций.';
  end if;

  resolved_supplier_id := supplier_customer_id;
  resolved_name := btrim(coalesce(supplier_name, ''));

  if resolved_supplier_id is not null then
    select c.name into resolved_name
    from public.customers c
    where c.id = resolved_supplier_id;

    if resolved_name is null then
      raise exception 'Поставщик не найден.';
    end if;
  elsif resolved_name <> '' then
    select c.id
    into resolved_supplier_id
    from public.customers c
    where lower(btrim(c.name)) = lower(resolved_name)
    order by c.created_at
    limit 1;
  end if;

  if doc_receipt_date is null then
    raise exception 'Укажите дату прихода.';
  end if;

  for line in
    select *
    from jsonb_to_recordset(coalesce(lines, '[]'::jsonb)) as x(
      item_id uuid,
      quantity numeric,
      purchase_price numeric
    )
  loop
    if line.item_id is null then
      raise exception 'В строке прихода не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция прихода не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 or line.quantity <> trunc(line.quantity) then
      raise exception 'Количество в приходе должно быть целым числом больше нуля.';
    end if;

    if line.purchase_price is null or line.purchase_price < 0 then
      raise exception 'Цена закупки не может быть отрицательной.';
    end if;

    normalized_lines := normalized_lines || jsonb_build_array(
      jsonb_build_object(
        'item_id', line.item_id,
        'quantity', line.quantity,
        'purchase_price', line.purchase_price
      )
    );
    line_count := line_count + 1;
  end loop;

  if target_receipt_id is null then
    insert into public.inventory_receipts (
      supplier, supplier_id, receipt_date, notes, created_by, status, draft_lines
    )
    values (
      resolved_name,
      resolved_supplier_id,
      doc_receipt_date,
      btrim(coalesce(doc_notes, '')),
      auth.uid(),
      'draft',
      normalized_lines
    )
    returning id into receipt_id;
  else
    update public.inventory_receipts
    set supplier = resolved_name,
        supplier_id = resolved_supplier_id,
        receipt_date = doc_receipt_date,
        notes = btrim(coalesce(doc_notes, '')),
        draft_lines = normalized_lines
    where id = target_receipt_id
      and status = 'draft'
      and hidden_at is null
    returning id into receipt_id;

    if receipt_id is null then
      raise exception 'Черновик прихода не найден.';
    end if;
  end if;

  perform public.record_audit(
    'inventory.receipt_draft_saved',
    'inventory_receipt',
    receipt_id::text,
    jsonb_build_object('supplier', resolved_name, 'lines', line_count)
  );

  return receipt_id;
end;
$$;

create or replace function public.receive_inventory(
  supplier_name text,
  doc_receipt_date date,
  doc_notes text,
  lines jsonb,
  supplier_customer_id uuid default null,
  draft_receipt_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt_id uuid;
  line record;
  batch_id uuid;
  line_count integer := 0;
  resolved_name text;
  resolved_supplier_id uuid;
  source_lines jsonb;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для прихода.';
  end if;

  resolved_supplier_id := supplier_customer_id;
  resolved_name := btrim(coalesce(supplier_name, ''));

  if resolved_supplier_id is not null then
    select c.name into resolved_name
    from public.customers c
    where c.id = resolved_supplier_id;

    if resolved_name is null then
      raise exception 'Поставщик не найден.';
    end if;
  elsif resolved_name = '' then
    raise exception 'Укажите поставщика.';
  else
    select c.id
    into resolved_supplier_id
    from public.customers c
    where lower(btrim(c.name)) = lower(resolved_name)
    order by c.created_at
    limit 1;
  end if;

  if doc_receipt_date is null then
    raise exception 'Укажите дату прихода.';
  end if;

  source_lines := coalesce(lines, '[]'::jsonb);
  if jsonb_typeof(source_lines) <> 'array' or jsonb_array_length(source_lines) = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  if draft_receipt_id is not null then
    update public.inventory_receipts
    set supplier = resolved_name,
        supplier_id = resolved_supplier_id,
        receipt_date = doc_receipt_date,
        notes = btrim(coalesce(doc_notes, '')),
        draft_lines = '[]'::jsonb,
        status = 'posted'
    where id = draft_receipt_id
      and status = 'draft'
      and hidden_at is null
    returning id into receipt_id;

    if receipt_id is null then
      raise exception 'Черновик прихода не найден.';
    end if;
  else
    insert into public.inventory_receipts (
      supplier, supplier_id, receipt_date, notes, created_by, status, draft_lines
    )
    values (
      resolved_name,
      resolved_supplier_id,
      doc_receipt_date,
      btrim(coalesce(doc_notes, '')),
      auth.uid(),
      'posted',
      '[]'::jsonb
    )
    returning id into receipt_id;
  end if;

  for line in
    select *
    from jsonb_to_recordset(source_lines) as x(
      item_id uuid,
      quantity numeric,
      purchase_price numeric
    )
  loop
    line_count := line_count + 1;

    if line.item_id is null then
      raise exception 'В строке прихода не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция прихода не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 then
      raise exception 'Количество в приходе должно быть больше нуля.';
    end if;

    if line.purchase_price is null or line.purchase_price < 0 then
      raise exception 'Цена закупки не может быть отрицательной.';
    end if;

    perform pg_advisory_xact_lock(871001, hashtext(line.item_id::text));

    insert into public.inventory_batches (
      item_id, receipt_id, supplier, receipt_date, purchase_price, quantity, remaining_quantity
    )
    values (
      line.item_id,
      receipt_id,
      resolved_name,
      doc_receipt_date,
      line.purchase_price,
      line.quantity,
      0
    )
    returning id into batch_id;

    insert into public.inventory_movements (
      item_id, batch_id, quantity, unit_price, movement_type, reference_type, reference_id, created_by
    )
    values (
      line.item_id,
      batch_id,
      line.quantity,
      line.purchase_price,
      'receipt',
      'receipt',
      receipt_id,
      auth.uid()
    );

    perform public.settle_inventory_shortage(line.item_id, batch_id, receipt_id);
  end loop;

  if line_count = 0 then
    raise exception 'Добавьте хотя бы одну позицию прихода.';
  end if;

  perform public.record_audit(
    'inventory.received',
    'inventory_receipt',
    receipt_id::text,
    jsonb_build_object('supplier', resolved_name, 'lines', line_count)
  );

  return receipt_id;
end;
$$;

drop function if exists public.list_inventory_receipts(integer, integer);

create or replace function public.list_inventory_receipts(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  supplier text,
  supplier_id uuid,
  receipt_date date,
  notes text,
  status text,
  created_at timestamptz,
  actor_name text,
  line_count bigint,
  total_quantity numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_page integer;
  safe_size integer;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра приходов.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    r.id,
    r.supplier,
    r.supplier_id,
    r.receipt_date,
    r.notes,
    r.status,
    r.created_at,
    coalesce(p.full_name, '') as actor_name,
    case
      when r.status = 'draft' then coalesce(jsonb_array_length(r.draft_lines), 0)::bigint
      else count(m.id)
    end as line_count,
    case
      when r.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric)
        from jsonb_array_elements(r.draft_lines) as line_row(elem)
      ), 0)
      else coalesce(sum(m.quantity), 0)
    end as total_quantity,
    count(*) over() as total_count
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  left join public.inventory_movements m
    on m.reference_type = 'receipt'
   and m.reference_id = r.id
   and m.movement_type = 'receipt'
   and r.status = 'posted'
  where r.hidden_at is null
  group by r.id, r.supplier, r.supplier_id, r.receipt_date, r.notes, r.status, r.draft_lines, r.created_at, p.full_name
  order by
    case when r.status = 'draft' then 0 else 1 end,
    r.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_receipt(target_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  header jsonb;
  receipt_status text;
  receipt_draft_lines jsonb;
begin
  if not public.has_permission('inventory:read') and not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для просмотра прихода.';
  end if;

  select
    jsonb_build_object(
      'id', r.id,
      'supplier', r.supplier,
      'supplier_id', r.supplier_id,
      'receipt_date', r.receipt_date,
      'notes', r.notes,
      'status', r.status,
      'created_at', r.created_at,
      'actor_name', coalesce(p.full_name, '')
    ),
    r.status,
    r.draft_lines
  into header, receipt_status, receipt_draft_lines
  from public.inventory_receipts r
  left join public.profiles p on p.id = r.created_by
  where r.id = target_receipt_id
    and r.hidden_at is null;

  if header is null then
    raise exception 'Приход не найден.';
  end if;

  if receipt_status = 'draft' then
    return header || jsonb_build_object(
      'lines', coalesce((
        select jsonb_agg(row_to_json(x)::jsonb order by x.sort_order)
        from (
          select
            'draft-' || ordinality::text as id,
            (elem ->> 'item_id')::uuid as item_id,
            i.name as item_name,
            i.code as item_code,
            i.article as item_article,
            i.barcode as item_barcode,
            i.category_id,
            coalesce(cat.name, '') as category_name,
            i.unit_id,
            coalesce(u.name, '') as unit_name,
            i.purchase_price as item_purchase_price,
            i.repair_price,
            i.retail_price,
            coalesce((
              select sum(b.remaining_quantity)
              from public.inventory_batches b
              where b.item_id = i.id
            ), 0) as stock_quantity,
            i.created_at as item_created_at,
            i.updated_at as item_updated_at,
            (elem ->> 'quantity')::numeric as quantity,
            (elem ->> 'purchase_price')::numeric as unit_price,
            null::uuid as batch_id,
            0::numeric as remaining_quantity,
            ordinality as sort_order,
            null::timestamptz as created_at
          from jsonb_array_elements(coalesce(receipt_draft_lines, '[]'::jsonb))
            with ordinality as draft(elem, ordinality)
          join public.inventory_items i on i.id = (elem ->> 'item_id')::uuid
          left join public.reference_items cat on cat.id = i.category_id
          left join public.reference_items u on u.id = i.unit_id
        ) x
      ), '[]'::jsonb)
    );
  end if;

  return header || jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.created_at)
      from (
        select
          m.id,
          m.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          m.quantity,
          m.unit_price,
          m.batch_id,
          b.remaining_quantity,
          m.created_at
        from public.inventory_movements m
        join public.inventory_items i on i.id = m.item_id
        join public.inventory_batches b on b.id = m.batch_id
        where m.reference_type = 'receipt'
          and m.reference_id = target_receipt_id
          and m.movement_type = 'receipt'
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.delete_inventory_receipt(
  target_receipt_id uuid,
  delete_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_receipts%rowtype;
  movement_row record;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления прихода.';
  end if;

  select *
    into current_row
  from public.inventory_receipts
  where id = target_receipt_id
  for update;

  if not found then
    raise exception 'Приход не найден.';
  end if;

  if current_row.status = 'draft' then
    delete from public.inventory_receipts where id = target_receipt_id;

    perform public.record_audit(
      'inventory.receipt_draft_deleted',
      'inventory_receipt',
      target_receipt_id::text,
      jsonb_build_object('supplier', current_row.supplier)
    );
    return;
  end if;

  if current_row.reversed_at is not null then
    raise exception 'Приход уже отменён.';
  end if;

  if delete_mode = 'hide' then
    if current_row.hidden_at is not null then
      raise exception 'Приход уже скрыт.';
    end if;

    update public.inventory_receipts
    set hidden_at = now()
    where id = target_receipt_id;

    perform public.record_audit(
      'inventory.receipt_hidden',
      'inventory_receipt',
      target_receipt_id::text,
      jsonb_build_object('supplier', current_row.supplier)
    );

    return;
  end if;

  if delete_mode <> 'reverse' then
    raise exception 'Неверный режим удаления прихода.';
  end if;

  for movement_row in
    select
      m.id,
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price,
      b.remaining_quantity
    from public.inventory_movements m
    join public.inventory_batches b on b.id = m.batch_id
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    if movement_row.remaining_quantity < movement_row.quantity then
      raise exception 'Нельзя отменить приход: часть позиций уже списана.';
    end if;
  end loop;

  for movement_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'receipt'
      and m.reference_id = target_receipt_id
      and m.movement_type = 'receipt'
    order by m.created_at, m.id
  loop
    perform pg_advisory_xact_lock(871001, hashtext(movement_row.item_id::text));

    insert into public.inventory_movements (
      item_id,
      batch_id,
      quantity,
      unit_price,
      movement_type,
      reference_type,
      reference_id,
      created_by
    )
    values (
      movement_row.item_id,
      movement_row.batch_id,
      -movement_row.quantity,
      movement_row.unit_price,
      'inventory_adjustment',
      'receipt',
      target_receipt_id,
      auth.uid()
    );
  end loop;

  update public.inventory_receipts
  set hidden_at = coalesce(hidden_at, now()),
      reversed_at = now()
  where id = target_receipt_id;

  perform public.record_audit(
    'inventory.receipt_reversed',
    'inventory_receipt',
    target_receipt_id::text,
    jsonb_build_object('supplier', current_row.supplier)
  );
end;
$$;

revoke all on function public.save_inventory_receipt_draft(uuid, text, date, text, jsonb, uuid) from public, anon;
grant execute on function public.save_inventory_receipt_draft(uuid, text, date, text, jsonb, uuid) to authenticated;

revoke all on function public.receive_inventory(text, date, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.receive_inventory(text, date, text, jsonb, uuid, uuid) to authenticated;

-- Оставляем одну сигнатуру с default-аргументами (PostgREST иначе путает overloads).
drop function if exists public.receive_inventory(text, date, text, jsonb);
drop function if exists public.receive_inventory(text, date, text, jsonb, uuid);

revoke all on function public.list_inventory_receipts(integer, integer) from public, anon;
grant execute on function public.list_inventory_receipts(integer, integer) to authenticated;

revoke all on function public.get_inventory_receipt(uuid) from public, anon;
grant execute on function public.get_inventory_receipt(uuid) to authenticated;

revoke all on function public.delete_inventory_receipt(uuid, text) from public, anon;
grant execute on function public.delete_inventory_receipt(uuid, text) to authenticated;

notify pgrst, 'reload schema';
