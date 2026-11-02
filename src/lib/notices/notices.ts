/**
 * Central de Avisos — regras puras (sem Supabase). Cada aviso é DERIVADO dos dados atuais do banco a
 * cada leitura: nada é gravado, então não há registro duplicado e a pendência some na próxima leitura
 * depois que a conciliação grava o custo corrigido. Atenção: a rotina automática só reconfere linhas
 * abertas e dias recentes — custo 0 (status ok) de venda antiga só é relido pela conciliação manual.
 *
 * Duas origens:
 * - globais (noticesApi.ts): consultadas no banco, valem em qualquer página — `missing_cost`;
 * - da página (PageNotices.tsx): a página aberta publica avisos do período que já carregou, sem
 *   consulta nova — `partial_result` e `empty_days` (Resultado financeiro e Resultados diários).
 * Novos tipos (falha de sincronização, divergências, integrações) entram como novo `kind`.
 */
import {
  PENDING_REASONS,
  hasZeroSourceCost,
  isActive,
  isReconciled,
  pendingReason,
  type Coverage,
  type FinanceSale,
  type PendingReason,
} from '../finance/calc.ts';

export type NoticeSeverity = 'critical' | 'warning' | 'info';
export type NoticeKind = Notice['kind'];

/** Situação do custo na origem: vazio (não informado) ou zero informado num produto que tem custo. */
export type CostSituation = 'cost_missing' | 'cost_zero';

export interface MissingCostItem {
  saleId: string;
  orderId: string | null;
  productName: string;
  soldAt: string;
  soldDate: string;
  amount: number;
  situation: CostSituation;
}

interface NoticeBase {
  /** Estável entre leituras (um aviso por tipo e período): a lista nunca repete o mesmo aviso. */
  id: string;
  severity: NoticeSeverity;
  title: string;
  /** Pendências que este aviso soma no contador do sino (sem contar o que outro aviso já conta). */
  count: number;
  /** Data mais recente do aviso (ordenação). */
  latestAt: string;
}

export interface MissingCostNotice extends NoticeBase {
  kind: 'missing_cost';
  orders: string[];
  items: MissingCostItem[];
}

export interface PendingItem {
  saleId: string;
  orderId: string | null;
  productName: string;
  soldAt: string;
  soldDate: string;
  amount: number;
  reason: PendingReason;
}

/** "Resultado parcial" do período aberto (antes era o aviso fixo na tela). */
export interface PartialResultNotice extends NoticeBase {
  kind: 'partial_result';
  /** Período por extenso ("outubro de 2026"). */
  scope: string;
  total: number;
  reconciled: number;
  amountPending: number;
  reasons: { reason: PendingReason; count: number }[];
  items: PendingItem[];
  lastSyncAt: string | null;
}

/** Dias completos sem nenhuma venda no período aberto (loja fechada ou importação atrasada). */
export interface EmptyDaysNotice extends NoticeBase {
  kind: 'empty_days';
  scope: string;
  days: string[];
  lastSaleAt: string | null;
}

export type Notice = MissingCostNotice | PartialResultNotice | EmptyDaysNotice;

/** Motivo da pendência no texto ("9 sem custo no Mercado Phone"). */
export const PENDING_REASON_PHRASE: Record<PendingReason, string> = {
  missing_cost: 'sem custo no Mercado Phone',
  missing_revenue: 'sem receita no Mercado Phone',
  sync_failure: 'com falha de sincronização',
  awaiting_source: 'aguardando o Mercado Phone',
  not_found: 'sem pedido no histórico',
  ambiguous: 'ambíguos',
  mismatch: 'com lucro divergente',
  not_swept: 'antes do início da conciliação',
};

/** Motivos que pedem ação (os demais se resolvem sozinhos ou já têm aviso próprio). */
const ACTION_REASONS = new Set<PendingReason>(['sync_failure', 'not_found', 'ambiguous', 'mismatch', 'missing_revenue']);

const SEVERITY_RANK: Record<NoticeSeverity, number> = { critical: 0, warning: 1, info: 2 };

export const SEVERITY_LABEL: Record<NoticeSeverity, string> = { critical: 'Crítico', warning: 'Atenção', info: 'Informativo' };

export const COST_SITUATION_LABEL: Record<CostSituation, string> = {
  cost_missing: 'Não conciliado · custo vazio',
  cost_zero: 'Não conciliado · custo 0',
};

/** Gravidade primeiro; dentro da mesma gravidade, o mais recente antes. */
export function sortNotices(notices: Notice[]): Notice[] {
  return [...notices].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.latestAt.localeCompare(a.latestAt));
}

export function noticeCount(notices: Notice[]): number {
  return notices.reduce((sum, n) => sum + n.count, 0);
}

export type MissingCostRow = Pick<
  FinanceSale,
  'id' | 'mp_order_id' | 'sold_at' | 'sold_date' | 'amount' | 'cost' | 'profit' | 'financial_status' | 'financial_note' | 'product_type' | 'item_status'
> & { product_name: string | null };

/**
 * Aviso "sem custo no Mercado Phone" a partir das linhas lidas. Usa exatamente o critério do módulo
 * financeiro (`pendingReason` = missing_cost), então o aviso e o banner do Resultado Financeiro
 * nunca divergem. Serviços e brindes com custo 0 não entram (custo zero legítimo).
 */
export function buildMissingCostNotice(rows: MissingCostRow[]): MissingCostNotice | null {
  const seen = new Set<string>();
  const items: MissingCostItem[] = [];
  for (const r of rows) {
    // Mesmo critério do banner: só linha ativa, não conciliada, com motivo "sem custo".
    if (seen.has(r.id) || !isActive(r) || isReconciled(r) || pendingReason(r) !== 'missing_cost') continue;
    const zero = hasZeroSourceCost(r);
    seen.add(r.id);
    items.push({
      saleId: r.id,
      orderId: r.mp_order_id,
      productName: r.product_name?.trim() || 'Produto não identificado',
      soldAt: r.sold_at,
      soldDate: r.sold_date,
      amount: Number(r.amount) || 0,
      situation: zero ? 'cost_zero' : 'cost_missing',
    });
  }
  if (items.length === 0) return null;
  items.sort((a, b) => b.soldAt.localeCompare(a.soldAt) || a.saleId.localeCompare(b.saleId));
  return {
    id: 'missing_cost',
    kind: 'missing_cost',
    severity: 'warning',
    title: 'Itens sem custo no Mercado Phone',
    count: items.length,
    latestAt: items[0].soldAt,
    orders: [...new Set(items.map((i) => i.orderId).filter((o): o is string => !!o))],
    items,
  };
}

type PendingSale = Pick<
  FinanceSale,
  'id' | 'mp_order_id' | 'product_id' | 'sold_at' | 'sold_date' | 'amount' | 'cost' | 'profit' | 'financial_status' | 'financial_note' | 'product_type' | 'item_status' | 'created_at' | 'last_attempt'
>;

/** Itens ativos não conciliados do período, com o motivo — mesmo critério da cobertura (calc.ts). */
export function pendingItemsOf(sales: PendingSale[], productNames: Map<string, string>, now = Date.now()): PendingItem[] {
  const items: PendingItem[] = [];
  for (const s of sales) {
    if (!isActive(s) || isReconciled(s)) continue;
    items.push({
      saleId: s.id,
      orderId: s.mp_order_id,
      productName: productNames.get(s.product_id)?.trim() || 'Produto não identificado',
      soldAt: s.sold_at,
      soldDate: s.sold_date,
      amount: Number(s.amount) || 0,
      reason: pendingReason(s, now),
    });
  }
  return items.sort((a, b) => b.soldAt.localeCompare(a.soldAt) || a.saleId.localeCompare(b.saleId));
}

/**
 * Aviso de resultado parcial do período. No contador só entram os itens que nenhum aviso global já
 * conta (os "sem custo" estão no aviso próprio), para o sino não contar o mesmo item duas vezes.
 */
export function buildPartialResultNotice(input: {
  key: string;
  scope: string;
  coverage: Coverage;
  items: PendingItem[];
  lastSyncAt?: string | null;
  at: string;
}): PartialResultNotice | null {
  const { coverage: c } = input;
  if (c.items === 0 || c.items === c.reconciled) return null;
  // Motivos contados nos próprios itens (lista e contagem sempre iguais na tela de detalhes).
  const tally = new Map<PendingReason, number>();
  for (const it of input.items) tally.set(it.reason, (tally.get(it.reason) ?? 0) + 1);
  const reasons = PENDING_REASONS.filter((r) => tally.has(r)).map((reason) => ({ reason, count: tally.get(reason)! }));
  const needsAction = reasons.some((r) => ACTION_REASONS.has(r.reason));
  return {
    id: `partial_result:${input.key}`,
    kind: 'partial_result',
    severity: needsAction ? 'warning' : 'info',
    title: `Resultado parcial · ${input.scope}`,
    count: reasons.filter((r) => r.reason !== 'missing_cost').reduce((sum, r) => sum + r.count, 0),
    latestAt: input.at,
    scope: input.scope,
    total: c.items,
    reconciled: c.reconciled,
    amountPending: c.amountPending,
    reasons,
    items: input.items,
    lastSyncAt: input.lastSyncAt ?? null,
  };
}

export function buildEmptyDaysNotice(input: { key: string; scope: string; days: string[]; lastSaleAt: string | null }): EmptyDaysNotice | null {
  if (input.days.length === 0) return null;
  const days = [...input.days].sort();
  return {
    id: `empty_days:${input.key}`,
    kind: 'empty_days',
    severity: 'info',
    title: `Dias sem vendas · ${input.scope}`,
    count: days.length,
    latestAt: days[days.length - 1],
    scope: input.scope,
    days,
    lastSaleAt: input.lastSaleAt,
  };
}
