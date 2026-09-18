-- Фото и тип этикетки для карточки позиции склада.

alter table public.inventory_items
  add column if not exists barcode_type text not null default 'code128';

alter table public.inventory_items
  drop constraint if exists inventory_items_barcode_type_check;

alter table public.inventory_items
  add constraint inventory_items_barcode_type_check
  check (barcode_type in ('code128', 'ean8', 'ean13', 'qr', 'upc_a'));

create table if not exists public.inventory_item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  file_path text not null,
  file_name text not null default '',
  mime_type text not null default 'image/jpeg',
  file_size integer not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_item_photos_item_idx
  on public.inventory_item_photos (item_id, sort_order, created_at);

alter table public.inventory_item_photos enable row level security;

drop policy if exists inventory_item_photos_select on public.inventory_item_photos;
create policy inventory_item_photos_select on public.inventory_item_photos
  for select to authenticated
  using (public.can_read_inventory());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-item-photos',
  'inventory-item-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
)
on conflict (id) do nothing;

drop policy if exists inventory_item_photos_select on storage.objects;
create policy inventory_item_photos_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'inventory-item-photos' and public.can_read_inventory());

drop policy if exists inventory_item_photos_insert on storage.objects;
create policy inventory_item_photos_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
  );

drop policy if exists inventory_item_photos_delete on storage.objects;
create policy inventory_item_photos_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'inventory-item-photos'
    and public.has_permission('inventory:receive')
  );

create or replace function public.set_inventory_item_label(
  target_item_id uuid,
  item_barcode text default '',
  item_barcode_type text default 'code128'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_type text;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для изменения этикетки.';
  end if;

  safe_type := lower(btrim(coalesce(item_barcode_type, 'code128')));
  if safe_type not in ('code128', 'ean8', 'ean13', 'qr', 'upc_a') then
    raise exception 'Неизвестный тип штрихкода.';
  end if;

  update public.inventory_items
  set
    barcode = btrim(coalesce(item_barcode, '')),
    barcode_type = safe_type,
    updated_at = now()
  where id = target_item_id;

  if not found then
    raise exception 'Позиция не найдена.';
  end if;
end;
$$;

create or replace function public.register_inventory_item_photo(
  target_item_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_id uuid;
  next_order integer;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для загрузки фото.';
  end if;

  if not exists (select 1 from public.inventory_items where id = target_item_id) then
    raise exception 'Позиция не найдена.';
  end if;

  if btrim(coalesce(file_path, '')) = '' then
    raise exception 'Не указан файл.';
  end if;

  select coalesce(max(sort_order), -1) + 1
  into next_order
  from public.inventory_item_photos
  where item_id = target_item_id;

  insert into public.inventory_item_photos (
    item_id, file_path, file_name, mime_type, file_size, sort_order, created_by
  )
  values (
    target_item_id,
    file_path,
    coalesce(file_name, ''),
    coalesce(mime_type, 'image/jpeg'),
    greatest(coalesce(file_size, 0), 0),
    next_order,
    auth.uid()
  )
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.delete_inventory_item_photo(target_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_item_photos%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления фото.';
  end if;

  select * into current_row
  from public.inventory_item_photos
  where id = target_photo_id
  for update;

  if current_row.id is null then
    raise exception 'Фото не найдено.';
  end if;

  delete from public.inventory_item_photos
  where id = target_photo_id;

  return current_row.file_path;
end;
$$;

create or replace function public.list_inventory_item_photos(target_item_id uuid)
returns table (
  id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size integer,
  sort_order integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_read_inventory() then
    raise exception 'Недостаточно прав для просмотра фото.';
  end if;

  return query
  select
    p.id,
    p.file_path,
    p.file_name,
    p.mime_type,
    p.file_size,
    p.sort_order,
    p.created_at
  from public.inventory_item_photos p
  where p.item_id = target_item_id
  order by p.sort_order, p.created_at;
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
    'category_id', i.category_id,
    'category_name', coalesce(cat.name, ''),
    'unit_id', i.unit_id,
    'unit_name', coalesce(u.name, ''),
    'purchase_price', i.purchase_price,
    'repair_price', i.repair_price,
    'retail_price', i.retail_price,
    'stock_quantity', coalesce((
      select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id
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
            when 'receipt' then 'Приход · ' || coalesce(r.supplier, '')
            when 'sale' then
              case
                when coalesce(s.invoice_number, '') <> '' then 'Продажа · счёт ' || s.invoice_number
                else 'Продажа'
              end
            when 'inventory_adjustment' then 'Инвентаризация · ' || coalesce(a.reason, '')
            else m.reference_type
          end as destination
        from public.inventory_movements m
        join public.inventory_batches bt on bt.id = m.batch_id
        left join public.profiles p on p.id = m.created_by
        left join public.orders o on m.reference_type = 'order' and o.id = m.reference_id
        left join public.inventory_receipts r on m.reference_type = 'receipt' and r.id = m.reference_id
        left join public.inventory_sales s on m.reference_type = 'sale' and s.id = m.reference_id
        left join public.inventory_adjustments a on m.reference_type = 'inventory_adjustment' and a.id = m.reference_id
        where m.item_id = target_item_id
        order by m.created_at desc
        limit 100
      ) mv
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.delete_inventory_item(target_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_items%rowtype;
begin
  if not public.has_permission('inventory:receive') then
    raise exception 'Недостаточно прав для удаления номенклатуры.';
  end if;

  select * into current_row
  from public.inventory_items
  where id = target_item_id
  for update;

  if current_row.id is null then
    raise exception 'Позиция не найдена.';
  end if;

  if exists (select 1 from public.inventory_batches where item_id = target_item_id)
    or exists (select 1 from public.inventory_movements where item_id = target_item_id)
    or exists (select 1 from public.sale_lines where item_id = target_item_id)
    or exists (select 1 from public.inventory_count_lines where item_id = target_item_id)
    or exists (select 1 from public.documents where source_type = 'item' and source_id = target_item_id)
  then
    raise exception 'Позицию нельзя удалить: по ней есть партии, движения или документы.';
  end if;

  delete from public.dynamic_field_values
  where entity_code = 'inventory' and record_id = target_item_id;

  delete from public.inventory_item_photos
  where item_id = target_item_id;

  delete from public.inventory_items
  where id = target_item_id;

  perform public.record_audit(
    'inventory.item_deleted',
    'inventory_item',
    target_item_id::text,
    jsonb_build_object('name', current_row.name, 'code', current_row.code)
  );
end;
$$;

revoke all on function public.set_inventory_item_label(uuid, text, text) from public;
revoke all on function public.register_inventory_item_photo(uuid, text, text, text, integer) from public;
revoke all on function public.delete_inventory_item_photo(uuid) from public;
revoke all on function public.list_inventory_item_photos(uuid) from public;

grant execute on function public.set_inventory_item_label(uuid, text, text) to authenticated;
grant execute on function public.register_inventory_item_photo(uuid, text, text, text, integer) to authenticated;
grant execute on function public.delete_inventory_item_photo(uuid) to authenticated;
grant execute on function public.list_inventory_item_photos(uuid) to authenticated;
