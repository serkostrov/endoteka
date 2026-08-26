-- Удаление черновика, пересчёта в работе или отменённого документа. Проведённый нельзя удалить: по нему есть журнал.

create or replace function public.delete_inventory_count(target_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.inventory_counts%rowtype;
begin
  perform public.assert_inventory_count_permission();

  current_row := public.lock_inventory_count(target_count_id);

  if current_row.status = 'completed' then
    raise exception 'Проведённую инвентаризацию нельзя удалить.';
  end if;

  if exists (
    select 1
    from public.inventory_movements
    where reference_type = 'inventory_count' and reference_id = target_count_id
  ) then
    raise exception 'Документ связан с движениями журнала, удаление невозможно.';
  end if;

  delete from public.inventory_counts
  where id = target_count_id;

  perform public.record_audit(
    'inventory.count_deleted',
    'inventory_count',
    target_count_id::text,
    jsonb_build_object('number', current_row.number, 'status', current_row.status)
  );
end;
$$;

revoke all on function public.delete_inventory_count(uuid) from public, anon;
grant execute on function public.delete_inventory_count(uuid) to authenticated;
