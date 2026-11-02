-- Conciliação financeira segura (auditoria de 31/10/2026).
--
-- A loja lança vendas com dias de atraso e data retroativa: a venda chega ao painel quando é
-- lançada, mas `sold_date` é a data informada. A conciliação passa a escolher os dias a conferir
-- também pela chegada (`created_at`) e pelos itens ainda pendentes, e a registrar cada tentativa.
--
-- * sales.financial_checked_at / financial_check_attempts: última conferência e número de
--   tentativas sem conciliar (para priorizar e para não deixar pendência esquecida).
-- * financial_reconcile_alerts: mudanças que a conciliação NÃO aplica sozinha (custo/receita
--   alterados na origem depois de conciliados, troca de modelo, correspondência insegura, item ou
--   pedido do histórico sem linha no painel, pendência antiga). Só revisão manual resolve.
-- * financial_reconcile_attempts: tentativas de conciliação por pedido (webhook e rotina), com o
--   resultado (falha da API, histórico vazio, pedido ausente, conciliado...).
-- Nenhum dado existente é alterado.

alter table sales add column if not exists financial_checked_at timestamptz;
alter table sales add column if not exists financial_check_attempts integer not null default 0;

comment on column sales.financial_checked_at is 'Última vez que a conciliação conferiu esta linha com o histórico do MercadoPhone (mesmo sem mudança).';
comment on column sales.financial_check_attempts is 'Conferências seguidas sem conciliar (zera quando a linha fica ok).';

create index if not exists idx_sales_financial_pending
  on sales(sold_date)
  where item_status = 'active' and financial_status in ('pending', 'not_found', 'ambiguous', 'mismatch');
create index if not exists idx_sales_created_at on sales(created_at);

-- ============================================================
-- Alertas para revisão manual
-- ============================================================
create table if not exists financial_reconcile_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in (
    'retroactive_change', -- valor já conciliado mudou na origem
    'model_swap',         -- item trocado por outro modelo no pedido
    'unsafe_match',       -- troca/correspondência sem par único
    'history_without_row',-- item do histórico sem linha no painel
    'order_missing',      -- pedido concluído no histórico sem nenhuma linha no painel
    'pending_too_long'    -- item pendente após várias conferências
  )),
  mp_order_id text not null,
  external_id text,
  sale_id uuid references sales(id) on delete set null,
  sold_date date,
  current_values jsonb,
  proposed_values jsonb,
  has_evidence boolean,
  detail text not null,
  dedupe_key text not null unique,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text
);

comment on table financial_reconcile_alerts is 'Diferenças que a conciliação automática não aplica: exigem revisão manual. dedupe_key evita repetir o mesmo alerta a cada execução.';
comment on column financial_reconcile_alerts.has_evidence is 'retroactive_change: true quando o valor atual foi gravado poucos dias após o lançamento da venda (evidência do custo da época) — o valor atual é mantido.';

create index if not exists idx_financial_reconcile_alerts_open on financial_reconcile_alerts(created_at desc) where status = 'open';
create index if not exists idx_financial_reconcile_alerts_order on financial_reconcile_alerts(mp_order_id);

-- ============================================================
-- Tentativas de conciliação por pedido
-- ============================================================
create table if not exists financial_reconcile_attempts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('webhook', 'cron', 'manual')),
  mp_order_id text not null,
  outcome text not null check (outcome in (
    'reconciled',       -- todas as linhas ativas do pedido ficaram ok
    'still_pending',    -- conferido, mas ainda há linha sem custo/receita
    'empty_history',    -- consulta ao histórico voltou sem itens
    'order_not_in_history', -- histórico veio, mas sem este pedido
    'api_error',        -- falha na consulta ao MercadoPhone
    'apply_error'       -- falha ao gravar
  )),
  attempt integer not null default 1,
  detail text
);

create index if not exists idx_financial_reconcile_attempts_order on financial_reconcile_attempts(mp_order_id, created_at desc);
create index if not exists idx_financial_reconcile_attempts_created on financial_reconcile_attempts(created_at desc);

-- Só administrador lê (custos e lucro). Escrita só pelas functions (service_role ignora RLS).
alter table financial_reconcile_alerts enable row level security;
alter table financial_reconcile_attempts enable row level security;

drop policy if exists "admin_read" on financial_reconcile_alerts;
create policy "admin_read" on financial_reconcile_alerts for select using (public.is_admin());
drop policy if exists "admin_update" on financial_reconcile_alerts;
create policy "admin_update" on financial_reconcile_alerts for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_read" on financial_reconcile_attempts;
create policy "admin_read" on financial_reconcile_attempts for select using (public.is_admin());
