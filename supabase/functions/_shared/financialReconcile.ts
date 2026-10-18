/**
 * Conciliação financeira dos itens vendidos com o histórico de vendas do MercadoPhone
 * (HistoricoVendaApiController). Módulo puro (sem Deno) — usado pelas functions, pelo script de
 * prévia e pelos testes.
 *
 * Contrato validado (jul–out/2026): `valorTotal` e `valorCusto` são totais da LINHA;
 * `lucro = valorTotal − valorCusto`; `valorCliente` é o bruto pago pelo cliente (= `sales.amount`).
 *
 * Regras de segurança:
 * - Só altera linhas de pedidos presentes no histórico consultado. Pedido ausente vira `not_found`,
 *   nunca é removido nem cancelado por falta de resposta.
 * - Uma linha só é marcada `removed` quando o pedido está no histórico e o produto aparece nele
 *   menos vezes do que em `sales` (duplicata criada por edição do pedido ou produto trocado).
 * - Valores só são atribuídos quando a correspondência é única; senão a linha fica `ambiguous`.
 * - Nada é apagado e o vendedor da linha não é alterado aqui (ver itemSellers.ts).
 */

export interface HistoricoFinanceItem {
  vendaId: number | string;
  produtoId: number | string;
  quantidade: number | string | null;
  valorTotal: number | string | null;
  valorCliente?: number | string | null;
  valorCusto: number | string | null;
  desconto?: number | string | null;
  lucro?: number | string | null;
  statusVenda?: string | null;
  tipoProdutoDescricao?: string | null;
  clienteNome?: string | null;
}

export type ItemStatus = 'active' | 'cancelled' | 'removed';
export type FinancialStatus = 'pending' | 'ok' | 'mismatch' | 'ambiguous' | 'not_found';

export interface SaleFinanceRow {
  id: string;
  external_id: string | null;
  quantity: number;
  amount: number | string;
  created_at: string;
  item_status?: ItemStatus | null;
  status_reason?: string | null;
  revenue?: number | string | null;
  customer_paid?: number | string | null;
  discount?: number | string | null;
  cost?: number | string | null;
  profit_reported?: number | string | null;
  profit?: number | string | null;
  product_type?: string | null;
  customer_name?: string | null;
  financial_status?: FinancialStatus | null;
  financial_note?: string | null;
}

export interface SaleFinancePatch {
  item_status?: ItemStatus;
  status_reason?: string | null;
  revenue?: number | null;
  customer_paid?: number | null;
  discount?: number | null;
  cost?: number | null;
  profit_reported?: number | null;
  profit?: number | null;
  product_type?: string | null;
  customer_name?: string | null;
  financial_status?: FinancialStatus;
  financial_note?: string | null;
}

export interface ReconcileIssue {
  orderId: string;
  kind: 'not_found' | 'ambiguous' | 'mismatch' | 'history_without_row' | 'removed' | 'cancelled' | 'missing_cost';
  detail: string;
}

export interface ReconcileCounts {
  orders_in_history: number;
  orders_in_sales: number;
  rows_checked: number;
  rows_ok: number;
  rows_mismatch: number;
  rows_ambiguous: number;
  rows_not_found: number;
  rows_pending_cost: number;
  rows_cancelled: number;
  rows_removed: number;
  rows_zero_cost: number;
  history_items_without_row: number;
  history_orders_without_rows: number;
  rows_to_update: number;
}

export interface ReconcilePlan {
  updates: { id: string; externalId: string | null; patch: SaleFinancePatch }[];
  counts: ReconcileCounts;
  issues: ReconcileIssue[];
}

const REMOVED_REASON = 'Item ausente na versão atual do pedido no MercadoPhone';
const CANCELLED_REASON = 'Venda cancelada no MercadoPhone';

export function toMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function sameMoney(a: unknown, b: unknown): boolean {
  const x = toMoney(a);
  const y = toMoney(b);
  if (x === null || y === null) return x === y;
  return Math.abs(x - y) < 0.005;
}

export function isCancelledStatus(status: string | null | undefined): boolean {
  return /cancel|estorn/i.test(status ?? '');
}

function parseRef(externalId: string | null): { orderId: string; productId: string } | null {
  const match = /^(\d+)-(\d+)-\d+$/.exec(externalId ?? '');
  return match ? { orderId: match[1], productId: match[2] } : null;
}

/** Valores financeiros normalizados de uma linha do histórico. */
export function financialFieldsFromHistory(item: HistoricoFinanceItem): Required<
  Pick<
    SaleFinancePatch,
    | 'revenue'
    | 'customer_paid'
    | 'discount'
    | 'cost'
    | 'profit_reported'
    | 'profit'
    | 'product_type'
    | 'customer_name'
    | 'financial_status'
    | 'financial_note'
  >
> {
  const revenue = toMoney(item.valorTotal);
  const cost = toMoney(item.valorCusto);
  const profitReported = toMoney(item.lucro);
  // Subtrai antes de arredondar: a origem guarda receitas com várias casas (ex.: 46.913274336284).
  const profit = revenue !== null && cost !== null ? toMoney(Number(item.valorTotal) - Number(item.valorCusto)) : null;

  let status: FinancialStatus = 'ok';
  let note: string | null = null;
  if (revenue === null || cost === null) {
    status = 'pending';
    note = cost === null ? 'Custo não informado pela origem' : 'Receita não informada pela origem';
  } else if (profitReported !== null && profit !== null && Math.abs(profit - profitReported) > 0.011) {
    status = 'mismatch';
    note = `Lucro informado ${profitReported.toFixed(2)} ≠ receita − custo ${profit.toFixed(2)}`;
  } else if (cost === 0) {
    note = 'Custo zero informado pela origem';
  }

  return {
    revenue,
    customer_paid: toMoney(item.valorCliente),
    discount: toMoney(item.desconto),
    cost,
    profit_reported: profitReported,
    profit,
    product_type: item.tipoProdutoDescricao?.trim() || null,
    customer_name: item.clienteNome?.trim() || null,
    financial_status: status,
    financial_note: note,
  };
}

function signature(item: HistoricoFinanceItem): string {
  return [
    Number(item.quantidade ?? 0),
    toMoney(item.valorTotal),
    toMoney(item.valorCliente),
    toMoney(item.valorCusto),
    toMoney(item.lucro),
    item.clienteNome ?? '',
  ].join('|');
}

/** Só os campos que mudaram — repetir a conciliação sem mudanças na origem não gera escrita. */
function diff(row: SaleFinanceRow, target: SaleFinancePatch): SaleFinancePatch {
  const patch: SaleFinancePatch = {};
  const record = row as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(target) as [keyof SaleFinancePatch, unknown][]) {
    const current = record[key];
    const isMoney = typeof value === 'number' || (value === null && typeof current === 'number');
    const equal = isMoney ? sameMoney(current, value) : (current ?? null) === (value ?? null);
    if (!equal) (patch as Record<string, unknown>)[key] = value;
  }
  return patch;
}

function emptyCounts(): ReconcileCounts {
  return {
    orders_in_history: 0,
    orders_in_sales: 0,
    rows_checked: 0,
    rows_ok: 0,
    rows_mismatch: 0,
    rows_ambiguous: 0,
    rows_not_found: 0,
    rows_pending_cost: 0,
    rows_cancelled: 0,
    rows_removed: 0,
    rows_zero_cost: 0,
    history_items_without_row: 0,
    history_orders_without_rows: 0,
    rows_to_update: 0,
  };
}

/**
 * Planeja a conciliação de `sales` com o histórico de um período. `sales` deve conter todas as
 * linhas (qualquer `item_status`) dos pedidos do mesmo período consultado no histórico.
 */
export function planFinancialReconcile(history: HistoricoFinanceItem[], sales: SaleFinanceRow[]): ReconcilePlan {
  const counts = emptyCounts();
  const issues: ReconcileIssue[] = [];
  const targets = new Map<string, SaleFinancePatch>();

  const historyByOrder = new Map<string, HistoricoFinanceItem[]>();
  for (const item of history) {
    const key = String(item.vendaId);
    const list = historyByOrder.get(key) ?? [];
    list.push(item);
    historyByOrder.set(key, list);
  }

  const salesByOrder = new Map<string, SaleFinanceRow[]>();
  for (const row of sales) {
    const ref = parseRef(row.external_id);
    if (!ref) continue;
    const list = salesByOrder.get(ref.orderId) ?? [];
    list.push(row);
    salesByOrder.set(ref.orderId, list);
  }

  counts.orders_in_history = historyByOrder.size;
  counts.orders_in_sales = salesByOrder.size;
  for (const [orderId, items] of historyByOrder) {
    // Venda cancelada que nunca chegou ao painel não é lacuna.
    if (!salesByOrder.has(orderId) && !items.every((item) => isCancelledStatus(item.statusVenda))) {
      counts.history_orders_without_rows += 1;
    }
  }

  for (const [orderId, orderRows] of salesByOrder) {
    counts.rows_checked += orderRows.length;
    const orderHistory = historyByOrder.get(orderId);

    if (!orderHistory || orderHistory.length === 0) {
      // Resposta ausente não autoriza cancelar nem remover: só sinaliza.
      for (const row of orderRows) {
        if ((row.item_status ?? 'active') !== 'active') continue;
        targets.set(row.id, { financial_status: 'not_found', financial_note: 'Pedido não encontrado no histórico do MercadoPhone no período' });
      }
      issues.push({ orderId, kind: 'not_found', detail: `${orderRows.length} linha(s) sem pedido correspondente no histórico` });
      continue;
    }

    const cancelled = orderHistory.every((item) => isCancelledStatus(item.statusVenda));
    const historyByProduct = new Map<string, HistoricoFinanceItem[]>();
    for (const item of orderHistory) {
      const key = String(item.produtoId);
      const list = historyByProduct.get(key) ?? [];
      list.push(item);
      historyByProduct.set(key, list);
    }
    const rowsByProduct = new Map<string, SaleFinanceRow[]>();
    for (const row of orderRows) {
      const key = parseRef(row.external_id)!.productId;
      const list = rowsByProduct.get(key) ?? [];
      list.push(row);
      rowsByProduct.set(key, list);
    }

    for (const [productId, items] of historyByProduct) {
      const rowCount = rowsByProduct.get(productId)?.length ?? 0;
      if (!cancelled && items.length > rowCount) {
        counts.history_items_without_row += items.length - rowCount;
        issues.push({ orderId, kind: 'history_without_row', detail: `produto ${productId}: ${items.length} no histórico, ${rowCount} em sales` });
      }
    }

    for (const [productId, rows] of rowsByProduct) {
      const items = [...(historyByProduct.get(productId) ?? [])];

      // Mantém primeiro as linhas já ativas (o webhook marca a versão atual do pedido), depois as
      // que casam em quantidade e valor pago e, por fim, as mais recentes (a edição do pedido
      // regrava os itens com novo índice).
      const isRemoved = (row: SaleFinanceRow) => row.item_status === 'removed';
      const matchesSomeItem = (row: SaleFinanceRow) =>
        items.some((item) => Number(item.quantidade) === row.quantity && sameMoney(item.valorCliente, row.amount));
      const ordered = [...rows].sort(
        (a, b) =>
          Number(isRemoved(a)) - Number(isRemoved(b)) ||
          Number(matchesSomeItem(b)) - Number(matchesSomeItem(a)) ||
          b.created_at.localeCompare(a.created_at) ||
          (b.external_id ?? '').localeCompare(a.external_id ?? '')
      );
      const kept = ordered.slice(0, items.length);
      const stale = ordered.slice(items.length);

      for (const row of stale) {
        targets.set(row.id, { item_status: 'removed', status_reason: REMOVED_REASON });
        if ((row.item_status ?? 'active') !== 'removed') {
          issues.push({ orderId, kind: 'removed', detail: `${row.external_id} (produto ${productId}) não está na versão atual do pedido` });
        }
      }

      const remaining = [...items];
      for (const row of kept) {
        const candidates = remaining.filter(
          (item) => Number(item.quantidade) === row.quantity && sameMoney(item.valorCliente, row.amount)
        );
        const pool = candidates.length > 0 ? candidates : remaining;
        const distinct = new Set(pool.map(signature));
        const statusPatch: SaleFinancePatch = cancelled
          ? { item_status: 'cancelled', status_reason: CANCELLED_REASON }
          : { item_status: 'active', status_reason: null };

        if (distinct.size !== 1) {
          targets.set(row.id, {
            ...statusPatch,
            financial_status: 'ambiguous',
            financial_note: 'Mais de um item do histórico corresponde a esta linha',
          });
          issues.push({ orderId, kind: 'ambiguous', detail: `${row.external_id}: ${pool.length} candidatos com valores diferentes` });
          continue;
        }
        const chosen = pool[0];
        remaining.splice(remaining.indexOf(chosen), 1);
        targets.set(row.id, { ...statusPatch, ...financialFieldsFromHistory(chosen) });
      }
    }
  }

  const updates: ReconcilePlan['updates'] = [];
  for (const row of sales) {
    const target = targets.get(row.id);
    if (!target) continue;
    const finalStatus = target.item_status ?? row.item_status ?? 'active';
    const finalFinancial = target.financial_status ?? row.financial_status ?? 'pending';
    if (finalStatus === 'removed') counts.rows_removed += 1;
    else if (finalStatus === 'cancelled') counts.rows_cancelled += 1;
    else if (finalFinancial === 'ok') counts.rows_ok += 1;
    else if (finalFinancial === 'mismatch') counts.rows_mismatch += 1;
    else if (finalFinancial === 'ambiguous') counts.rows_ambiguous += 1;
    else if (finalFinancial === 'not_found') counts.rows_not_found += 1;
    else counts.rows_pending_cost += 1;
    if (finalStatus === 'active' && finalFinancial === 'ok' && sameMoney(target.cost ?? row.cost, 0)) counts.rows_zero_cost += 1;
    if (finalStatus === 'active' && finalFinancial === 'mismatch') {
      issues.push({ orderId: parseRef(row.external_id)?.orderId ?? '?', kind: 'mismatch', detail: target.financial_note ?? '' });
    }

    const patch = diff(row, target);
    if (Object.keys(patch).length > 0) updates.push({ id: row.id, externalId: row.external_id, patch });
  }
  counts.rows_to_update = updates.length;
  return { updates, counts, issues };
}
