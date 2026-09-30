-- Списание: reference_type inventory_write_off не был в check constraint.
-- Из‑за этого create_inventory_write_off падал при insert в inventory_movements.

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
