-- Формат номера заказа: А0001 (префикс + цифры, без дефиса).
-- Уже выданные номера не меняются; новые выдаются в новом формате.

create or replace function public.next_order_number()
returns table (order_number text, seq integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_val integer;
  current_prefix text;
  current_pad integer;
begin
  update public.order_number_sequence
  set last_value = greatest(last_value, start_value - 1) + 1
  where id = 1
  returning last_value, prefix, pad_width into next_val, current_prefix, current_pad;

  if next_val is null then
    raise exception 'Не настроена нумерация заказов.';
  end if;

  order_number := current_prefix || lpad(next_val::text, current_pad, '0');
  seq := next_val;
  return next;
end;
$$;

create or replace function public.preview_next_order_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select prefix || lpad((greatest(last_value, start_value - 1) + 1)::text, pad_width, '0')
  from public.order_number_sequence
  where id = 1;
$$;

update public.order_number_sequence
set prefix = 'А'
where id = 1;

update public.app_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{prefix}', '"А"'::jsonb)
where key = 'order_number';

alter table public.order_number_sequence
  alter column prefix set default 'А';
