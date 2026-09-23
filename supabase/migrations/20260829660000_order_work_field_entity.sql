-- Раздел полей карточек «Состав работы» (значения хранятся на заказе).

insert into public.field_entities (code, name, description, sort_order)
values (
  'order_work',
  'Состав работы',
  'Дополнительные поля вкладки «Состав работы» в заказе',
  1
)
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- Сдвинуть остальные разделы после заказов / состава работы.
update public.field_entities set sort_order = 2 where code = 'customers';
update public.field_entities set sort_order = 3 where code = 'devices';
update public.field_entities set sort_order = 4 where code = 'diagnostics';
update public.field_entities set sort_order = 5 where code = 'inventory';
update public.field_entities set sort_order = 6 where code = 'tasks';
