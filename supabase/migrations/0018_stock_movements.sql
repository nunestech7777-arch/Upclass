-- Giro de estoque: registro das ENTRADAS e SAÍDAS de produtos vendidos em lote (acessórios,
-- películas, brindes, peças sem IMEI/série).
--
-- Auditoria da API do MercadoPhone (21/10/2026): não há endpoint de entradas, compras, lotes ou
-- movimentações. Cada produto tem uma única `dataEntrada`, e reposições somam quantidade no MESMO
-- cadastro sem registrar a data (ex.: "PELÍCULA CERÂMICA" com entrada em 02/05/2024 ainda vendendo em
-- 2026). Por isso o sistema passa a comparar o estoque a cada sincronização (mercadophone-sync,
-- a cada 30 min) e grava aqui cada aumento (entrada) e redução (saída) detectados.
--   * baseline: saldo encontrado na primeira leitura — idade DESCONHECIDA (nunca é inventada);
--   * entry: aumento de quantidade (reposição) ou cadastro novo; entry_date = data da detecção no
--     fuso da loja, ou a dataEntrada do MercadoPhone quando ela é posterior à leitura anterior;
--   * exit: saída total desde a leitura anterior (vendas/brindes do histórico + outras baixas);
--   * return: volta ao estoque de item de venda CANCELADA — idade desconhecida (não é reposição).
--     Cancelamentos dos últimos 30 dias já contabilizados ficam em stock_cancellations_seen, para que
--     uma venda antiga cancelada agora conte uma única vez.
-- Entrada = aumento líquido + unidades vendidas no intervalo (reposição e venda na mesma janela de
-- 30 min não se anulam).
-- Unidades com IMEI/série (iPhones, Macs…) não entram aqui: a dataEntrada delas é a real.
-- Aditiva: nenhuma tabela existente é alterada.

create table if not exists stock_levels (
  product_external_id text primary key,
  quantity integer not null check (quantity >= 0),
  name text,
  product_type text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table stock_levels is 'Última quantidade lida do MercadoPhone por produto vendido em lote (base para detectar entradas/saídas).';

create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  product_external_id text not null,
  detected_at timestamptz not null default now(),
  kind text not null check (kind in ('baseline', 'entry', 'exit', 'return')),
  quantity integer not null check (quantity > 0),
  quantity_after integer not null check (quantity_after >= 0),
  entry_date date,
  name text,
  product_type text,
  constraint stock_movements_entry_date_check check ((kind = 'entry') = (entry_date is not null))
);

comment on table stock_movements is 'Entradas (reposições) e saídas detectadas comparando leituras do estoque do MercadoPhone. baseline = saldo inicial sem data conhecida.';

create index if not exists idx_stock_movements_product on stock_movements(product_external_id, detected_at);
create index if not exists idx_stock_movements_detected on stock_movements(detected_at);

alter table stock_levels enable row level security;
alter table stock_movements enable row level security;

-- Só administrador lê; quem grava é a sincronização (service_role).
drop policy if exists admin_read on stock_levels;
create policy admin_read on stock_levels for select to authenticated using ((select public.is_admin()));
drop policy if exists admin_read on stock_movements;
create policy admin_read on stock_movements for select to authenticated using ((select public.is_admin()));

-- Cancelamentos (venda + produto) já contabilizados como devolução — evita contar duas vezes.
create table if not exists stock_cancellations_seen (
  line_key text primary key,
  quantity integer not null,
  seen_at timestamptz not null default now()
);
alter table stock_cancellations_seen enable row level security;
drop policy if exists admin_read on stock_cancellations_seen;
create policy admin_read on stock_cancellations_seen for select to authenticated using ((select public.is_admin()));

-- Gravação atômica (movimentos + níveis na mesma transação, uma sincronização por vez): uma falha
-- no meio ou duas execuções sobrepostas nunca duplicam entradas. Só a sincronização (service_role).
-- p_seen_at = instante da LEITURA do estoque (antes de buscar o histórico): vira detected_at e
-- last_seen_at, e é o limite das vendas consideradas no intervalo.
-- p_based_on = max(last_seen_at) lido ao montar o plano (null = tabela vazia); se outra execução
-- gravou depois disso, o plano está velho e é descartado (retorna -1).
create or replace function public.record_stock_movements(
  p_movements jsonb, p_levels jsonb, p_zeroed text[], p_based_on timestamptz, p_seen_at timestamptz, p_cancelled jsonb
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('record_stock_movements'));
  if (select max(last_seen_at) from stock_levels) is distinct from p_based_on then
    return -1;
  end if;
  insert into stock_movements (product_external_id, detected_at, kind, quantity, quantity_after, entry_date, name, product_type)
  select m.product_external_id, p_seen_at, m.kind, m.quantity, m.quantity_after, m.entry_date, m.name, m.product_type
  from jsonb_to_recordset(coalesce(p_movements, '[]'::jsonb))
    as m(product_external_id text, kind text, quantity integer, quantity_after integer, entry_date date, name text, product_type text);
  get diagnostics v_count = row_count;
  insert into stock_levels (product_external_id, quantity, name, product_type, first_seen_at, last_seen_at)
  select l.product_external_id, l.quantity, l.name, l.product_type, p_seen_at, p_seen_at
  from jsonb_to_recordset(coalesce(p_levels, '[]'::jsonb))
    as l(product_external_id text, quantity integer, name text, product_type text)
  on conflict (product_external_id) do update
    set quantity = excluded.quantity, name = excluded.name, product_type = excluded.product_type, last_seen_at = p_seen_at;
  update stock_levels set quantity = 0, last_seen_at = p_seen_at where product_external_id = any(coalesce(p_zeroed, '{}'));
  insert into stock_cancellations_seen (line_key, quantity, seen_at)
  select c.line_key, c.quantity, p_seen_at
  from jsonb_to_recordset(coalesce(p_cancelled, '[]'::jsonb)) as c(line_key text, quantity integer)
  on conflict (line_key) do nothing;
  delete from stock_cancellations_seen where seen_at < p_seen_at - interval '60 days';
  return v_count;
end $$;

revoke all on function public.record_stock_movements(jsonb, jsonb, text[], timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.record_stock_movements(jsonb, jsonb, text[], timestamptz, timestamptz, jsonb) to service_role;
