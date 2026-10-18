/**
 * Projeção de APARELHOS (iPhones) por vendedor — regras da página Forecast, fora dos componentes.
 *
 * Mesma regra de tempo do módulo financeiro (calc.ts `buildContext`): ritmo e projeção usam dias
 * COMPLETOS até ontem; hoje entra no vendido, mas não no ritmo. Assim a mesma métrica não tem dois
 * valores diferentes nas duas telas.
 *
 * - Aparelho = produto cujo nome começa com "iPhone" (productClassifier). Cada item pertence ao
 *   vendedor do ITEM (`sales.seller_id`), nunca ao vendedor principal do pedido.
 * - Linhas canceladas/removidas (`item_status`) não contam.
 * - Acessório só conta com valor pago > 0 (brinde não conta); brinde nunca é aparelho.
 * - Projeção = vendidos até ontem ÷ dias completos × dias do mês, nunca abaixo do já vendido.
 *   Mês encerrado: resultado realizado. Mês futuro / 1º dia do mês: indisponível.
 * - Valores são guardados exatos; o arredondamento é só na exibição, e o total da equipe é o
 *   arredondamento da soma exata (não a soma de valores já arredondados).
 */
import { classifyProductCategory } from '../productClassifier.ts';
import type { MonthContext } from './calc.ts';

export interface UnitSale {
  seller_id: string;
  product_id: string;
  quantity: number;
  amount: number | string;
  sold_date: string;
  item_status?: 'active' | 'cancelled' | 'removed' | null;
}

export interface DeviceGoalLike {
  seller_id: string;
  device_target: number | null;
}

export interface UnitCount {
  sold: number;
  untilCutoff: number;
  today: number;
}

const empty = (): UnitCount => ({ sold: 0, untilCutoff: 0, today: 0 });

function addTo(count: UnitCount, sale: UnitSale, ctx: MonthContext) {
  count.sold += sale.quantity;
  if (ctx.cutoffDate && sale.sold_date <= ctx.cutoffDate) count.untilCutoff += sale.quantity;
  if (ctx.phase === 'current' && sale.sold_date === ctx.today) count.today += sale.quantity;
}

export function isCountedSale(sale: Pick<UnitSale, 'item_status'>): boolean {
  return (sale.item_status ?? 'active') === 'active';
}

export type UnitKind = 'devices' | 'accessories';

/** Textos e abreviação de cada categoria (um único componente atende as duas). */
export const UNIT_COPY: Record<UnitKind, {
  abbr: string;
  one: string;
  many: string;
  soldLabel: string;
  goalLabel: string;
  eyebrow: string;
  subtitle: string;
  sortSold: string;
  tab: string;
  soldHint: string;
}> = {
  devices: {
    abbr: 'ap',
    one: 'aparelho',
    many: 'aparelhos',
    soldLabel: 'Aparelhos vendidos',
    goalLabel: 'Meta de aparelhos',
    eyebrow: 'Metas individuais de iPhones',
    subtitle: 'Acompanhe o desempenho, as metas e a projeção de aparelhos vendidos até o final do mês.',
    sortSold: 'Mais aparelhos vendidos',
    tab: 'Aparelhos',
    soldHint: 'iPhones do mês',
  },
  accessories: {
    abbr: 'ac',
    one: 'acessório',
    many: 'acessórios',
    soldLabel: 'Acessórios vendidos',
    goalLabel: 'Meta de acessórios',
    eyebrow: 'Metas individuais de acessórios',
    subtitle: 'Acompanhe o desempenho, as metas e a projeção de acessórios vendidos até o final do mês.',
    sortSold: 'Mais acessórios vendidos',
    tab: 'Acessórios',
    soldHint: 'acessórios pagos do mês',
  },
};

/** Unidade conta na categoria? Aparelho = iPhone; acessório = demais com valor pago > 0 (brinde não conta). */
function matchesKind(sale: UnitSale, name: string | undefined, kind: UnitKind): boolean {
  const isDevice = classifyProductCategory(name) === 'Aparelhos';
  if (kind === 'devices') return isDevice;
  return !isDevice && (Number(sale.amount) || 0) > 0;
}

/**
 * Unidades vendidas por vendedor do ITEM numa categoria, sem canceladas/obsoletas e em unidades
 * reais. O vendedor vem de `sales.seller_id` (vendedor do item), nunca do vendedor do pedido.
 */
export function countUnitsBySeller(sales: UnitSale[], productNames: Map<string, string>, ctx: MonthContext, kind: UnitKind): Map<string, UnitCount> {
  const bySeller = new Map<string, UnitCount>();
  for (const s of sales) {
    if (!isCountedSale(s)) continue;
    if (!matchesKind(s, productNames.get(s.product_id), kind)) continue;
    const c = bySeller.get(s.seller_id) ?? empty();
    addTo(c, s, ctx);
    bySeller.set(s.seller_id, c);
  }
  return bySeller;
}

/** Aparelhos vendidos por vendedor (item a item). */
export function countDevicesBySeller(sales: UnitSale[], productNames: Map<string, string>, ctx: MonthContext): Map<string, UnitCount> {
  return countUnitsBySeller(sales, productNames, ctx, 'devices');
}

/** Unidades por categoria comercial (aparelhos; acessórios pagos), para o gráfico e a projeção por categoria. */
export function countByCategory(
  sales: UnitSale[],
  productNames: Map<string, string>,
  ctx: MonthContext
): { devices: UnitCount; accessories: UnitCount } {
  const devices = empty();
  const accessories = empty();
  for (const s of sales) {
    if (!isCountedSale(s)) continue;
    if (classifyProductCategory(productNames.get(s.product_id)) === 'Aparelhos') addTo(devices, s, ctx);
    else if ((Number(s.amount) || 0) > 0) addTo(accessories, s, ctx);
  }
  return { devices, accessories };
}

/** Projeção exata de unidades no fechamento do mês (null = indisponível). */
export function projectUnits(sold: number, untilCutoff: number, ctx: MonthContext): number | null {
  if (ctx.phase === 'future') return null;
  if (ctx.phase === 'past') return sold;
  if (ctx.elapsedDays <= 0) return null;
  return Math.max(sold, (untilCutoff / ctx.elapsedDays) * ctx.daysInMonth);
}

export interface SellerUnitRow {
  sellerId: string;
  sold: number;
  soldToday: number;
  /** Meta de aparelhos do mês; null = sem meta (também quando cadastrada como 0). */
  target: number | null;
  projection: number | null;
  /** máximo(meta − vendidos, 0); null sem meta. */
  remaining: number | null;
  goalReached: boolean;
  /** vendidos ÷ meta × 100 (pode passar de 100). */
  pct: number | null;
  /** faltam ÷ dias restantes (inclui hoje); null sem meta, mês encerrado/futuro ou meta batida. */
  neededPerDay: number | null;
}

export function buildSellerRow(sellerId: string, count: UnitCount | undefined, target: number | null, ctx: MonthContext): SellerUnitRow {
  const c = count ?? empty();
  const goal = target != null && target > 0 ? target : null;
  const remaining = goal != null ? Math.max(goal - c.sold, 0) : null;
  const goalReached = goal != null && c.sold >= goal;
  return {
    sellerId,
    sold: c.sold,
    soldToday: c.today,
    target: goal,
    projection: projectUnits(c.sold, c.untilCutoff, ctx),
    remaining,
    goalReached,
    pct: goal != null ? (c.sold / goal) * 100 : null,
    neededPerDay: goal != null && !goalReached && ctx.phase === 'current' && ctx.remainingDays > 0 ? remaining! / ctx.remainingDays : null,
  };
}

export interface TeamUnitSummary {
  sold: number;
  /** Soma das metas individuais; null se ninguém tem meta. */
  target: number | null;
  /** Soma EXATA das projeções individuais; null se nenhuma disponível. */
  projection: number | null;
  remaining: number | null;
  pct: number | null;
  sellersWithGoal: number;
}

/** Totais da equipe: soma de numeradores, nunca média de percentuais. Só vendedores com meta entram no saldo. */
export function summarizeTeam(rows: SellerUnitRow[]): TeamUnitSummary {
  const sold = rows.reduce((a, r) => a + r.sold, 0);
  const withGoal = rows.filter((r) => r.target != null);
  const target = withGoal.length > 0 ? withGoal.reduce((a, r) => a + r.target!, 0) : null;
  const projections = rows.map((r) => r.projection).filter((p): p is number => p != null);
  const soldWithGoal = withGoal.reduce((a, r) => a + r.sold, 0);
  return {
    sold,
    target,
    projection: projections.length > 0 ? projections.reduce((a, p) => a + p, 0) : null,
    // Meta geral = soma das metas individuais; falta = meta geral − vendido por quem tem meta.
    remaining: target != null ? Math.max(target - soldWithGoal, 0) : null,
    pct: target != null ? (soldWithGoal / target) * 100 : null,
    sellersWithGoal: withGoal.length,
  };
}

export type ForecastSortKey = 'sold' | 'projection' | 'pct' | 'remainingAsc' | 'remainingDesc';

export const FORECAST_SORT_LABELS: Record<ForecastSortKey, string> = {
  sold: UNIT_COPY.devices.sortSold,
  projection: 'Maior projeção',
  pct: 'Maior percentual da meta',
  remainingAsc: 'Menor quantidade faltante',
  remainingDesc: 'Maior quantidade faltante',
};

/** Rótulos de ordenação da categoria ("Mais aparelhos vendidos" ↔ "Mais acessórios vendidos"). */
export function forecastSortLabels(kind: UnitKind): Record<ForecastSortKey, string> {
  return { ...FORECAST_SORT_LABELS, sold: UNIT_COPY[kind].sortSold };
}

/** Ordena; valores indisponíveis (sem meta/projeção) ficam no fim. Desempate: mais vendidos, depois nome. */
export function sortUnitRows<T extends SellerUnitRow & { name: string }>(rows: T[], key: ForecastSortKey): T[] {
  const value = (r: T): number | null =>
    key === 'sold' ? r.sold : key === 'projection' ? r.projection : key === 'pct' ? r.pct : r.remaining;
  const ascending = key === 'remainingAsc';
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return b.sold - a.sold || a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    const diff = ascending ? va - vb : vb - va;
    return diff || b.sold - a.sold || a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Projeção por categoria / gráfico (mesma regra de tempo)
// ---------------------------------------------------------------------------

export interface CategoryForecast {
  title: string;
  sold: number;
  projection: number | null;
  target: number;
  /** projeção ÷ meta × 100 — estimativa por ritmo linear, não probabilidade. */
  attainment: number | null;
  dailyActual: number | null;
  dailyNeeded: number | null;
  chartData: { name: string; produtos: number; meta: number }[];
}

const CHART_POINTS = [0, 0.25, 0.5, 0.75, 1];
const CHART_LABELS = ['Atual', 'Semana 1', 'Semana 2', 'Semana 3', 'Fim do Mês'];

export function buildCategoryForecast(title: string, count: UnitCount, target: number, ctx: MonthContext): CategoryForecast {
  const projection = projectUnits(count.sold, count.untilCutoff, ctx);
  const progress = ctx.phase === 'past' ? 1 : ctx.daysInMonth > 0 ? ctx.elapsedDays / ctx.daysInMonth : 0;
  const end = projection ?? count.sold;
  return {
    title,
    sold: count.sold,
    projection,
    target,
    attainment: projection != null && target > 0 ? (projection / target) * 100 : null,
    dailyActual: ctx.phase === 'current' && ctx.elapsedDays > 0 ? count.untilCutoff / ctx.elapsedDays : null,
    dailyNeeded: ctx.phase === 'current' && ctx.remainingDays > 0 ? Math.max(target - count.sold, 0) / ctx.remainingDays : null,
    chartData: CHART_POINTS.map((t, i) => ({
      name: CHART_LABELS[i],
      produtos: Math.round(count.sold + (end - count.sold) * t),
      meta: Math.round(target * (progress + t * (1 - progress))),
    })),
  };
}

/** Exibição: um único arredondamento (inteiro) para unidades projetadas. */
export const roundUnits = (v: number): number => Math.round(v);

/** Uma casa decimal, formato brasileiro ("1,5"). */
export function formatPerDay(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Explica por que a projeção pode estar indisponível. */
export function projectionNote(ctx: MonthContext): string {
  if (ctx.phase === 'future') return 'Mês futuro: sem projeção';
  if (ctx.phase === 'past') return 'Mês encerrado: resultado realizado';
  if (ctx.elapsedDays <= 0) return 'Disponível a partir do 2º dia do mês (precisa de ao menos 1 dia completo)';
  return `Ritmo dos ${ctx.elapsedDays} dia(s) completos × ${ctx.daysInMonth} dias do mês`;
}

/** Meta inteira e não negativa; vazio = sem meta; inválido = NaN. */
export function parseDeviceTarget(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/**
* Ritmo necessário em inteiros, a partir dos totais reais (aparelhos que faltam e dias restantes) —
 * nunca de ritmos já arredondados. Padrão visual único (card da equipe e coluna da tabela):
 * (abreviação "ap" para aparelhos e "ac" para acessórios)
 *   ≥ 1 por dia  → "N ap/dia"   (N = teto; a meta diária prática nunca fica abaixo do necessário)
 *   < 1 por dia  → "1 ap/X dias" (X = piso de dias por aparelho; X ≤ 1 vira "1 ap/dia")
 * O arredondamento é só de exibição: os cálculos internos seguem exatos.
 */
export function formatPace(remaining: number, days: number, abbr: string = 'ap'): string {
  if (!(remaining > 0) || !(days > 0)) return '—';
  const eps = 1e-9;
  if (remaining >= days - eps) return `${Math.ceil(remaining / days - eps)} ${abbr}/dia`;
  const every = Math.floor(days / remaining + eps);
  return every <= 1 ? `1 ${abbr}/dia` : `1 ${abbr}/${every} dias`;
}

export type PaceState = 'pace' | 'reached' | 'no_goal' | 'missed' | 'future' | 'no_days';

export interface TeamPace {
  state: PaceState;
  /** Valor principal do card ("2 ap/dia", "Meta atingida", "Sem meta"…). */
  value: string;
  caption: string;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

/**
 * Card "Ritmo necessário" da equipe: faltam (meta geral − vendido por quem tem meta, a mesma conta do
 * card "Faltam para a meta") ÷ dias restantes do mês (hoje incluso, no fuso da loja).
 */
export function teamPace(team: { target: number | null; remaining: number | null }, ctx: MonthContext, kind: UnitKind = 'devices'): TeamPace {
  const copy = UNIT_COPY[kind];
  if (team.target == null || team.remaining == null) {
    return { state: 'no_goal', value: 'Sem meta', caption: `Cadastre as metas de ${copy.many}` };
  }
  if (ctx.phase === 'future') {
    return { state: 'future', value: '—', caption: 'Mês futuro: ainda não há vendas nem ritmo a calcular' };
  }
  if (team.remaining === 0) {
    return { state: 'reached', value: 'Meta atingida', caption: `A equipe já bateu a meta de ${copy.many} do mês` };
  }
  if (ctx.phase === 'past') {
    return { state: 'missed', value: 'Meta não atingida', caption: `Faltaram ${plural(team.remaining, copy.one, copy.many)} · mês encerrado` };
  }
  if (ctx.remainingDays <= 0) {
    return { state: 'no_days', value: '—', caption: `${plural(team.remaining, copy.one, copy.many)} sem dias restantes no mês` };
  }
  return {
    state: 'pace',
    value: formatPace(team.remaining, ctx.remainingDays, copy.abbr),
    caption: `${team.remaining === 1 ? 'Falta' : 'Faltam'} ${plural(team.remaining, copy.one, copy.many)} · ${plural(ctx.remainingDays, 'dia restante', 'dias restantes')}`,
  };
}
