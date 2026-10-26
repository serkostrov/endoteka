-- Черновики списаний: сохранение без проведения на склад.

alter table public.inventory_write_offs
  add column if not exists status text not null default 'posted',
  add column if not exists draft_lines jsonb not null default '[]'::jsonb;

update public.inventory_write_offs
set status = 'posted'
where status is distinct from 'posted' and status is distinct from 'draft';

alter table public.inventory_write_offs
  drop constraint if exists inventory_write_offs_status_check;

alter table public.inventory_write_offs
  add constraint inventory_write_offs_status_check
  check (status in ('draft', 'posted'));

alter table public.inventory_write_offs
  drop constraint if exists inventory_write_offs_reason_present;

alter table public.inventory_write_offs
  add constraint inventory_write_offs_reason_present
  check (status = 'draft' or btrim(reason) <> '');

alter table public.inventory_write_offs
  drop constraint if exists inventory_write_offs_draft_lines_check;

alter table public.inventory_write_offs
  add constraint inventory_write_offs_draft_lines_check
  check (jsonb_typeof(draft_lines) = 'array');

create index if not exists inventory_write_offs_status_idx
  on public.inventory_write_offs (status, created_at desc)
  where hidden_at is null;

create or replace function public.save_inventory_write_off_draft(
  target_write_off_id uuid default null,
  doc_write_off_date date default current_date,
  reason_text text default '',
  notes_text text default '',
  lines jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  write_off_id uuid;
  line record;
  normalized_lines jsonb := '[]'::jsonb;
  line_count integer := 0;
begin
  if not public.has_permission('inventory:write_off') then
    raise exception 'Недостаточно прав для списания.';
  end if;

  if jsonb_typeof(coalesce(lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный список позиций.';
  end if;

  if doc_write_off_date is null then
    raise exception 'Укажите дату списания.';
  end if;

  for line in
    select *
    from jsonb_to_recordset(coalesce(lines, '[]'::jsonb)) as x(
      item_id uuid,
      quantity numeric
    )
  loop
    if line.item_id is null then
      raise exception 'В строке списания не указана позиция.';
    end if;

    if not exists (select 1 from public.inventory_items where id = line.item_id) then
      raise exception 'Позиция списания не найдена.';
    end if;

    if line.quantity is null or line.quantity <= 0 or line.quantity <> trunc(line.quantity) then
      raise exception 'Количество в списании должно быть целым числом больше нуля.';
    end if;

    normalized_lines := normalized_lines || jsonb_build_array(
      jsonb_build_object(
        'item_id', line.item_id,
        'quantity', line.quantity
      )
    );
    line_count := line_count + 1;
  end loop;

  if target_write_off_id is null then
    insert into public.inventory_write_offs (
      write_off_date, reason, notes, created_by, status, draft_lines
    )
    values (
      doc_write_off_date,
      btrim(coalesce(reason_text, '')),
      btrim(coalesce(notes_text, '')),
      auth.uid(),
      'draft',
      normalized_lines
    )
    returning id into write_off_id;
  else
    update public.inventory_write_offs
    set write_off_date = doc_write_off_date,
        reason = btrim(coalesce(reason_text, '')),
        notes = btrim(coalesce(notes_text, '')),
        draft_lines = normalized_lines
    where id = target_write_off_id
      and status = 'draft'
      and hidden_at is null
    returning id into write_off_id;

    if write_off_id is null then
      raise exception 'Черновик списания не найден.';
    end if;
  end if;

  perform public.record_audit(
    'inventory.write_off_draft_saved',
    'inventory_write_off',
    write_off_id::text,
    jsonb_build_object('reason', btrim(coalesce(reason_text, '')), 'lines', line_count)
  );

  return write_off_id;
end;
$$;

drop function if exists public.create_inventory_write_off(date, text, text, jsonb);

create or replace function public.create_inventory_write_off(
  doc_write_off_date date,
  reason_text text,
  notes_text text,
  lines jsonb,
  draft_write_off_id uuid default null
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
  source_lines jsonb;
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

  source_lines := coalesce(lines, '[]'::jsonb);
  if jsonb_typeof(source_lines) <> 'array' or jsonb_array_length(source_lines) = 0 then
    raise exception 'Добавьте хотя бы одну позицию списания.';
  end if;

  if draft_write_off_id is not null then
    update public.inventory_write_offs
    set write_off_date = doc_write_off_date,
        reason = btrim(reason_text),
        notes = btrim(coalesce(notes_text, '')),
        draft_lines = '[]'::jsonb,
        status = 'posted'
    where id = draft_write_off_id
      and status = 'draft'
      and hidden_at is null
    returning id into write_off_id;

    if write_off_id is null then
      raise exception 'Черновик списания не найден.';
    end if;
  else
    insert into public.inventory_write_offs (
      write_off_date, reason, notes, created_by, status, draft_lines
    )
    values (
      doc_write_off_date,
      btrim(reason_text),
      btrim(coalesce(notes_text, '')),
      auth.uid(),
      'posted',
      '[]'::jsonb
    )
    returning id into write_off_id;
  end if;

  for line in
    select *
    from jsonb_to_recordset(source_lines) as x(
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

drop function if exists public.list_inventory_write_offs(integer, integer);
drop function if exists public.list_inventory_write_offs(integer, integer, text, text);
drop function if exists public.list_inventory_write_offs(integer, integer, text, text, text);

create or replace function public.list_inventory_write_offs(
  page_number integer default 1,
  page_size integer default 20,
  sort_by text default 'created',
  sort_dir text default 'desc',
  status_filter text default 'all'
)
returns table (
  id uuid,
  write_off_date date,
  reason text,
  notes text,
  status text,
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
  sort_col text;
  sort_asc boolean;
  status_value text;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списаний.';
  end if;

  status_value := coalesce(nullif(btrim(status_filter), ''), 'all');
  if status_value not in ('all', 'draft', 'posted') then
    raise exception 'Неизвестный фильтр статуса.';
  end if;

  sort_col := lower(coalesce(nullif(btrim(sort_by), ''), 'created'));
  if sort_col not in ('date', 'status', 'reason', 'lines', 'qty', 'amount', 'actor', 'created') then
    sort_col := 'created';
  end if;
  sort_asc := lower(coalesce(nullif(btrim(sort_dir), ''), 'desc')) = 'asc';

  safe_page := greatest(coalesce(page_number, 1), 1);
  safe_size := least(greatest(coalesce(page_size, 20), 1), 100);

  return query
  select
    w.id,
    w.write_off_date,
    w.reason,
    w.notes,
    w.status,
    w.created_at,
    coalesce(p.full_name, '') as actor_name,
    case
      when w.status = 'draft' then coalesce(jsonb_array_length(w.draft_lines), 0)::bigint
      else count(distinct m.item_id)
    end as line_count,
    case
      when w.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric)
        from jsonb_array_elements(w.draft_lines) as line_row(elem)
      ), 0)
      else coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
    end as total_quantity,
    case
      when w.status = 'draft' then coalesce((
        select sum((line_row.elem ->> 'quantity')::numeric * i.purchase_price)
        from jsonb_array_elements(w.draft_lines) as line_row(elem)
        join public.inventory_items i on i.id = (line_row.elem ->> 'item_id')::uuid
      ), 0)
      else coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
    end as total_amount,
    count(*) over() as total_count
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  left join public.inventory_movements m
    on m.reference_type = 'inventory_write_off'
   and m.reference_id = w.id
   and m.movement_type = 'write_off'
   and w.status = 'posted'
  where w.hidden_at is null
    and w.reversed_at is null
    and (status_value = 'all' or w.status = status_value)
  group by w.id, w.write_off_date, w.reason, w.notes, w.status, w.draft_lines, w.created_at, p.full_name
  order by
    case when sort_col = 'created' and not sort_asc then case when w.status = 'draft' then 0 else 1 end end,
    case when sort_col = 'date' and sort_asc then w.write_off_date end asc nulls last,
    case when sort_col = 'date' and not sort_asc then w.write_off_date end desc nulls last,
    case when sort_col = 'status' and sort_asc then w.status end asc nulls last,
    case when sort_col = 'status' and not sort_asc then w.status end desc nulls last,
    case when sort_col = 'reason' and sort_asc then w.reason end asc nulls last,
    case when sort_col = 'reason' and not sort_asc then w.reason end desc nulls last,
    case when sort_col = 'lines' and sort_asc then
      case
        when w.status = 'draft' then coalesce(jsonb_array_length(w.draft_lines), 0)::bigint
        else count(distinct m.item_id)
      end
    end asc nulls last,
    case when sort_col = 'lines' and not sort_asc then
      case
        when w.status = 'draft' then coalesce(jsonb_array_length(w.draft_lines), 0)::bigint
        else count(distinct m.item_id)
      end
    end desc nulls last,
    case when sort_col = 'qty' and sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
        ), 0)
        else coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
      end
    end asc nulls last,
    case when sort_col = 'qty' and not sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
        ), 0)
        else coalesce(sum(-m.quantity) filter (where m.quantity < 0), 0)
      end
    end desc nulls last,
    case when sort_col = 'amount' and sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric * i.purchase_price)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
          join public.inventory_items i on i.id = (line_row.elem ->> 'item_id')::uuid
        ), 0)
        else coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
      end
    end asc nulls last,
    case when sort_col = 'amount' and not sort_asc then
      case
        when w.status = 'draft' then coalesce((
          select sum((line_row.elem ->> 'quantity')::numeric * i.purchase_price)
          from jsonb_array_elements(w.draft_lines) as line_row(elem)
          join public.inventory_items i on i.id = (line_row.elem ->> 'item_id')::uuid
        ), 0)
        else coalesce(sum((-m.quantity) * m.unit_price) filter (where m.quantity < 0), 0)
      end
    end desc nulls last,
    case when sort_col = 'actor' and sort_asc then coalesce(p.full_name, '') end asc nulls last,
    case when sort_col = 'actor' and not sort_asc then coalesce(p.full_name, '') end desc nulls last,
    case when sort_col = 'created' and sort_asc then w.created_at end asc nulls last,
    case when sort_col = 'created' and not sort_asc then w.created_at end desc nulls last,
    w.created_at desc
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
  header jsonb;
  write_off_status text;
  write_off_draft_lines jsonb;
begin
  if not (
    public.has_permission('inventory:read')
    or public.has_permission('inventory:write_off')
  ) then
    raise exception 'Недостаточно прав для просмотра списания.';
  end if;

  select
    jsonb_build_object(
      'id', w.id,
      'write_off_date', w.write_off_date,
      'reason', w.reason,
      'notes', w.notes,
      'status', w.status,
      'created_at', w.created_at,
      'actor_name', coalesce(p.full_name, ''),
      'reversed_at', w.reversed_at
    ),
    w.status,
    w.draft_lines
  into header, write_off_status, write_off_draft_lines
  from public.inventory_write_offs w
  left join public.profiles p on p.id = w.created_by
  where w.id = target_write_off_id
    and w.hidden_at is null;

  if header is null then
    raise exception 'Списание не найдено.';
  end if;

  if write_off_status = 'draft' then
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
            i.purchase_price as unit_price,
            (elem ->> 'quantity')::numeric * i.purchase_price as amount,
            ordinality as sort_order
          from jsonb_array_elements(coalesce(write_off_draft_lines, '[]'::jsonb))
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
  );
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

  if current_row.status = 'draft' then
    delete from public.inventory_write_offs where id = target_write_off_id;

    perform public.record_audit(
      'inventory.write_off_draft_deleted',
      'inventory_write_off',
      target_write_off_id::text,
      jsonb_build_object('reason', current_row.reason)
    );
    return;
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

revoke all on function public.save_inventory_write_off_draft(uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.save_inventory_write_off_draft(uuid, date, text, text, jsonb) to authenticated;

revoke all on function public.create_inventory_write_off(date, text, text, jsonb, uuid) from public, anon;
grant execute on function public.create_inventory_write_off(date, text, text, jsonb, uuid) to authenticated;

revoke all on function public.list_inventory_write_offs(integer, integer, text, text, text) from public, anon;
grant execute on function public.list_inventory_write_offs(integer, integer, text, text, text) to authenticated;

revoke all on function public.get_inventory_write_off(uuid) from public, anon;
grant execute on function public.get_inventory_write_off(uuid) to authenticated;

revoke all on function public.delete_inventory_write_off(uuid, text) from public, anon;
grant execute on function public.delete_inventory_write_off(uuid, text) to authenticated;

notify pgrst, 'reload schema';
