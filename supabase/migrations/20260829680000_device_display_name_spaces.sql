-- Названия приборов: части через пробел, без средней точки.

create or replace function public.device_display_name(group_name text, brand_name text, model_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(
      concat_ws(
        ' ',
        nullif(btrim(coalesce(group_name, '')), ''),
        nullif(btrim(coalesce(brand_name, '')), ''),
        nullif(btrim(coalesce(model_name, '')), '')
      ),
      ''
    ),
    'Прибор'
  );
$$;
