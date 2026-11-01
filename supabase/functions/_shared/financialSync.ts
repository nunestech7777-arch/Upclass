/**
 * Executa a conciliação financeira (financialReconcile.ts) contra o banco, por janelas de dias,
 * registrando cada execução em `financial_sync_runs`. Sem dependência de Deno: o cliente Supabase
 * e a consulta ao histórico do MercadoPhone são injetados.
 *
 * - `preview` só calcula e registra as contagens; `apply` grava as alterações, os alertas e as
 *   tentativas por pedido.
 * - Período contínuo (`start`/`end`, botão manual): retomável — se o tempo acabar, devolve
 *   `next_start`; falha ao consultar a origem interrompe sem gravar a janela (valores válidos ficam).
 * - Lista de dias (`days`, rotina de 30 min): cada dia é independente — falha num dia é registrada e
 *   os demais seguem. Ver `pickReconcileDays` para a escolha dos dias.
 */
import {
  DEFAULT_GRACE_DAYS,
  planFinancialReconcile,
  type HistoricoFinanceItem,
  type ReconcileAlert,
  type ReconcileCounts,
  type ReconcileIssue,
  type SaleFinanceRow,
} from './financialReconcile.ts';

export type FetchHistory = (dataInicial: string, dataFinal: string) => Promise<HistoricoFinanceItem[]>;

export const SALE_FINANCE_COLUMNS =
  'id, external_id, quantity, amount, created_at, sold_date, item_status, status_reason, revenue, customer_paid, discount, cost, profit_reported, profit, product_type, customer_name, financial_status, financial_note, financial_synced_at, financial_check_attempts, products(name)';

/** Primeiro dia que a rotina automática reprocessa (meses anteriores só com aprovação). */
export const SWEEP_SINCE = '2026-09-01';
/** Situações financeiras que a rotina continua conferindo. */
export const OPEN_FINANCIAL_STATUSES = ['pending', 'not_found', 'ambiguous', 'mismatch'];
/** Tentativas seguidas sem conciliar registradas em financial_reconcile_attempts: a 1ª e depois a
 * cada N (≈ 6 h na rotina de 30 min), além de toda mudança de resultado para conciliado/erro. */
export const ATTEMPT_LOG_EVERY = 12;
/** Conferências sem conciliar até virar alerta de revisão (≈ 1 dia de rotina a cada 30 min). */
export const PENDING_ALERT_ATTEMPTS = 48;

export interface FinancialSyncOptions {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD (inclusive)
  mode: 'preview' | 'apply';
  trigger: string;
  /** Lista de dias a conferir (rotina). Quando informada, substitui o período contínuo. */
  days?: string[];
  windowDays?: number;
  timeBudgetMs?: number;
  now?: Date;
  graceDays?: number;
}

export interface DayFailure {
  day: string;
  error: string;
}

export interface FinancialSyncResult {
  run_id: string | null;
  mode: 'preview' | 'apply';
  period_start: string;
  period_end: string;
  processed_until: string | null;
  next_start: string | null;
  counts: ReconcileCounts;
  issues: ReconcileIssue[];
  alerts: ReconcileAlert[];
  days_processed: string[];
  days_failed: DayFailure[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Data de hoje no fuso da loja. */
export function todayInStore(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

function sumCounts(a: ReconcileCounts, b: ReconcileCounts): ReconcileCounts {
  const out = { ...a };
  for (const key of Object.keys(b) as (keyof ReconcileCounts)[]) out[key] += b[key];
  return out;
}

type LoadedRow = SaleFinanceRow & { financial_check_attempts?: number | null };

// deno-lint-ignore no-explicit-any
async function loadSales(supabase: any, start: string, end: string): Promise<LoadedRow[]> {
  const rows: LoadedRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('sales')
      .select(SALE_FINANCE_COLUMNS)
      .gte('sold_date', start)
      .lte('sold_date', end)
      .order('id')
      .range(offset, offset + 999);
    if (error) throw new Error(`listar vendas ${start}..${end}: ${error.message}`);
    // Nome do produto (join) vira `product_name`: só leitura, para reconhecer troca de unidade.
    rows.push(...((data ?? []) as unknown as (LoadedRow & { products?: { name?: string | null } | null })[]).map(withProductName));
    if ((data ?? []).length < 1000) return rows;
  }
}

/** Converte o join `products(name)` em `product_name` (usado também pelo webhook). */
export function withProductName<T extends { products?: { name?: string | null } | null }>({ products, ...row }: T): Omit<T, 'products'> & { product_name: string | null } {
  return { ...row, product_name: products?.name ?? null };
}

/** Campos de valor: só quando um deles muda a linha ganha nova data de conciliação (evidência). */
const VALUE_KEYS = ['revenue', 'cost', 'profit', 'profit_reported'];

/** Data de conciliação só quando receita/custo/lucro mudam — preserva quando o valor foi gravado. */
export function withSyncStamp(patch: Record<string, unknown>, at: string): Record<string, unknown> {
  return VALUE_KEYS.some((k) => k in patch) ? { ...patch, financial_synced_at: at } : patch;
}

// deno-lint-ignore no-explicit-any
async function applyUpdates(supabase: any, updates: { id: string; patch: Record<string, unknown> }[]) {
  const syncedAt = new Date().toISOString();
  // Patches idênticos (ex.: muitas linhas "não encontrado") vão numa escrita só, em lotes de 200.
  const groups = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
  for (const u of updates) {
    const patch = withSyncStamp(u.patch, syncedAt);
    const key = JSON.stringify(patch);
    const g = groups.get(key) ?? { patch, ids: [] };
    g.ids.push(u.id);
    groups.set(key, g);
  }
  const queue = [...groups.values()].flatMap((g) => {
    const out: { patch: Record<string, unknown>; ids: string[] }[] = [];
    for (let i = 0; i < g.ids.length; i += 200) out.push({ patch: g.patch, ids: g.ids.slice(i, i + 200) });
    return out;
  });
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { error } = next.ids.length === 1
        ? await supabase.from('sales').update(next.patch).eq('id', next.ids[0])
        : await supabase.from('sales').update(next.patch).in('id', next.ids);
      if (error) throw new Error(`gravar financeiro de ${next.ids.length} linha(s): ${error.message}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

/** Registra a conferência (data e contador de tentativas), uma escrita por valor de contador. */
// deno-lint-ignore no-explicit-any
async function markChecked(supabase: any, checks: { id: string; attempts: number }[], checkedAt: string): Promise<void> {
  const byAttempts = new Map<number, string[]>();
  for (const c of checks) byAttempts.set(c.attempts, [...(byAttempts.get(c.attempts) ?? []), c.id]);
  for (const [n, ids] of byAttempts) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase
        .from('sales')
        .update({ financial_checked_at: checkedAt, financial_check_attempts: n })
        .in('id', ids.slice(i, i + 200));
      if (error) throw new Error(`registrar conferência: ${error.message}`);
    }
  }
}

/** Grava alertas sem repetir (dedupe_key). Falha aqui não desfaz a conciliação: só é registrada. */
// deno-lint-ignore no-explicit-any
export async function saveAlerts(supabase: any, alerts: ReconcileAlert[]): Promise<void> {
  if (alerts.length === 0) return;
  const rows = alerts.map((a) => ({
    kind: a.kind,
    mp_order_id: a.orderId,
    external_id: a.externalId,
    sale_id: a.saleId,
    sold_date: a.soldDate,
    current_values: a.current,
    proposed_values: a.proposed,
    has_evidence: a.hasEvidence,
    detail: a.detail,
    dedupe_key: a.dedupeKey,
  }));
  const { error } = await supabase.from('financial_reconcile_alerts').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) throw new Error(`gravar alertas: ${error.message}`);
}

export type AttemptOutcome = 'reconciled' | 'still_pending' | 'empty_history' | 'order_not_in_history' | 'api_error' | 'apply_error';

// deno-lint-ignore no-explicit-any
export async function saveAttempts(supabase: any, source: 'webhook' | 'cron' | 'manual', attempts: { orderId: string; outcome: AttemptOutcome; attempt?: number; detail?: string | null }[]) {
  if (attempts.length === 0) return;
  const { error } = await supabase.from('financial_reconcile_attempts').insert(
    attempts.map((a) => ({ source, mp_order_id: a.orderId, outcome: a.outcome, attempt: a.attempt ?? 1, detail: a.detail ?? null }))
  );
  if (error) throw new Error(`gravar tentativas: ${error.message}`);
}

const NOT_OK = new Set(OPEN_FINANCIAL_STATUSES);
const orderOf = (row: SaleFinanceRow) => /^(\d+)-/.exec(row.external_id ?? '')?.[1] ?? null;
const isOpen = (row: SaleFinanceRow) => (row.item_status ?? 'active') === 'active' && NOT_OK.has(row.financial_status ?? 'pending');

/**
 * Resultado da conferência por pedido que ainda não estava conciliado, para o registro de
 * tentativas e para o contador de conferências sem conciliar. Puro (testável).
 */
export function planAttempts(
  before: LoadedRow[],
  history: HistoricoFinanceItem[],
  updates: { id: string; patch: Record<string, unknown> }[],
  checkedAt: string
): {
  attempts: { orderId: string; outcome: AttemptOutcome; attempt: number }[];
  checks: { id: string; patch: Record<string, unknown> }[];
  stale: LoadedRow[];
} {
  const patchById = new Map(updates.map((u) => [u.id, u.patch]));
  const ordersInHistory = new Set(history.map((h) => String(h.vendaId)));
  const byOrder = new Map<string, LoadedRow[]>();
  for (const row of before) {
    if (!isOpen(row)) continue;
    const orderId = orderOf(row);
    if (!orderId) continue;
    byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), row]);
  }
  const attempts: { orderId: string; outcome: AttemptOutcome; attempt: number }[] = [];
  const checks: { id: string; patch: Record<string, unknown> }[] = [];
  const stale: LoadedRow[] = [];
  for (const [orderId, rows] of byOrder) {
    let open = 0;
    let maxAttempt = 0;
    for (const row of rows) {
      const after = { ...row, ...(patchById.get(row.id) ?? {}) };
      const resolved = (after.item_status ?? 'active') !== 'active' || !NOT_OK.has(after.financial_status ?? 'pending');
      const next = resolved ? 0 : (row.financial_check_attempts ?? 0) + 1;
      maxAttempt = Math.max(maxAttempt, next);
      if (!resolved) {
        open += 1;
        if (next >= PENDING_ALERT_ATTEMPTS) stale.push({ ...row, financial_check_attempts: next });
      }
      checks.push({ id: row.id, patch: { financial_checked_at: checkedAt, financial_check_attempts: next } });
    }
    const outcome: AttemptOutcome = open === 0 ? 'reconciled' : history.length === 0 ? 'empty_history' : ordersInHistory.has(orderId) ? 'still_pending' : 'order_not_in_history';
    const attempt = Math.max(maxAttempt, 1);
    // Conciliado sempre registra; pendência repetida só na 1ª conferência e a cada ATTEMPT_LOG_EVERY.
    if (outcome === 'reconciled' || attempt === 1 || attempt % ATTEMPT_LOG_EVERY === 0) attempts.push({ orderId, outcome, attempt });
  }
  return { attempts, checks, stale };
}

function pendingAlerts(rows: LoadedRow[]): ReconcileAlert[] {
  return rows.map((row) => ({
    kind: 'pending_too_long',
    orderId: orderOf(row) ?? '?',
    externalId: row.external_id,
    saleId: row.id,
    soldDate: row.sold_date ?? null,
    current: { financial_status: row.financial_status ?? null, conferencias: row.financial_check_attempts ?? 0 },
    proposed: null,
    hasEvidence: null,
    detail: `Item conferido ${row.financial_check_attempts} vezes sem custo/receita no MercadoPhone (situação: ${row.financial_status ?? 'pending'})`,
    dedupeKey: `pending_too_long|${row.external_id}`,
  }));
}

export async function runFinancialSync(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  fetchHistory: FetchHistory,
  options: FinancialSyncOptions
): Promise<FinancialSyncResult> {
  const { start, end, mode, trigger } = options;
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || start > end) {
    throw new Error('período inválido: use start/end no formato AAAA-MM-DD, com start ≤ end');
  }
  const days = options.days;
  if (days && days.some((d) => !ISO_DATE.test(d))) throw new Error('dia inválido na lista (AAAA-MM-DD)');
  const windowDays = options.windowDays ?? 7;
  const deadline = Date.now() + (options.timeBudgetMs ?? 100_000);
  const planOptions = { now: options.now, graceDays: options.graceDays ?? DEFAULT_GRACE_DAYS };
  const source: 'cron' | 'manual' = trigger === 'cron' ? 'cron' : 'manual';

  const windows: [string, string][] = days
    ? days.map((d) => [d, d])
    : (() => {
        const out: [string, string][] = [];
        for (let ws = start; ws <= end; ws = addDays(ws, windowDays)) {
          const we = addDays(ws, windowDays - 1) < end ? addDays(ws, windowDays - 1) : end;
          out.push([ws, we]);
        }
        return out;
      })();

  const { data: run } = await supabase
    .from('financial_sync_runs')
    .insert({ period_start: start, period_end: end, mode, trigger })
    .select('id')
    .single();
  const runId: string | null = run?.id ?? null;

  let counts: ReconcileCounts | null = null;
  const issues: ReconcileIssue[] = [];
  const alerts: ReconcileAlert[] = [];
  const daysProcessed: string[] = [];
  const daysFailed: DayFailure[] = [];
  let processedUntil: string | null = null;
  let nextStart: string | null = null;

  const processWindow = async (ws: string, we: string) => {
    const sales = await loadSales(supabase, ws, we);
    let history: HistoricoFinanceItem[];
    try {
      history = await fetchHistory(`${ws} 00:00:00`, `${we} 23:59:59`);
    } catch (err) {
      if (mode === 'apply') {
        const open = sales.filter(isOpen);
        const orders = [...new Set(open.map(orderOf).filter((o): o is string => !!o))];
        await saveAttempts(supabase, source, orders.map((orderId) => ({ orderId, outcome: 'api_error' as const, detail: String(err).slice(0, 500) }))).catch(() => {});
        // Marca a conferência mesmo com falha: o dia vai para o fim da fila e a contagem segue até
        // virar alerta — um dia que sempre falha não ocupa vaga em toda execução.
        await markChecked(supabase, open.map((r) => ({ id: r.id, attempts: (r.financial_check_attempts ?? 0) + 1 })), new Date().toISOString()).catch(() => {});
      }
      throw err;
    }
    const plan = planFinancialReconcile(history, sales, planOptions);
    const updates = plan.updates as unknown as { id: string; patch: Record<string, unknown> }[];
    if (mode === 'apply') {
      const checkedAt = new Date().toISOString();
      const tracked = planAttempts(sales, history, updates, checkedAt);
      try {
        await applyUpdates(supabase, updates);
      } catch (err) {
        await saveAttempts(supabase, source, tracked.attempts.map((a) => ({ ...a, outcome: 'apply_error' as const, detail: String(err).slice(0, 500) }))).catch(() => {});
        throw err;
      }
      // Conferência sem mudança também conta: atualiza só as linhas que estavam pendentes, em lote.
      await markChecked(supabase, tracked.checks.map((c) => ({ id: c.id, attempts: c.patch.financial_check_attempts as number })), checkedAt);
      const windowAlerts = [...plan.alerts, ...pendingAlerts(tracked.stale)];
      await saveAlerts(supabase, windowAlerts);
      await saveAttempts(supabase, source, tracked.attempts);
      alerts.push(...windowAlerts);
    } else {
      alerts.push(...plan.alerts);
    }
    counts = counts ? sumCounts(counts, plan.counts) : plan.counts;
    if (issues.length < 200) issues.push(...plan.issues.slice(0, 200 - issues.length));
  };

  try {
    for (const [ws, we] of windows) {
      if (Date.now() > deadline) {
        nextStart = ws;
        break;
      }
      if (days) {
        // Rotina: um dia com falha não impede os outros.
        try {
          await processWindow(ws, we);
          daysProcessed.push(ws);
        } catch (err) {
          daysFailed.push({ day: ws, error: String(err).slice(0, 300) });
          // MercadoPhone fora do ar: não insiste nos outros dias nesta execução (respeita o tempo da
          // function); a próxima rotina retoma.
          if (/MercadoPhone API/.test(String(err))) {
            nextStart = windows[windows.findIndex(([d]) => d === ws) + 1]?.[0] ?? null;
            break;
          }
        }
      } else {
        await processWindow(ws, we);
        daysProcessed.push(ws);
      }
      processedUntil = we;
    }

    const finalCounts: ReconcileCounts = counts ?? planFinancialReconcile([], []).counts;
    const status = days && daysFailed.length > 0 && daysProcessed.length === 0 ? 'error' : 'ok';
    if (runId) {
      await supabase
        .from('financial_sync_runs')
        .update({
          status,
          finished_at: new Date().toISOString(),
          counts: {
            ...finalCounts,
            processed_until: processedUntil,
            days_processed: days ? daysProcessed : undefined,
            days_failed: daysFailed.length > 0 ? daysFailed : undefined,
            issues: issues.slice(0, 50),
          },
          error: daysFailed.length > 0 ? daysFailed.map((f) => `${f.day}: ${f.error}`).join(' | ').slice(0, 2000) : null,
          next_start: nextStart,
        })
        .eq('id', runId);
    }
    return {
      run_id: runId,
      mode,
      period_start: start,
      period_end: end,
      processed_until: processedUntil,
      next_start: nextStart,
      counts: finalCounts,
      issues,
      alerts,
      days_processed: daysProcessed,
      days_failed: daysFailed,
    };
  } catch (err) {
    if (runId) {
      await supabase
        .from('financial_sync_runs')
        .update({
          status: 'error',
          finished_at: new Date().toISOString(),
          error: String(err),
          counts: counts ? { ...(counts as ReconcileCounts), processed_until: processedUntil } : null,
          next_start: processedUntil ? addDays(processedUntil, 1) : start,
        })
        .eq('id', runId);
    }
    throw err;
  }
}

/**
 * Dias que a rotina de 30 min confere, em ordem de prioridade, até `maxDays` (cada dia ≈ 1 consulta
 * ao histórico):
 *  1. as datas de venda dos últimos `recentDays` dias (como antes);
 *  2. as datas de venda das linhas que CHEGARAM ao painel nos últimos `recentDays` dias — a loja
 *     lança vendas com dias de atraso e data retroativa (caso 8734927);
 *  3. as datas com itens ativos ainda pendentes/não encontrados/ambíguos desde `since`, primeiro os
 *     nunca conferidos e depois os conferidos há mais tempo.
 * Meses anteriores a `since` nunca entram (só manualmente, com aprovação).
 */
export async function pickReconcileDays(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  { now = new Date(), recentDays = 3, since = SWEEP_SINCE, maxDays = 12 }: { now?: Date; recentDays?: number; since?: string; maxDays?: number } = {}
): Promise<string[]> {
  const today = todayInStore(now);
  const ordered: string[] = [];
  const push = (d: string | null | undefined) => {
    if (d && ISO_DATE.test(d) && d >= since && d <= today && !ordered.includes(d)) ordered.push(d);
  };
  for (let i = recentDays; i >= 0; i--) push(addDays(today, -i));

  // Vendas lançadas nos últimos dias com data retroativa: as datas mais recentes primeiro.
  const arrivedSince = new Date(now.getTime() - recentDays * 86_400_000).toISOString();
  const { data: arrived, error: arrivedError } = await supabase
    .from('sales')
    .select('sold_date')
    .gte('created_at', arrivedSince)
    .gte('sold_date', since)
    .order('sold_date', { ascending: false })
    .limit(2000);
  if (arrivedError) throw new Error(`listar vendas lançadas recentemente: ${arrivedError.message}`);
  for (const r of arrived ?? []) push(r.sold_date);

  // Pendências desde `since`: nunca conferidas primeiro, depois as conferidas há mais tempo. Pelo
  // menos `pendingSlots` vagas ficam reservadas para elas mesmo com muitos lançamentos retroativos.
  const pendingSlots = 3;
  const { data: open, error: openError } = await supabase
    .from('sales')
    .select('sold_date, financial_checked_at')
    .eq('item_status', 'active')
    .in('financial_status', OPEN_FINANCIAL_STATUSES)
    .gte('sold_date', since)
    .order('financial_checked_at', { ascending: true, nullsFirst: true })
    .order('sold_date', { ascending: true })
    .limit(2000);
  if (openError) throw new Error(`listar itens pendentes: ${openError.message}`);
  const pendingDays: string[] = [];
  for (const r of open ?? []) if (r.sold_date && !ordered.includes(r.sold_date) && !pendingDays.includes(r.sold_date) && r.sold_date >= since && r.sold_date <= today) pendingDays.push(r.sold_date);

  const limit = Math.max(maxDays, recentDays + 1 + pendingSlots);
  const reserved = Math.min(pendingSlots, pendingDays.length);
  const head = ordered.slice(0, limit - reserved);
  const tail = pendingDays.slice(0, limit - head.length);
  return [...head, ...tail];
}
