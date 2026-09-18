-- Любая активная единица из справочника (не только шт/упак).

create or replace function public.assert_inventory_unit(target_unit_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.reference_items i
    join public.reference_sets s on s.id = i.set_id
    where i.id = target_unit_id
      and s.code = 'units_of_measure'
      and i.is_active = true
  ) then
    raise exception 'Выберите единицу измерения.';
  end if;
end;
$$;
