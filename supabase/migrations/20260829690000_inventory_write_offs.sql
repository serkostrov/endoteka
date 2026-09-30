-- Документы списания со склада: список, проведение FIFO, отмена.

alter table public.inventory_movements
  drop constraint if exists inventory_movements_type_check;

alter table public.inventory_movements
  add constraint inventory_movements_type_check check (
    movement_type in (
      'receipt',
      'repair_consumption',
      'repair_return',
      'sale',
      'inventory_adjustment',
      'shortage_cover',
      'write_off'
    )
  );

alter table public.inventory_movements
  drop constraint if exists inventory_movements_reference_check;

alter table public.inventory_movements
  add constraint inventory_movements_reference_check check (
    reference_type in (
      'receipt',
      'order',
      'sale',
      'inventory_adjustment',
      'inventory_count',
      'inventory_write_off'
    )
  );

create table if not exists public.inventory_write_offs (
  id uuid primary key default gen_random_uuid(),
  write_off_date date not null,
  reason text not null,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  reversed_at timestamptz,
  constraint inventory_write_offs_reason_present check (btrim(reason) <> '')
);

create index if not exists inventory_write_offs_created_at_idx
  on public.inventory_write_offs (created_at desc);

create index if not exists inventory_write_offs_hidden_at_idx
  on public.inventory_write_offs (hidden_at)
  where hidden_at is null;

alter table public.inventory_write_offs enable row level security;

drop policy if exists inventory_write_offs_select on public.inventory_write_offs;
create policy inventory_write_offs_select
  on public.inventory_write_offs
  for select
  to authenticated
  using (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  );

create or replace function public.create_inventory_write_off(
  doc_write_off_date date,
  reason_text text,
  notes_text text,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  write_off_id uuid;
  line record;
  line_count integer := 0;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания.';
  end if;

  if doc_write_off_date is null then
    raise exception 'Укажите дату списания.';
  end if;

  if btrim(coalesce(reason_text, '')) = '' then
    raise exception 'Укажите причину списания.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(lines, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте хотя бы одну позицию списания.';
  end if;

  insert into public.inventory_write_offs (write_off_date, reason, notes, created_by)
  values (
    doc_write_off_date,
    btrim(reason_text),
    btrim(coalesce(notes_text, '')),
    auth.uid()
  )
  returning id into write_off_id;

  for line in
    select *
    from jsonb_to_recordset(lines) as x(
      item_id uuid,
      quantity numeric
    )
  loop
    line_count := line_count + 1;

    if line.item_id is null then
      raise exception 'В строке списания не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция списания не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 then
      raise exception 'Количество в списании должно быть больше нуля.';
    end if;

    perform public.consume_inventory_fifo(
      line.item_id,
      line.quantity,
      'write_off',
      'inventory_write_off',
      write_off_id,
      false
    );
  end loop;

  if line_count = 0 then
    raise exception 'Добавьте хотя бы одну позицию списания.';
  end if;

  perform public.record_audit(
    'inventory.write_off_created',
    'inventory_write_off',
    write_off_id::text,
    jsonb_build_object('reason', btrim(reason_text), 'lines', line_count)
  );

  return write_off_id;
end;
$$;

create or replace function public.list_inventory_write_offs(
  page_number integer default 1,
  page_size integer default 20
)
returns table (
  id uuid,
  write_off_date date,
  reason text,
  notes text,
  created_at timestamptz,
  actor_name text,
  line_count bigint,
  total_quantity numeric,
  total_amount numeric,
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
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списаний.';
  end if;

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    w.id,
    w.write_off_date,
    w.reason,
    w.notes,
    w.created_at,
    coalesce(p.full_name, '') as actor_name,
    count(distinct m.item_id) as line_count,
    coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0) as total_quantity,
    coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0) as total_amount,
    count(*) over() as total_count
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  left join public.inventory_movements m
    on m.reference_type = 'inventory_write_off'
   and m.reference_id = w.id
   and m.movement_type = 'write_off'
  where w.hidden_at is null
    and w.reversed_at is null
  group by w.id, w.write_off_date, w.reason, w.notes, w.created_at, p.full_name
  order by w.created_at desc
  offset (safe_page - 1) * safe_size
  limit safe_size;
end;
$$;

create or replace function public.get_inventory_write_off(target_write_off_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списания.';
  end if;

  select jsonb_build_object(
    'id', w.id,
    'write_off_date', w.write_off_date,
    'reason', w.reason,
    'notes', w.notes,
    'created_at', w.created_at,
    'actor_name', coalesce(p.full_name, ''),
    'reversed_at', w.reversed_at,
    'lines', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.item_name)
      from (
        select
          min(m.id::text) as id,
          m.item_id,
          i.name as item_name,
          i.code as item_code,
          i.article as item_article,
          coalesce(u.name, '') as unit_name,
          sum(-m.quantity) as quantity,
          case
            when sum(-m.quantity) = 0 then 0
            else sum((-m.quantity) * m.unit_price) / nullif(sum(-m.quantity), 0)
          end as unit_price,
          sum((-m.quantity) * m.unit_price) as amount
        from public.inventory_movements m
        join public.inventory_items i on i.id = m.item_id
        left join public.reference_items u on u.id = i.unit_id
        where m.reference_type = 'inventory_write_off'
          and m.reference_id = target_write_off_id
          and m.movement_type = 'write_off'
          and m.quantity < 0
        group by m.item_id, i.name, i.code, i.article, u.name
      ) x
    ), '[]'::jsonb)
  )
  into result
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  where w.id = target_write_off_id
    and w.hidden_at is null;

  return result;
end;
$$;

create or replace function public.delete_inventory_write_off(
  target_write_off_id uuid,
  delete_mode text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_write_offs%rowtype;
  movement_row record;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для удаления списания.';
  end if;

  select *
    into current_row
  from public.inventory_write_offs
  where id = target_write_off_id
  for update;

  if not found then
    raise exception 'Списание не найдено.';
  end if;

  if current_row.reversed_at is not null then
    raise exception 'Списание уже отменено.';
  end if;

  if delete_mode = 'hide' then
    if current_row.hidden_at is not null then
      raise exception 'Списание уже скрыто.';
    end if;

    update public.inventory_write_offs
    set hidden_at = now()
    where id = target_write_off_id;

    perform public.record_audit(
      'inventory.write_off_hidden',
      'inventory_write_off',
      target_write_off_id::text,
      jsonb_build_object('reason', current_row.reason)
    );

    return;
  end if;

  if delete_mode <> 'reverse' then
    raise exception 'Неверный режим удаления списания.';
  end if;

  for movement_row in
    select
      m.item_id,
      m.batch_id,
      m.quantity,
      m.unit_price
    from public.inventory_movements m
    where m.reference_type = 'inventory_write_off'
      and m.reference_id = target_write_off_id
      and m.movement_type = 'write_off'
      and m.quantity < 0
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
      'write_off',
      'inventory_write_off',
      target_write_off_id,
      auth.uid()
    );
  end loop;

  update public.inventory_write_offs
  set hidden_at = coalesce(hidden_at, now()),
      reversed_at = now()
  where id = target_write_off_id;

  perform public.record_audit(
    'inventory.write_off_reversed',
    'inventory_write_off',
    target_write_off_id::text,
    jsonb_build_object('reason', current_row.reason)
  );
end;
$$;

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
                when m.movement_type = 'shortage_cover' then 'Покрытие недостачи ' || coalesce(r.supplier, '')
                else 'Приход ' || coalesce(r.supplier, '')
              end
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация ' || coalesce(a.reason, '')
            when 'inventory_write_off' then
              case
                when m.quantity > 0 then 'Отмена списания ' || coalesce(w.reason, '')
                else 'Списание ' || coalesce(w.reason, '')
              end
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        left join public.inventory_write_offs w on m.reference_type = 'inventory_write_off' and w.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_inventory_write_off(date, text, text, jsonb) from public;
revoke all on function public.list_inventory_write_offs(integer, integer) from public;
revoke all on function public.get_inventory_write_off(uuid) from public;
revoke all on function public.delete_inventory_write_off(uuid, text) from public;

grant execute on function public.create_inventory_write_off(date, text, text, jsonb) to authenticated;
grant execute on function public.list_inventory_write_offs(integer, integer) to authenticated;
grant execute on function public.get_inventory_write_off(uuid) to authenticated;
grant execute on function public.delete_inventory_write_off(uuid, text) to authenticated;
