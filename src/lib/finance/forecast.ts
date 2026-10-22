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
 * - Métrica: QUANTIDADE (unidades) ou FATURAMENTO (R$). Faturamento = `sales.revenue` (valorTotal do
 *   histórico do MercadoPhone, valor da LINHA do vendedor do item) — o mesmo campo chamado de
 *   "Faturamento" no Dashboard e no Resultado Financeiro. Só soma itens conciliados
 *   (`financial_status = ok`); os pendentes ficam de fora e são informados (`pending`), nunca viram
 *   zero nem são trocados pelo valor pago. Faturamento não é lucro nem custo. Somas em centavos.
 */
import { classifyProductCategory } from '../productClassifier.ts';
import { APPLE_TYPES, classifyAppleLine, isOtherBrandPhone, type AppleType, type ReviewReason } from './appleProducts.ts';
import type { MonthContext } from './calc.ts';

export interface UnitSale {
  seller_id: string;
  product_id: string;
  quantity: number;
  amount: number | string;
  sold_date: string;
  item_status?: 'active' | 'cancelled' | 'removed' | null;
  /** valorTotal da linha (faturamento); null = ainda não conciliado. */
  revenue?: number | string | null;
  financial_status?: string | null;
  profit?: number | string | null;
  /** Id da venda (pedido) no MercadoPhone — base do "atendimento" (ticket médio e PA). */
  mp_order_id?: string | null;
  external_id?: string | null;
  id?: string;
  /** tipoProdutoDescricao do histórico (vendas conciliadas) — confirma a classificação Apple. */
  product_type?: string | null;
}

export interface DeviceGoalLike {
  seller_id: string;
  device_target: number | null;
}

export interface UnitCount {
  sold: number;
  untilCutoff: number;
  today: number;
  /** Faturamento: itens da categoria ainda não conciliados (fora da soma). */
  pending?: number;
  /** Faturamento: valor pago (amount) desses itens pendentes, só para dimensionar a lacuna. */
  pendingAmount?: number;
}

const empty = (): UnitCount => ({ sold: 0, untilCutoff: 0, today: 0 });

function addTo(count: UnitCount, sale: UnitSale, ctx: MonthContext, value: number = sale.quantity) {
  count.sold += value;
  if (ctx.cutoffDate && sale.sold_date <= ctx.cutoffDate) count.untilCutoff += value;
  if (ctx.phase === 'current' && sale.sold_date === ctx.today) count.today += value;
}

/** Métrica exibida no Forecast: unidades vendidas ou faturamento em reais. */
export type ForecastMetric = 'units' | 'revenue';

/** Métrica padrão de cada categoria (ao trocar de categoria, volta para esta). */
export const DEFAULT_METRIC: Record<'devices' | 'accessories', ForecastMetric> = { devices: 'units', accessories: 'revenue' };

export const METRIC_LABELS: Record<ForecastMetric, string> = { units: 'Quantidade de produtos', revenue: 'Faturamento' };

const toCents = (v: number | string | null | undefined): number => Math.round((Number(v) || 0) * 100);

/** Faturamento da linha disponível? Mesmo critério do Dashboard (`isReconciled` em calc.ts): status ok e lucro calculado. */
export function hasRevenue(sale: Pick<UnitSale, 'financial_status' | 'profit'>): boolean {
  return sale.financial_status === 'ok' && sale.profit != null;
}

export function isCountedSale(sale: Pick<UnitSale, 'item_status'>): boolean {
  return (sale.item_status ?? 'active') === 'active';
}

/** Aba do Forecast: Aparelhos (iPhones), Acessórios ou Produtos Apple (todos os tipos Apple). */
export type UnitKind = 'devices' | 'accessories' | 'apple';

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
  apple: {
    abbr: 'un',
    one: 'produto Apple',
    many: 'produtos Apple',
    soldLabel: 'Produtos Apple vendidos',
    goalLabel: 'Meta',
    eyebrow: 'Produtos Apple por tipo',
    subtitle: 'Produtos Apple vendidos por vendedor, agrupados automaticamente por tipo (iPhone, MacBook, iPad, Apple Watch, AirPods…).',
    sortSold: 'Mais produtos Apple vendidos',
    tab: 'Produtos Apple',
    soldHint: 'itens Apple do mês',
  },
};

/** Tipo Apple da linha (null = não é produto Apple reconhecido). Brinde (valor 0) só conta se for iPhone, como em Aparelhos. */
export function appleTypeOf(sale: UnitSale, name: string | undefined): AppleType | null {
  const c = classifyAppleLine(name, sale);
  if (c.kind !== 'apple') return null;
  return c.type === 'iPhone' || (Number(sale.amount) || 0) > 0 ? c.type : null;
}

/**
 * Unidade conta na categoria? Aparelho = iPhone; acessório = demais com valor pago > 0 (brinde não
 * conta) e que NÃO sejam produto Apple reconhecido (só no Forecast: MacBook, iPad, Apple Watch… saem
 * de Acessórios e entram em Produtos Apple; itens "para revisão" continuam em Acessórios).
 */
function matchesKind(sale: UnitSale, name: string | undefined, kind: UnitKind): boolean {
  const isDevice = classifyProductCategory(name) === 'Aparelhos';
  if (kind === 'devices') return isDevice;
  if (kind === 'apple') return appleTypeOf(sale, name) != null;
  // Celulares de outras marcas (POCO, Realme…) não são acessórios.
  return !isDevice && (Number(sale.amount) || 0) > 0 && classifyAppleLine(name, sale).kind !== 'apple' && !isOtherBrandPhone(name);
}

/**
 * Unidades vendidas por vendedor do ITEM numa categoria, sem canceladas/obsoletas e em unidades
 * reais. O vendedor vem de `sales.seller_id` (vendedor do item), nunca do vendedor do pedido.
 */
export function countUnitsBySeller(sales: UnitSale[], productNames: Map<string, string>, ctx: MonthContext, kind: UnitKind): Map<string, UnitCount> {
  return measureBySeller(sales, productNames, ctx, kind, 'units');
}

/**
 * Unidades OU faturamento por vendedor do ITEM numa categoria. Mesmos filtros da contagem (sem
 * canceladas/removidas, sem brindes); em faturamento cada linha soma só o próprio valorTotal — nunca
 * o total do pedido —, então um pedido com itens de vendedores diferentes não duplica valores.
 */
export function measureBySeller(
  sales: UnitSale[],
  productNames: Map<string, string>,
  ctx: MonthContext,
  kind: UnitKind,
  metric: ForecastMetric
): Map<string, UnitCount> {
  return measureGrouped(sales, ctx, metric, (s) => (matchesKind(s, productNames.get(s.product_id), kind) ? s.seller_id : null));
}

/** Soma unidades ou faturamento por uma chave (null = linha fora). Canceladas/removidas nunca entram. */
function measureGrouped(sales: UnitSale[], ctx: MonthContext, metric: ForecastMetric, keyOf: (s: UnitSale) => string | null): Map<string, UnitCount> {
  const bySeller = new Map<string, UnitCount>();
  for (const s of sales) {
    if (!isCountedSale(s)) continue;
    const key = keyOf(s);
    if (key == null) continue;
    const c = bySeller.get(key) ?? empty();
    if (metric === 'units') addTo(c, s, ctx);
    else if (hasRevenue(s)) addTo(c, s, ctx, toCents(s.revenue));
    else {
      c.pending = (c.pending ?? 0) + 1;
      c.pendingAmount = (c.pendingAmount ?? 0) + toCents(s.amount);
    }
    bySeller.set(key, c);
  }
  if (metric === 'revenue') {
    // Soma feita em centavos inteiros; converte uma única vez.
    for (const c of bySeller.values()) {
      c.sold /= 100;
      c.untilCutoff /= 100;
      c.today /= 100;
      c.pending ??= 0;
      c.pendingAmount = (c.pendingAmount ?? 0) / 100;
    }
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
): { devices: UnitCount; accessories: UnitCount; appleOther: UnitCount } {
  const devices = empty();
  const accessories = empty();
  // Produtos Apple além do iPhone (MacBook, iPad…): fora de Acessórios no Forecast, mas dentro de "Todos os produtos".
  const appleOther = empty();
  for (const s of sales) {
    if (!isCountedSale(s)) continue;
    const name = productNames.get(s.product_id);
    if (classifyProductCategory(name) === 'Aparelhos') addTo(devices, s, ctx);
    else if (matchesKind(s, name, 'accessories')) addTo(accessories, s, ctx);
    else if (appleTypeOf(s, name)) addTo(appleOther, s, ctx);
  }
  return { devices, accessories, appleOther };
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
  /** Unidades ou R$, conforme a métrica. */
  sold: number;
  soldToday: number;
  /** Faturamento: itens ainda não conciliados (fora do valor). */
  pendingItems: number;
  /** Meta do mês na métrica escolhida; null = sem meta (também quando cadastrada como 0). */
  target: number | null;
  projection: number | null;
  /** máximo(meta − vendidos, 0); null sem meta. */
  remaining: number | null;
  goalReached: boolean;
  /** vendidos ÷ meta × 100 (pode passar de 100). */
  pct: number | null;
  /**
   * faltam ÷ dias restantes (inclui hoje); null sem meta, mês encerrado/futuro ou meta batida.
   * Faturamento: arredondado para CIMA no centavo (o ritmo nunca fica abaixo do necessário).
   */
  neededPerDay: number | null;
}

/** Valor faltante em R$ calculado em centavos (sem resíduo de ponto flutuante). */
const moneyRemaining = (goal: number, sold: number) => Math.max(toCents(goal) - toCents(sold), 0) / 100;

/** R$/dia necessário: teto no centavo, a partir dos centavos faltantes. */
export function moneyPerDay(remaining: number, days: number): number {
  return Math.ceil(toCents(remaining) / days - 1e-9) / 100;
}

export function buildSellerRow(sellerId: string, count: UnitCount | undefined, target: number | null, ctx: MonthContext, metric: ForecastMetric = 'units'): SellerUnitRow {
  const c = count ?? empty();
  const goal = target != null && target > 0 ? target : null;
  const remaining = goal != null ? (metric === 'revenue' ? moneyRemaining(goal, c.sold) : Math.max(goal - c.sold, 0)) : null;
  const goalReached = goal != null && remaining === 0;
  const pace = goal != null && !goalReached && ctx.phase === 'current' && ctx.remainingDays > 0;
  return {
    sellerId,
    sold: c.sold,
    soldToday: c.today,
    pendingItems: c.pending ?? 0,
    target: goal,
    projection: projectUnits(c.sold, c.untilCutoff, ctx),
    remaining,
    goalReached,
    pct: goal != null ? (c.sold / goal) * 100 : null,
    neededPerDay: pace ? (metric === 'revenue' ? moneyPerDay(remaining!, ctx.remainingDays) : remaining! / ctx.remainingDays) : null,
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
  /** Faturamento: itens não conciliados fora da soma. */
  pendingItems: number;
}

/** Totais da equipe: soma de numeradores, nunca média de percentuais. Só vendedores com meta entram no saldo. */
export function summarizeTeam(rows: SellerUnitRow[], metric: ForecastMetric = 'units'): TeamUnitSummary {
  // Faturamento soma em centavos; projeções seguem exatas (arredondadas só na exibição).
  const add = (values: number[]) => (metric === 'revenue' ? values.reduce((a, v) => a + toCents(v), 0) / 100 : values.reduce((a, v) => a + v, 0));
  const sold = add(rows.map((r) => r.sold));
  const withGoal = rows.filter((r) => r.target != null);
  const target = withGoal.length > 0 ? add(withGoal.map((r) => r.target!)) : null;
  const projections = rows.map((r) => r.projection).filter((p): p is number => p != null);
  const soldWithGoal = add(withGoal.map((r) => r.sold));
  return {
    sold,
    target,
    projection: projections.length > 0 ? projections.reduce((a, p) => a + p, 0) : null,
    // Meta geral = soma das metas individuais; falta = meta geral − vendido por quem tem meta.
    remaining: target != null ? (metric === 'revenue' ? moneyRemaining(target, soldWithGoal) : Math.max(target - soldWithGoal, 0)) : null,
    pct: target != null ? (soldWithGoal / target) * 100 : null,
    sellersWithGoal: withGoal.length,
    pendingItems: rows.reduce((a, r) => a + (r.pendingItems ?? 0), 0),
  };
}

export type ForecastSortKey = 'sold' | 'soldAsc' | 'projection' | 'pct' | 'remainingAsc' | 'remainingDesc';

export const FORECAST_SORT_LABELS: Record<ForecastSortKey, string> = {
  sold: UNIT_COPY.devices.sortSold,
  soldAsc: 'Menos aparelhos vendidos',
  projection: 'Maior projeção',
  pct: 'Maior percentual da meta',
  remainingAsc: 'Menor quantidade faltante',
  remainingDesc: 'Maior quantidade faltante',
};

/**
 * Rótulos de ordenação da categoria e da métrica ("Mais aparelhos vendidos" ↔ "Maior faturamento de
 * acessórios"). A ordenação é independente da métrica: as chaves são as mesmas, só o texto muda.
 */
export function forecastSortLabels(kind: UnitKind, metric: ForecastMetric = 'units'): Record<ForecastSortKey, string> {
  const many = UNIT_COPY[kind].many;
  if (metric === 'revenue') {
    return {
      sold: `Maior faturamento de ${many}`,
      soldAsc: `Menor faturamento de ${many}`,
      projection: 'Maior projeção de faturamento',
      pct: 'Maior percentual da meta',
      remainingAsc: 'Menor valor faltante',
      remainingDesc: 'Maior valor faltante',
    };
  }
  return { ...FORECAST_SORT_LABELS, sold: UNIT_COPY[kind].sortSold, soldAsc: `Menos ${many} vendidos` };
}

/** Ordena; valores indisponíveis (sem meta/projeção) ficam no fim. Desempate: mais vendidos, depois nome. */
export function sortUnitRows<T extends SellerUnitRow & { name: string }>(rows: T[], key: ForecastSortKey): T[] {
  const value = (r: T): number | null =>
    key === 'sold' || key === 'soldAsc' ? r.sold : key === 'projection' ? r.projection : key === 'pct' ? r.pct : r.remaining;
  const ascending = key === 'remainingAsc' || key === 'soldAsc';
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
export function teamPace(team: { target: number | null; remaining: number | null }, ctx: MonthContext, kind: UnitKind = 'devices', metric: ForecastMetric = 'units'): TeamPace {
  if (metric === 'revenue') return teamMoneyPace(team, ctx, kind);
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

// ---------------------------------------------------------------------------
// Faturamento (R$)
// ---------------------------------------------------------------------------

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.234,56" (exibição; nunca usado em cálculo). */
export const formatMoney = (v: number): string => BRL.format(v);

/** Ritmo em R$: "R$ 3.571,43/dia" (teto no centavo — atingir o ritmo garante a meta). */
export function formatMoneyPace(remaining: number, days: number): string {
  if (!(remaining > 0) || !(days > 0)) return '—';
  return `${formatMoney(moneyPerDay(remaining, days))}/dia`;
}

function teamMoneyPace(team: { target: number | null; remaining: number | null }, ctx: MonthContext, kind: UnitKind): TeamPace {
  const many = UNIT_COPY[kind].many;
  if (team.target == null || team.remaining == null) {
    return { state: 'no_goal', value: 'Sem meta', caption: `Cadastre as metas de faturamento de ${many}` };
  }
  if (ctx.phase === 'future') {
    return { state: 'future', value: '—', caption: 'Mês futuro: ainda não há vendas nem ritmo a calcular' };
  }
  if (team.remaining === 0) {
    return { state: 'reached', value: 'Meta atingida', caption: `A equipe já bateu a meta de faturamento de ${many} do mês` };
  }
  if (ctx.phase === 'past') {
    return { state: 'missed', value: 'Meta não atingida', caption: `Faltaram ${formatMoney(team.remaining)} · mês encerrado` };
  }
  if (ctx.remainingDays <= 0) {
    return { state: 'no_days', value: '—', caption: `${formatMoney(team.remaining)} sem dias restantes no mês` };
  }
  return {
    state: 'pace',
    value: formatMoneyPace(team.remaining, ctx.remainingDays),
    caption: `Falta faturar ${formatMoney(team.remaining)} · ${plural(ctx.remainingDays, 'dia restante', 'dias restantes')}`,
  };
}

/** Meta financeira: vazio = sem meta; aceita "5000", "5.000", "5.000,50", "5000.5"; inválido = NaN. */
export function parseMoneyTarget(v: string): number | null {
  const t = v.trim().replace(/^R\$\s*/i, '');
  if (t === '') return null;
  let normalized: string;
  // Limite da coluna numeric(12,2): acima disso o banco recusaria.
  const MAX = 9_999_999_999.99;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t) || /^\d+(,\d{1,2})?$/.test(t)) normalized = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(\.\d{1,2})?$/.test(t)) normalized = t;
  else return NaN;
  const value = Math.round(Number(normalized) * 100) / 100;
  return value > MAX ? NaN : value;
}

// ---------------------------------------------------------------------------
// Metas e textos por categoria × métrica
// ---------------------------------------------------------------------------

export interface SellerGoalsLike {
  device_target: number | null;
  accessory_target?: number | null;
  device_revenue_target?: number | null;
  accessory_revenue_target?: number | null;
}

/**
 * Meta da combinação categoria × métrica. As quatro metas são independentes: nenhuma é derivada de
 * outra (meta em unidades nunca vira meta em R$). Ausente = null ("Sem meta").
 */
export function goalFor(goal: SellerGoalsLike | undefined, kind: UnitKind, metric: ForecastMetric): number | null {
  // Produtos Apple não têm meta cadastrada (nenhuma é criada automaticamente).
  if (!goal || kind === 'apple') return null;
  const v =
    kind === 'devices'
      ? metric === 'units' ? goal.device_target : goal.device_revenue_target
      : metric === 'units' ? goal.accessory_target : goal.accessory_revenue_target;
  return v ?? null;
}

export interface MetricCopy {
  soldLabel: string;
  soldColumn: string;
  goalColumn: string;
  remainingColumn: string;
  soldHint: string;
  subtitle: string;
  mobileSold: string;
}

export function metricCopy(kind: UnitKind, metric: ForecastMetric): MetricCopy {
  const c = UNIT_COPY[kind];
  if (metric === 'revenue') {
    return {
      soldLabel: `Faturamento de ${c.many}`,
      soldColumn: 'Faturamento realizado',
      goalColumn: 'Meta de faturamento',
      remainingColumn: 'Falta faturar',
      soldHint: `${c.many} conciliados do mês`,
      subtitle: `Acompanhe o desempenho, as metas e a projeção do faturamento de ${c.many} até o final do mês.`,
      mobileSold: 'Faturado',
    };
  }
  return {
    soldLabel: c.soldLabel,
    soldColumn: c.soldLabel,
    goalColumn: c.goalLabel,
    remainingColumn: 'Faltam vender',
    soldHint: c.soldHint,
    subtitle: c.subtitle,
    mobileSold: 'Vendidos',
  };
}

// ---------------------------------------------------------------------------
// Acessórios: ticket médio e PA (peças por atendimento)
// ---------------------------------------------------------------------------

/**
 * Indicadores de média, só para acessórios. Não têm meta, projeção nem ritmo (não há regra válida
 * para projetar uma média), por isso ficam fora de `ForecastMetric`.
 */
export type RatioMetric = 'ticket' | 'pa';
/** O que o filtro "métrica" pode mostrar. */
export type ForecastView = ForecastMetric | RatioMetric;

export const VIEW_LABELS: Record<ForecastView, string> = {
  units: 'Quantidade de produtos',
  revenue: 'Faturamento',
  ticket: 'Ticket médio',
  pa: 'PA — Peças por atendimento',
};

/** Opções do filtro por categoria, na ordem do dropdown (a primeira é o padrão). */
export const VIEW_OPTIONS: Record<UnitKind, ForecastView[]> = {
  devices: ['units', 'revenue'],
  apple: ['units', 'revenue'],
  accessories: ['revenue', 'units', 'ticket', 'pa'],
};

export const isRatioView = (v: ForecastView): v is RatioMetric => v === 'ticket' || v === 'pa';

/**
 * Chave do pedido. O MercadoPhone não tem identificador de atendimento: "atendimento" = venda
 * (pedido, `mp_order_id`) distinta POR VENDEDOR. Sem `mp_order_id`, usa o prefixo do external_id
 * ("pedido-produto-n"); sem nenhum dos dois, a linha vale como um pedido próprio (nunca junta linhas
 * sem prova de que são da mesma venda).
 */
function orderKey(sale: UnitSale): string {
  if (sale.mp_order_id) return sale.mp_order_id;
  const m = /^(\d+)-\d+-\d+$/.exec(sale.external_id ?? '');
  if (m) return m[1];
  return `linha:${sale.id ?? `${sale.seller_id}|${sale.product_id}|${sale.sold_date}|${sale.amount}`}`;
}

export interface AttendanceStats {
  /** Atendimentos válidos: pedidos distintos do vendedor com ao menos um acessório pago. */
  attendances: number;
  /** Peças: soma de `quantity` dos acessórios pagos (3 películas numa linha = 3). */
  units: number;
  /** Faturamento (R$) dos atendimentos com todos os acessórios conciliados. */
  revenue: number;
  /** Atendimentos usados no ticket (todos os acessórios conciliados). */
  revenueAttendances: number;
  /** Atendimentos fora do ticket até a sincronização financeira. */
  pendingAttendances: number;
  /** Atendimentos com 2 ou mais peças. */
  multiPiece: number;
}

const emptyStats = (): AttendanceStats => ({ attendances: 0, units: 0, revenue: 0, revenueAttendances: 0, pendingAttendances: 0, multiPiece: 0 });

/**
 * Atendimentos de acessórios por vendedor do ITEM. Mesmos filtros de acessórios do Forecast (sem
 * canceladas/removidas, sem brindes, sem iPhone). Um pedido com acessórios de dois vendedores conta
 * um atendimento para cada um; pedido só com brindes não conta.
 */
export function accessoryAttendancesBySeller(sales: UnitSale[], productNames: Map<string, string>): Map<string, AttendanceStats> {
  const groups = new Map<string, { seller: string; units: number; cents: number; reconciled: boolean }>();
  for (const s of sales) {
    if (!isCountedSale(s)) continue;
    if (!matchesKind(s, productNames.get(s.product_id), 'accessories')) continue;
    const key = `${s.seller_id}|${orderKey(s)}`;
    const g = groups.get(key) ?? { seller: s.seller_id, units: 0, cents: 0, reconciled: true };
    g.units += s.quantity;
    if (hasRevenue(s)) g.cents += toCents(s.revenue);
    else g.reconciled = false;
    groups.set(key, g);
  }
  const bySeller = new Map<string, AttendanceStats>();
  for (const g of groups.values()) {
    const st = bySeller.get(g.seller) ?? emptyStats();
    st.attendances += 1;
    st.units += g.units;
    if (g.units >= 2) st.multiPiece += 1;
    if (g.reconciled) {
      st.revenue += g.cents;
      st.revenueAttendances += 1;
    } else st.pendingAttendances += 1;
    bySeller.set(g.seller, st);
  }
  for (const st of bySeller.values()) st.revenue /= 100;
  return bySeller;
}

export interface RatioRow extends AttendanceStats {
  sellerId: string;
  /** Faturamento ÷ atendimentos conciliados; null sem atendimento conciliado. */
  ticket: number | null;
  /** Peças ÷ atendimentos; null sem atendimento. */
  pa: number | null;
}

export function buildRatioRow(sellerId: string, stats: AttendanceStats | undefined): RatioRow {
  const st = stats ?? emptyStats();
  return {
    sellerId,
    ...st,
    ticket: st.revenueAttendances > 0 ? st.revenue / st.revenueAttendances : null,
    pa: st.attendances > 0 ? st.units / st.attendances : null,
  };
}

/**
 * Equipe: razão das SOMAS (faturamento total ÷ atendimentos totais; peças totais ÷ atendimentos
 * totais), nunca soma ou média dos tickets/PAs individuais. Como cada atendimento é (pedido,
 * vendedor), somar os atendimentos dos vendedores não duplica nada.
 */
export function summarizeRatio(rows: RatioRow[]): RatioRow {
  const total = emptyStats();
  let cents = 0;
  for (const r of rows) {
    total.attendances += r.attendances;
    total.units += r.units;
    cents += toCents(r.revenue);
    total.revenueAttendances += r.revenueAttendances;
    total.pendingAttendances += r.pendingAttendances;
    total.multiPiece += r.multiPiece;
  }
  total.revenue = cents / 100;
  return buildRatioRow('team', total);
}

export type RatioSortKey = 'value' | 'valueAsc' | 'attendances';

export function ratioSortLabels(metric: RatioMetric): Record<RatioSortKey, string> {
  return metric === 'ticket'
    ? { value: 'Maior ticket médio', valueAsc: 'Menor ticket médio', attendances: 'Mais atendimentos' }
    : { value: 'Maior PA', valueAsc: 'Menor PA', attendances: 'Mais atendimentos' };
}

/** Ordena pelo indicador; sem atendimento (indicador indisponível) fica no fim. Desempate: mais atendimentos, nome. */
export function sortRatioRows<T extends RatioRow & { name: string }>(rows: T[], metric: RatioMetric, key: RatioSortKey): T[] {
  const value = (r: T): number | null => (key === 'attendances' ? r.attendances : metric === 'ticket' ? r.ticket : r.pa);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return b.attendances - a.attendances || a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    const diff = key === 'valueAsc' ? va - vb : vb - va;
    return diff || b.attendances - a.attendances || a.name.localeCompare(b.name);
  });
}

/** PA com duas casas: "2,35". */
export const formatPA = (v: number): string => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Produtos Apple: por vendedor e por tipo
// ---------------------------------------------------------------------------

/** Produtos Apple não têm meta: só ordenações que não dependem dela. */
export const APPLE_SORT_KEYS: ForecastSortKey[] = ['sold', 'soldAsc', 'projection'];

export interface AppleSellerMeasure {
  total: UnitCount;
  byType: Map<AppleType, UnitCount>;
}

/**
 * Unidades ou faturamento de produtos Apple por vendedor do ITEM e por tipo identificado
 * automaticamente. Cada linha conta uma vez, no tipo dela: uma venda com iPhone + MacBook + iPad soma
 * 1 em cada tipo (total 3). O total do vendedor é a soma dos tipos (R$ em centavos).
 */
export function measureAppleBySeller(sales: UnitSale[], productNames: Map<string, string>, ctx: MonthContext, metric: ForecastMetric): Map<string, AppleSellerMeasure> {
  const grouped = measureGrouped(sales, ctx, metric, (s) => {
    const type = appleTypeOf(s, productNames.get(s.product_id));
    return type ? `${s.seller_id}\u0000${type}` : null;
  });
  const bySeller = new Map<string, AppleSellerMeasure>();
  for (const [key, count] of grouped) {
    const [seller, type] = key.split('\u0000') as [string, AppleType];
    const m = bySeller.get(seller) ?? { total: empty(), byType: new Map() };
    m.byType.set(type, count);
    bySeller.set(seller, m);
  }
  for (const m of bySeller.values()) {
    const counts = [...m.byType.values()];
    const sum = (f: (c: UnitCount) => number) => (metric === 'revenue' ? counts.reduce((a, c) => a + toCents(f(c)), 0) / 100 : counts.reduce((a, c) => a + f(c), 0));
    m.total = {
      sold: sum((c) => c.sold),
      untilCutoff: sum((c) => c.untilCutoff),
      today: sum((c) => c.today),
      pending: counts.reduce((a, c) => a + (c.pending ?? 0), 0),
      pendingAmount: sum((c) => c.pendingAmount ?? 0),
    };
    // Ordem fixa dos tipos (iPhone, MacBook, iPad…).
    m.byType = new Map(APPLE_TYPES.filter((t) => m.byType.has(t)).map((t) => [t, m.byType.get(t)!]));
  }
  return bySeller;
}

export interface AppleReviewItem {
  name: string;
  reason: ReviewReason;
  /** Tipo sugerido pelo nome (só informativo; NÃO é usado na contagem). */
  suggested: AppleType | null;
  units: number;
  /** Valor pago (amount) — o item não foi classificado, então não há faturamento Apple a mostrar. */
  amount: number;
  sellerIds: string[];
}

/** Itens pagos que NÃO foram classificados por segurança e precisam de revisão (agrupados por nome e motivo). */
export function appleReviewItems(sales: UnitSale[], productNames: Map<string, string>): AppleReviewItem[] {
  const items = new Map<string, AppleReviewItem & { cents: number; sellers: Set<string> }>();
  for (const s of sales) {
    if (!isCountedSale(s) || !((Number(s.amount) || 0) > 0)) continue;
    const name = productNames.get(s.product_id) ?? '';
    const c = classifyAppleLine(name, s);
    if (c.kind !== 'review') continue;
    const key = `${name.trim()}\u0000${c.reason}`;
    const it = items.get(key) ?? { name: name.trim(), reason: c.reason, suggested: c.type, units: 0, amount: 0, sellerIds: [], cents: 0, sellers: new Set<string>() };
    it.units += s.quantity;
    it.cents += toCents(s.amount);
    it.sellers.add(s.seller_id);
    items.set(key, it);
  }
  return [...items.values()]
    .map(({ cents, sellers, ...it }) => ({ ...it, amount: cents / 100, sellerIds: [...sellers] }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

export { APPLE_TYPES, type AppleType };
