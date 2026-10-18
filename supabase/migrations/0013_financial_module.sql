-- Módulo financeiro: custo histórico e lucro por item vendido (origem: histórico de vendas do
-- MercadoPhone), situação de cada item, metas mensais de lucro por vendedor e registro das
-- sincronizações financeiras.
--
-- Contrato validado em 18/10/2026 contra HistoricoVendaApiController (jul–out/2026, 3.670 itens):
--   * valorTotal  = receita líquida da LINHA (já multiplicada pela quantidade, após taxas/desconto);
--   * valorCusto  = custo histórico da LINHA (não unitário);
--   * lucro       = valorTotal − valorCusto em 100% dos itens (diferença de 0 centavos);
--   * valorCliente = valor bruto pago pelo cliente — é o que `sales.amount` já guarda;
--   * desconto veio 0 em todos os itens; statusVenda ∈ {concluido, cancelada}.
-- Nenhuma coluna existente muda de significado: `amount` continua sendo o valor pago pelo cliente.

-- ============================================================
-- sales: identidade do pedido, situação do item e financeiro
-- ============================================================
alter table sales add column if not exists mp_order_id text;
alter table sales add column if not exists sold_date date;
alter table sales add column if not exists item_status text not null default 'active';
alter table sales add column if not exists status_reason text;
alter table sales add column if not exists status_changed_at timestamptz;

alter table sales add column if not exists revenue numeric(12, 2);
alter table sales add column if not exists customer_paid numeric(12, 2);
alter table sales add column if not exists discount numeric(12, 2);
alter table sales add column if not exists cost numeric(12, 2);
alter table sales add column if not exists profit_reported numeric(12, 2);
alter table sales add column if not exists profit numeric(12, 2);
alter table sales add column if not exists product_type text;
alter table sales add column if not exists customer_name text;
alter table sales add column if not exists financial_status text not null default 'pending';
alter table sales add column if not exists financial_note text;
alter table sales add column if not exists financial_synced_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_item_status_check') then
    alter table sales add constraint sales_item_status_check
      check (item_status in ('active', 'cancelled', 'removed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_financial_status_check') then
    alter table sales add constraint sales_financial_status_check
      check (financial_status in ('pending', 'ok', 'mismatch', 'ambiguous', 'not_found'));
  end if;
end $$;

comment on column sales.mp_order_id is 'Id da venda (pedido) no MercadoPhone — prefixo de external_id.';
comment on column sales.sold_date is 'Data comercial da venda (America/Sao_Paulo). sold_at guarda o horário da loja como se fosse UTC, então a data é a parte de data de sold_at em UTC.';
comment on column sales.item_status is 'active | cancelled (venda cancelada na origem) | removed (item não existe mais na versão completa do pedido). Linhas nunca são apagadas.';
comment on column sales.revenue is 'valorTotal do histórico do MercadoPhone: receita líquida da linha.';
comment on column sales.customer_paid is 'valorCliente do histórico: valor bruto pago pelo cliente pela linha.';
comment on column sales.cost is 'valorCusto do histórico: custo da linha na data da venda. NULL = desconhecido (diferente de 0).';
comment on column sales.profit_reported is 'lucro informado pelo MercadoPhone para a linha.';
comment on column sales.profit is 'Lucro comercial normalizado = revenue − cost. Conciliado com profit_reported.';
comment on column sales.financial_status is 'pending (ainda não conciliado) | ok | mismatch (lucro informado ≠ receita − custo) | ambiguous (item sem correspondência única) | not_found (pedido ausente no histórico).';

-- Valores derivados mantidos pelo banco: inserções do webhook não precisam conhecê-los.
create or replace function sales_set_derived_fields() returns trigger
language plpgsql as $$
begin
  new.sold_date := (new.sold_at at time zone 'UTC')::date;
  if new.external_id ~ '^\d+-\d+-\d+$' then
    new.mp_order_id := split_part(new.external_id, '-', 1);
  end if;
  return new;
end $$;

drop trigger if exists trg_sales_derived_fields on sales;
create trigger trg_sales_derived_fields
  before insert or update of sold_at, external_id on sales
  for each row execute function sales_set_derived_fields();

update sales
set sold_date = (sold_at at time zone 'UTC')::date,
    mp_order_id = case when external_id ~ '^\d+-\d+-\d+$' then split_part(external_id, '-', 1) end
where sold_date is null;

create index if not exists idx_sales_sold_date on sales(sold_date);
create index if not exists idx_sales_mp_order_id on sales(mp_order_id);

-- ============================================================
-- seller_profit_goals: metas mensais de lucro por vendedor
-- ============================================================
create table if not exists seller_profit_goals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete restrict,
  month date not null check (extract(day from month) = 1),
  profit_target numeric(12, 2) check (profit_target >= 0),
  worst_case_target numeric(12, 2) check (worst_case_target >= 0),
  updated_by uuid default auth.uid(),
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, month),
  check (profit_target is null or worst_case_target is null or worst_case_target <= profit_target)
);

create index if not exists idx_seller_profit_goals_month on seller_profit_goals(month);

alter table seller_profit_goals enable row level security;

drop policy if exists "authenticated_full_access" on seller_profit_goals;
create policy "authenticated_full_access" on seller_profit_goals
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- financial_sync_runs: execuções da conciliação financeira
-- ============================================================
create table if not exists financial_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  period_start date not null,
  period_end date not null,
  mode text not null check (mode in ('preview', 'apply')),
  trigger text not null default 'manual',
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  counts jsonb,
  next_start date,
  error text
);

create index if not exists idx_financial_sync_runs_started_at on financial_sync_runs(started_at desc);

alter table financial_sync_runs enable row level security;

drop policy if exists "authenticated_read" on financial_sync_runs;
create policy "authenticated_read" on financial_sync_runs
  for select using (auth.role() = 'authenticated');
