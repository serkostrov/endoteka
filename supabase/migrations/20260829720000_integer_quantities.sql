-- Количество деталей, работ и услуг — только целые числа.
-- Движения и «жёсткие» поля партии защищены триггерами — отключаем на время правки.

alter table public.inventory_movements disable trigger inventory_movements_immutable;
alter table public.inventory_batches disable trigger inventory_batches_protect;

-- Дробные «пылинки» (|q| < 0.5) при round дают 0 и ломают check quantity <> 0 — удаляем.
delete from public.sale_allocations
where abs(quantity) < 0.5
   or movement_id in (
     select id from public.inventory_movements where abs(quantity) < 0.5
   );

delete from public.inventory_movements
where abs(quantity) < 0.5;

-- 1) Округлить остальные дробные значения
update public.inventory_movements
set quantity = round(quantity)
where quantity is distinct from round(quantity);

update public.inventory_batches
set
  quantity = greatest(1, round(quantity)),
  remaining_quantity = greatest(0, round(remaining_quantity))
where quantity is distinct from round(quantity)
   or remaining_quantity is distinct from round(remaining_quantity);

-- Синхронизация остатка партии с журналом после правок движений
update public.inventory_batches b
set remaining_quantity = greatest(
  0,
  coalesce((
    select sum(m.quantity)
    from public.inventory_movements m
    where m.batch_id = b.id
  ), 0)
);

-- Партия не может иметь remaining > quantity
update public.inventory_batches
set quantity = greatest(remaining_quantity, 1)
where remaining_quantity > quantity;

-- Партии без движений и с нулевым остатком: quantity минимум 1 (check quantity > 0)
update public.inventory_batches
set quantity = greatest(quantity, 1)
where quantity < 1;

alter table public.inventory_movements enable trigger inventory_movements_immutable;
alter table public.inventory_batches enable trigger inventory_batches_protect;

update public.sale_lines
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.sale_allocations
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.order_part_lines
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.order_service_lines
set quantity = greatest(1, round(quantity))
where quantity is distinct from round(quantity);

update public.inventory_count_lines
set
  expected_quantity = greatest(0, round(expected_quantity)),
  actual_quantity = case
    when actual_quantity is null then null
    else greatest(0, round(actual_quantity))
  end
where expected_quantity is distinct from round(expected_quantity)
   or (actual_quantity is not null and actual_quantity is distinct from round(actual_quantity));

-- 2) Сузить типы колонок до целых numeric(14,0)
alter table public.inventory_batches
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity)),
  alter column remaining_quantity type numeric(14, 0) using greatest(0, round(remaining_quantity));

alter table public.inventory_movements
  alter column quantity type numeric(14, 0) using (
    case
      when round(quantity) = 0 then sign(quantity)
      else round(quantity)
    end
  );

-- amount зависит от quantity — снимаем generated, меняем тип, возвращаем
alter table public.sale_lines
  drop column if exists amount;

alter table public.sale_lines
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

alter table public.sale_lines
  add column amount numeric(14, 2)
    generated always as (round((quantity * unit_price)::numeric, 2)) stored;

alter table public.sale_allocations
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

alter table public.order_part_lines
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

alter table public.order_service_lines
  alter column quantity type numeric(14, 0) using greatest(1, round(quantity));

-- generated difference зависит от типов actual/expected — пересоздаём
alter table public.inventory_count_lines
  drop column if exists difference;

alter table public.inventory_count_lines
  alter column expected_quantity type numeric(14, 0) using greatest(0, round(expected_quantity)),
  alter column actual_quantity type numeric(14, 0) using (
    case
      when actual_quantity is null then null
      else greatest(0, round(actual_quantity))
    end
  );

alter table public.inventory_count_lines
  add column difference numeric(14, 0)
    generated always as (actual_quantity - expected_quantity) stored;
