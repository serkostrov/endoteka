-- Тест на герметичность — обычное доп. поле протокола, не обязательное поле по умолчанию.

update public.dynamic_fields
set is_required = false
where entity_code = 'diagnostics'
  and code = 'leak_test'
  and is_required = true;
