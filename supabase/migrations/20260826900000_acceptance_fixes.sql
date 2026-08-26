-- Приёмка: журнал заказа, этикетка штрихкода, ручная проверка сроков, закрытие устаревшего RPC продажи.

grant execute on function public.process_order_deadline_notifications() to authenticated;

revoke all on function public.consume_inventory_for_sale(uuid, numeric, text, text)
  from public, anon, authenticated;

update public.document_templates
set body = $json$
  [
    {"id":"p1","type":"text","text":"{{item.name}}"},
    {"id":"p2","type":"text","text":"{{item.code}}"},
    {"id":"bc1","type":"barcode","value":"{{item.barcode}}"},
    {"id":"p3","type":"text","text":"{{item.article}}"}
  ]
$json$::jsonb
where code = 'label_part' and is_system = true;

create or replace function public.write_order_journal_on_parts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if new.reference_type <> 'order' or new.movement_type <> 'repair_consumption' then
    return new;
  end if;

  select name into item_name from public.inventory_items where id = new.item_id;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    new.reference_id,
    'parts_consumed',
    auth.uid(),
    'Списано: ' || coalesce(item_name, 'позиция') || ' × ' || trim(to_char(abs(new.quantity), '999999990.999')),
    jsonb_build_object(
      'item_id', new.item_id,
      'quantity', abs(new.quantity),
      'movement_id', new.id
    )
  );

  return new;
end;
$$;

drop trigger if exists inventory_movements_order_journal on public.inventory_movements;
create trigger inventory_movements_order_journal
  after insert on public.inventory_movements
  for each row
  execute procedure public.write_order_journal_on_parts();

create or replace function public.write_order_journal_on_responsible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  responsible_name text;
begin
  if new.responsible_id is not distinct from old.responsible_id then
    return new;
  end if;

  if new.responsible_id is not null then
    select coalesce(nullif(full_name, ''), email, '')
      into responsible_name
    from public.profiles
    where id = new.responsible_id;
  end if;

  insert into public.order_journal_events (order_id, event_type, actor_id, summary, payload)
  values (
    new.id,
    'responsible_assigned',
    auth.uid(),
    case
      when new.responsible_id is null then 'Ответственный снят'
      else 'Назначен ответственный: ' || coalesce(nullif(responsible_name, ''), 'сотрудник')
    end,
    jsonb_build_object(
      'responsible_id', new.responsible_id,
      'previous_responsible_id', old.responsible_id
    )
  );

  return new;
end;
$$;

drop trigger if exists orders_responsible_journal on public.orders;
create trigger orders_responsible_journal
  after update of responsible_id on public.orders
  for each row
  execute procedure public.write_order_journal_on_responsible();
