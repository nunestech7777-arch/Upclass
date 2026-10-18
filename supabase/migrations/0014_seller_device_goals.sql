-- Metas mensais de APARELHOS (iPhones) por vendedor, usadas na página Forecast.
-- Independente das metas de lucro (seller_profit_goals) e da meta global em unidades (goals).
-- Meta ausente (sem linha ou device_target nulo) = "Sem meta"; zero também não gera percentual.

create table if not exists seller_device_goals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  device_target integer check (device_target >= 0),
  updated_by uuid default auth.uid(),
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, month)
);

create index if not exists idx_seller_device_goals_month on seller_device_goals(month);

alter table seller_device_goals enable row level security;

drop policy if exists "authenticated_full_access" on seller_device_goals;
create policy "authenticated_full_access" on seller_device_goals
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
