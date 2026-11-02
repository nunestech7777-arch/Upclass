/**
 * Ranking de Conversão do Dashboard: "vendas por atendimento" = pedidos ÷ conversas atendidas × 100.
 *
 * - Atendimento (Kommo) = conversa distinta em que o vendedor enviou ao menos uma mensagem pelo Kommo
 *   dentro do período (autor da mensagem, mesma regra do Meu Supervisor). Conversa com dois atendentes
 *   conta para os dois. Salesbot, respostas prontas, envio pelo aparelho e responsável do lead não contam.
 * - Venda (MercadoPhone) = pedido distinto (`mp_order_id`) com ao menos um item ativo do vendedor que
 *   não seja brinde, pela data da venda (`sold_date`). Pedido com itens de dois vendedores conta para os dois.
 * - NÃO é taxa real de conversão: a venda não traz identificador do cliente que a ligue à conversa,
 *   e vendas sem conversa no Kommo (balcão) também contam — o índice pode passar de 100%.
 */
import { financeCategory, isActive, type FinanceSale, type FinanceSeller } from './calc.ts';

/** Mínimo de atendimentos no período para entrar na classificação. */
export const MIN_ATTENDANCES = 30;
/** A loja lança vendas até alguns dias depois, com data retroativa: período recente fica incompleto. */
export const LATE_ENTRY_DAYS = 6;

export type ConversionStatus = 'ranked' | 'insufficient' | 'no_attendance' | 'no_kommo_link';

export interface ConversionRow {
  seller: FinanceSeller;
  /** Conversas atendidas no Kommo; null = sem vínculo com o Kommo (não é zero). */
  attendances: number | null;
  orders: number;
  /** orders ÷ attendances × 100; null sem atendimentos. */
  index: number | null;
  status: ConversionStatus;
  /** Posição na classificação; null fora dela. */
  position: number | null;
}

/** Pedidos distintos por vendedor do item (itens ativos, sem brindes). */
export function ordersBySeller(sales: FinanceSale[], names: Map<string, string>): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const s of sales) {
    if (!isActive(s)) continue;
    if (financeCategory(names.get(s.product_id), Number(s.amount) || 0) === 'Brindes') continue;
    const set = sets.get(s.seller_id) ?? new Set<string>();
    set.add(s.mp_order_id ?? `row:${s.id}`);
    sets.set(s.seller_id, set);
  }
  return new Map([...sets].map(([id, set]) => [id, set.size]));
}

const STATUS_ORDER: Record<ConversionStatus, number> = { ranked: 0, insufficient: 1, no_attendance: 2, no_kommo_link: 3 };

/**
 * Linhas do ranking: vendedores ativos e visíveis no ranking. Classificados primeiro, por índice;
 * desempate por mais pedidos, depois mais atendimentos, depois nome. Volume absoluto não vence índice.
 */
export function buildConversionRanking(
  sales: FinanceSale[],
  names: Map<string, string>,
  sellers: FinanceSeller[],
  attendedByKommoUser: Map<string, number>,
  minAttendances = MIN_ATTENDANCES
): ConversionRow[] {
  const orders = ordersBySeller(sales, names);
  const rows = sellers
    .filter((s) => s.active && s.show_in_ranking)
    .map((seller): ConversionRow => {
      const sellerOrders = orders.get(seller.id) ?? 0;
      if (!seller.kommo_user_id) return { seller, attendances: null, orders: sellerOrders, index: null, status: 'no_kommo_link', position: null };
      const attendances = attendedByKommoUser.get(String(seller.kommo_user_id)) ?? 0;
      if (attendances === 0) return { seller, attendances, orders: sellerOrders, index: null, status: 'no_attendance', position: null };
      const index = (sellerOrders / attendances) * 100;
      return { seller, attendances, orders: sellerOrders, index, status: attendances >= minAttendances ? 'ranked' : 'insufficient', position: null };
    });
  rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (b.index ?? -1) - (a.index ?? -1) ||
      b.orders - a.orders ||
      (b.attendances ?? -1) - (a.attendances ?? -1) ||
      a.seller.name.localeCompare(b.seller.name, 'pt-BR')
  );
  let position = 0;
  for (const r of rows) if (r.status === 'ranked') r.position = ++position;
  return rows;
}

/**
 * Ordem "Por Conversão" para outra lista de vendedores (cards da tela Vendedores): a mesma ordem e as
 * mesmas posições do ranking. Quem não está nele (inativo, oculto) vai para o fim, na ordem de `fallback`.
 */
export function sortByConversion<T extends { seller: { id: string } }>(
  items: T[],
  rows: ConversionRow[],
  fallback: (a: T, b: T) => number
): { item: T; row: ConversionRow | undefined; position: number | null }[] {
  const order = new Map(rows.map((r, i) => [r.seller.id, i]));
  const byId = new Map(rows.map((r) => [r.seller.id, r]));
  return [...items]
    .sort((a, b) => (order.get(a.seller.id) ?? Infinity) - (order.get(b.seller.id) ?? Infinity) || fallback(a, b))
    .map((item) => {
      const row = byId.get(item.seller.id);
      return { item, row, position: row?.position ?? null };
    });
}

/** Líder em conversão: o 1º classificado (o mesmo que o ranking mostra em 1º); null sem classificados. */
export function conversionLeader(rows: ConversionRow[] | null): ConversionRow | null {
  return rows?.find((r) => r.status === 'ranked') ?? null;
}

const SHORT_LABEL: Record<Exclude<ConversionStatus, 'ranked' | 'insufficient'>, string> = {
  no_attendance: 'Sem atendimentos',
  no_kommo_link: 'Sem vínculo Kommo',
};

/**
 * Texto da taxa de um vendedor em qualquer tela (cards, relatório): o mesmo número do ranking.
 * Ausência de dado nunca vira "0%".
 */
export function conversionText(row: ConversionRow | undefined, formatPct: (v: number) => string): string {
  if (!row) return 'Sem dados';
  if (row.index == null) return SHORT_LABEL[row.status as keyof typeof SHORT_LABEL] ?? 'Sem dados';
  return formatPct(row.index);
}

/**
 * Chave do cache de atendimentos: conta logada + período + se ele inclui hoje. A marca live/past troca
 * a chave na virada do dia (o dia que fechou é contado de novo, completo).
 */
export function attendanceCacheKey(scope: string, range: { from: string; to: string }, today: string): string {
  return `${scope}|${range.from}|${range.to}|${range.to >= today ? 'live' : 'past'}`;
}

/** Erro do PostgREST quando a função ainda não existe no banco (migração não aplicada). */
export function isMissingFunctionError(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}

/** O período alcança os dias cujas vendas ainda podem ser lançadas (data retroativa). */
export function salesStillArriving(rangeTo: string, today: string, lateDays = LATE_ENTRY_DAYS): boolean {
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - lateDays);
  return rangeTo >= limit.toISOString().slice(0, 10);
}
