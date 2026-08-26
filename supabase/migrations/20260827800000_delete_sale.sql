-- Удаление черновика или отменённого счёта. Подтверждённую продажу нельзя удалить.

create or replace function public.delete_sale(target_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.sales%rowtype;
begin
  if not public.has_permission('sales:delete') then
    raise exception 'Недостаточно прав для удаления продажи.';
  end if;

  current_row := public.lock_sale(target_sale_id);

  if current_row.status = 'confirmed' then
    raise exception 'Подтверждённую продажу нельзя удалить.';
  end if;

  delete from public.sale_allocations
  where sale_id = target_sale_id;

  delete from public.sale_lines
  where sale_id = target_sale_id;

  delete from public.documents
  where source_type = 'sale' and source_id = target_sale_id;

  delete from public.sales
  where id = target_sale_id;

  perform public.record_audit(
    'sale.deleted',
    'sale',
    target_sale_id::text,
    jsonb_build_object('invoice_number', current_row.invoice_number, 'status', current_row.status)
  );
end;
$$;

revoke all on function public.delete_sale(uuid) from public;
grant execute on function public.delete_sale(uuid) to authenticated;
