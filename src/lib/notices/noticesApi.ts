/**
 * Leituras da Central de Avisos (só administrador: `sales`, `financial_sync_runs` e
 * `financial_reconcile_attempts` têm RLS `admin_read`). Nada é gravado.
 *
 * - `fetchNotices`: monta os avisos a partir dos dados atuais (uma consulta por tipo de aviso).
 * - `fetchNoticeSignature`: duas leituras de 1 linha (índices em started_at/created_at) que mudam a
 *   cada sincronização ou conciliação — os avisos só são relidos quando a assinatura muda.
 */
import { supabase } from '../supabaseClient';
import { MISSING_COST_NOTE } from '../finance/calc';
import { buildMissingCostNotice, sortNotices, type MissingCostRow, type Notice } from './notices';

const PAGE = 1000;

/** Candidatas no banco; o critério final é o do módulo financeiro (`buildMissingCostNotice`). */
const MISSING_COST_FILTER = `financial_note.eq."${MISSING_COST_NOTE}",and(financial_status.eq.ok,cost.eq.0,amount.gt.0,product_type.ilike."*PRODUTO APPLE*")`;

async function fetchMissingCostRows(): Promise<MissingCostRow[]> {
  const rows: MissingCostRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('sales')
      .select('id, mp_order_id, sold_at, sold_date, amount, cost, profit, financial_status, financial_note, product_type, item_status, products(name)')
      .eq('item_status', 'active')
      .or(MISSING_COST_FILTER)
      .order('sold_at', { ascending: false })
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as (Omit<MissingCostRow, 'product_name'> & { products: { name: string | null } | null })[];
    rows.push(...page.map(({ products, ...r }) => ({ ...r, product_name: products?.name ?? null })));
    if (page.length < PAGE) return rows;
  }
}

export async function fetchNotices(): Promise<Notice[]> {
  const missingCost = buildMissingCostNotice(await fetchMissingCostRows());
  return sortNotices(missingCost ? [missingCost] : []);
}

export async function fetchNoticeSignature(): Promise<string> {
  const [run, attempt] = await Promise.all([
    supabase.from('financial_sync_runs').select('id, status, finished_at').order('started_at', { ascending: false }).limit(1),
    supabase.from('financial_reconcile_attempts').select('id').order('created_at', { ascending: false }).limit(1),
  ]);
  if (run.error) throw new Error(run.error.message);
  if (attempt.error) throw new Error(attempt.error.message);
  return JSON.stringify([run.data?.[0] ?? null, (attempt.data as { id: string }[] | null)?.[0]?.id ?? null]);
}

/** Evento disparado depois de uma conciliação manual: a central relê na hora. */
export const FINANCIAL_UPDATED_EVENT = 'upclass:financial-updated';

export function notifyFinancialUpdated() {
  window.dispatchEvent(new Event(FINANCIAL_UPDATED_EVENT));
}
