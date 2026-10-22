/**
 * Executa a conciliação financeira (financialReconcile.ts) contra o banco, por janelas de dias,
 * registrando cada execução em `financial_sync_runs`. Sem dependência de Deno: o cliente Supabase
 * e a consulta ao histórico do MercadoPhone são injetados.
 *
 * - `preview` só calcula e registra as contagens; `apply` grava as alterações.
 * - Retomável: se o tempo acabar, devolve `next_start` para continuar do dia seguinte já concluído.
 * - Falha ao consultar a origem interrompe a janela sem gravar nada dela (valores válidos ficam).
 */
import {
  planFinancialReconcile,
  type HistoricoFinanceItem,
  type ReconcileCounts,
  type ReconcileIssue,
  type SaleFinanceRow,
} from './financialReconcile.ts';

export type FetchHistory = (dataInicial: string, dataFinal: string) => Promise<HistoricoFinanceItem[]>;

export const SALE_FINANCE_COLUMNS =
  'id, external_id, quantity, amount, created_at, item_status, status_reason, revenue, customer_paid, discount, cost, profit_reported, profit, product_type, customer_name, financial_status, financial_note, products(name)';

export interface FinancialSyncOptions {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD (inclusive)
  mode: 'preview' | 'apply';
  trigger: string;
  windowDays?: number;
  timeBudgetMs?: number;
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

// deno-lint-ignore no-explicit-any
async function loadSales(supabase: any, start: string, end: string): Promise<SaleFinanceRow[]> {
  const rows: SaleFinanceRow[] = [];
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
    rows.push(
      ...((data ?? []) as unknown as (SaleFinanceRow & { products?: { name?: string | null } | null })[]).map(({ products, ...r }) => ({
        ...r,
        product_name: products?.name ?? null,
      }))
    );
    if ((data ?? []).length < 1000) return rows;
  }
}

// deno-lint-ignore no-explicit-any
async function applyUpdates(supabase: any, updates: { id: string; patch: Record<string, unknown> }[]) {
  const syncedAt = new Date().toISOString();
  const queue = [...updates];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { error } = await supabase
        .from('sales')
        .update({ ...next.patch, financial_synced_at: syncedAt })
        .eq('id', next.id);
      if (error) throw new Error(`gravar financeiro da linha ${next.id}: ${error.message}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
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
  const windowDays = options.windowDays ?? 7;
  const deadline = Date.now() + (options.timeBudgetMs ?? 100_000);

  const { data: run } = await supabase
    .from('financial_sync_runs')
    .insert({ period_start: start, period_end: end, mode, trigger })
    .select('id')
    .single();
  const runId: string | null = run?.id ?? null;

  let counts: ReconcileCounts | null = null;
  const issues: ReconcileIssue[] = [];
  let processedUntil: string | null = null;
  let nextStart: string | null = null;

  try {
    for (let windowStart = start; windowStart <= end; windowStart = addDays(windowStart, windowDays)) {
      if (Date.now() > deadline) {
        nextStart = windowStart;
        break;
      }
      const windowEnd = addDays(windowStart, windowDays - 1) < end ? addDays(windowStart, windowDays - 1) : end;
      const history = await fetchHistory(`${windowStart} 00:00:00`, `${windowEnd} 23:59:59`);
      const sales = await loadSales(supabase, windowStart, windowEnd);
      const plan = planFinancialReconcile(history, sales);
      if (mode === 'apply') await applyUpdates(supabase, plan.updates as { id: string; patch: Record<string, unknown> }[]);
      counts = counts ? sumCounts(counts, plan.counts) : plan.counts;
      if (issues.length < 200) issues.push(...plan.issues.slice(0, 200 - issues.length));
      processedUntil = windowEnd;
    }

    const finalCounts = counts ?? planFinancialReconcile([], []).counts;
    if (runId) {
      await supabase
        .from('financial_sync_runs')
        .update({
          status: 'ok',
          finished_at: new Date().toISOString(),
          counts: { ...finalCounts, processed_until: processedUntil, issues: issues.slice(0, 50) },
          next_start: nextStart,
        })
        .eq('id', runId);
    }
    return { run_id: runId, mode, period_start: start, period_end: end, processed_until: processedUntil, next_start: nextStart, counts: finalCounts, issues };
  } catch (err) {
    if (runId) {
      await supabase
        .from('financial_sync_runs')
        .update({
          status: 'error',
          finished_at: new Date().toISOString(),
          error: String(err),
          counts: counts ? { ...counts, processed_until: processedUntil } : null,
          next_start: processedUntil ? addDays(processedUntil, 1) : start,
        })
        .eq('id', runId);
    }
    throw err;
  }
}
