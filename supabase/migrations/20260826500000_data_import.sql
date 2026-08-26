-- Журнал импорта: идемпотентные ключи источника, прогон, ошибки по строкам.
-- Импорт выполняется скриптами со service_role, не из React.

create table if not exists public.import_runs (
  id uuid primary key default gen_random_uuid(),
  phase text not null check (phase in ('full', 'delta')),
  status text not null check (status in ('preview', 'running', 'completed', 'failed', 'interrupted')),
  dry_run boolean not null default false,
  source_dir text not null default '',
  totals jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create index if not exists import_runs_started_idx
  on public.import_runs (started_at desc);

create table if not exists public.import_source_keys (
  dataset text not null,
  source_key text not null,
  entity_type text not null,
  entity_id text not null,
  payload_hash text not null,
  last_run_id uuid references public.import_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dataset, source_key)
);

create index if not exists import_source_keys_entity_idx
  on public.import_source_keys (entity_type, entity_id);

create trigger import_source_keys_set_updated_at
  before update on public.import_source_keys
  for each row execute procedure public.set_updated_at();

create table if not exists public.import_row_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.import_runs (id) on delete cascade,
  dataset text not null,
  row_number integer not null,
  source_key text,
  status text not null check (status in ('created', 'updated', 'skipped', 'failed')),
  missing_fields text[] not null default '{}',
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists import_row_results_run_idx
  on public.import_row_results (run_id, dataset, row_number);

create index if not exists import_row_results_failed_idx
  on public.import_row_results (run_id, status)
  where status = 'failed';

comment on table public.import_runs is 'Прогоны миграции данных (полный и дельта). Не часть UI.';
comment on table public.import_source_keys is 'Стабильные ключи источника для идемпотентного импорта.';
comment on table public.import_row_results is 'Результат по каждой строке: создано/обновлено/пропущено/ошибка.';

alter table public.import_runs enable row level security;
alter table public.import_source_keys enable row level security;
alter table public.import_row_results enable row level security;

revoke all on table public.import_runs from public, anon, authenticated;
revoke all on table public.import_source_keys from public, anon, authenticated;
revoke all on table public.import_row_results from public, anon, authenticated;

grant all on table public.import_runs to service_role;
grant all on table public.import_source_keys to service_role;
grant all on table public.import_row_results to service_role;
