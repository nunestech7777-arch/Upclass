/**
 * Regras financeiras do módulo de lucro — fora dos componentes visuais.
 *
 * Fonte: colunas financeiras de `sales` (conciliadas com o histórico do MercadoPhone).
 * - Lucro comercial = receita líquida da linha (valorTotal) − custo histórico da linha.
 *   Não é lucro líquido contábil: despesas da operação não são deduzidas.
 * - Somas financeiras usam só linhas ativas com `financial_status = 'ok'`; o restante aparece
 *   como cobertura parcial, nunca como zero.
 * - Unidades seguem a regra comercial existente (productClassifier): iPhone é aparelho; demais
 *   produtos com valor pago > 0 são acessórios; valor zero é brinde e não conta como venda — mas o
 *   custo do brinde entra no lucro.
 * - Projeção: dias corridos completos até ontem (fuso da loja). Hoje aparece em separado.
 */
import { classifyProductCategory } from '../productClassifier.ts';
import { addDays, dayDate, daysInMonth, storeToday } from './dates.ts';

export type ItemStatus = 'active' | 'cancelled' | 'removed';
export type FinancialStatus = 'pending' | 'ok' | 'mismatch' | 'ambiguous' | 'not_found';
export type FinanceCategory = 'Aparelhos' | 'Acessórios' | 'Brindes';

export interface FinanceSale {
  id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  amount: number;
  sold_at: string;
  sold_date: string;
  external_id: string | null;
  mp_order_id: string | null;
  item_status: ItemStatus;
  revenue: number | null;
  cost: number | null;
  profit: number | null;
  profit_reported: number | null;
  financial_status: FinancialStatus;
  financial_note: string | null;
  customer_name: string | null;
  product_type: string | null;
}

export interface FinanceSeller {
  id: string;
  name: string;
  photo_url: string | null;
  active: boolean;
  show_in_ranking: boolean;
}

export interface ProfitGoal {
  seller_id: string;
  month: string; // AAAA-MM
  profit_target: number | null;
  worst_case_target: number | null;
  updated_at?: string | null;
  updated_by_email?: string | null;
}

/** Lucro médio por iPhone num período anterior, base da equivalência em aparelhos. */
export interface IphoneBaseline {
  from: string;
  to: string;
  profit: number;
  units: number;
  /** Todas as linhas de iPhone do período estavam conciliadas. */
  complete: boolean;
}

export interface MonthFinanceInput {
  month: string;
  today?: string;
  sellers: FinanceSeller[];
  productNames: Map<string, string>;
  sales: FinanceSale[];
  goals: ProfitGoal[];
  iphoneBaseline?: IphoneBaseline | null;
}

export type MonthPhase = 'past' | 'current' | 'future';

export interface MonthContext {
  month: string;
  today: string;
  phase: MonthPhase;
  /** D: dias do mês. */
  daysInMonth: number;
  /** E: dias completos decorridos (até ontem; o mês inteiro se encerrado). */
  elapsedDays: number;
  /** R: D − E, incluindo hoje. */
  remainingDays: number;
  /** Último dia completo usado no corte (null se nenhum). */
  cutoffDate: string | null;
}

export interface Coverage {
  items: number;
  reconciled: number;
  /** Linhas não conciliadas por motivo. */
  pending: Record<Exclude<FinancialStatus, 'ok'>, number>;
  revenueKnown: number;
  /** Receita das linhas pendentes, pelo valor pago (amount), para dimensionar a lacuna. */
  amountPending: number;
  complete: boolean;
  /** Cobertura completa nos dias usados pela projeção (até o corte). */
  completeUntilCutoff: boolean;
  zeroCostDevices: number;
}

export interface Aggregate {
  items: number;
  reconciledItems: number;
  orders: number;
  units: number;
  devices: number;
  accessories: number;
  gifts: number;
  revenue: number;
  cost: number;
  profit: number;
  iphoneProfit: number;
  iphoneUnits: number;
  /** Lucro até o corte (L) e de hoje (H). */
  profitUntilCutoff: number;
  profitToday: number;
  byCategory: Record<FinanceCategory, { profit: number; revenue: number; units: number }>;
}

export interface GoalProgress {
  target: number | null;
  worst: number | null;
  /** Lucro ÷ meta × 100, só para meta positiva. Pode passar de 100 ou ser negativo. */
  pctTarget: number | null;
  pctWorst: number | null;
  /** máximo(meta − lucro, 0). */
  gap: number | null;
  /** Projeção linear pelos dias completos: L ÷ E × D. */
  projection: number | null;
  /** máximo(meta − L, 0) ÷ R — também é a meta-base de hoje. */
  neededPerDay: number | null;
  /** máximo(meta-base de hoje − H, 0). */
  todayGap: number | null;
  goalReached: boolean;
}

export interface SellerFinance extends Aggregate, GoalProgress {
  seller: FinanceSeller;
  margin: number | null;
  ticket: number | null;
  avgPerUnit: number | null;
  avgIphoneProfit: number | null;
  /** Aparelhos equivalentes para cobrir a falta de hoje (ver plano de ação). */
  devicesToday: number | null;
}

export type DayStatus = 'hit' | 'below' | 'today' | 'future' | 'partial' | 'no_goal';
export type PaceStatus = 'on_pace' | 'below_pace' | 'in_progress' | 'future' | 'no_goal' | 'partial';

export interface DayFinance {
  date: string;
  day: number;
  isToday: boolean;
  isFuture: boolean;
  complete: boolean;
  orders: number;
  items: number;
  reconciledItems: number;
  devices: number;
  accessories: number;
  gifts: number;
  revenue: number;
  cost: number;
  profit: number;
  dailyGoal: number | null;
  pctDailyGoal: number | null;
  cumulative: number | null;
  expectedCumulative: number | null;
  status: DayStatus;
  pace: PaceStatus;
}

export interface EvolutionPoint {
  day: number;
  date: string;
  realized: number | null;
  goal: number | null;
  projection: number | null;
}

export interface ActionPlan {
  goal: number | null;
  realizedUntilCutoff: number;
  realizedToday: number;
  projection: number | null;
  projectionDiff: number | null;
  pacePerDay: number | null;
  neededPerDay: number | null;
  todayBase: number | null;
  todayGap: number | null;
  devicesEquivalent: number | null;
  devicesReason: string | null;
  avgIphoneProfit: number | null;
  baseline: IphoneBaseline | null;
  messages: string[];
}

export interface MonthFinance {
  context: MonthContext;
  coverage: Coverage;
  totals: SellerFinance;
  sellers: SellerFinance[];
  days: DayFinance[];
  evolution: EvolutionPoint[];
  plan: ActionPlan;
  dailyGoal: number | null;
  daysHit: number;
  /** Desvio acumulado até ontem: L − M × E ÷ D. */
  paceDeviation: number | null;
  /**
   * Dias completos sem nenhum item registrado. Podem ser dias sem venda ou atraso de importação —
   * a projeção os conta como zero, então a tela avisa.
   */
  emptyCompleteDays: string[];
}

// ---------------------------------------------------------------------------

const cents = (v: number) => Math.round(v * 100);
const fromCents = (v: number) => v / 100;

export function financeCategory(productName: string | null | undefined, amount: number): FinanceCategory {
  if (classifyProductCategory(productName) === 'Aparelhos') return 'Aparelhos';
  return amount > 0 ? 'Acessórios' : 'Brindes';
}

export function isActive(sale: Pick<FinanceSale, 'item_status'>): boolean {
  return (sale.item_status ?? 'active') === 'active';
}

export function isReconciled(sale: Pick<FinanceSale, 'financial_status' | 'profit'>): boolean {
  return sale.financial_status === 'ok' && sale.profit != null;
}

export function buildContext(month: string, today = storeToday()): MonthContext {
  const D = daysInMonth(month);
  const todayMonth = today.slice(0, 7);
  if (month < todayMonth) {
    return { month, today, phase: 'past', daysInMonth: D, elapsedDays: D, remainingDays: 0, cutoffDate: dayDate(month, D) };
  }
  if (month > todayMonth) {
    return { month, today, phase: 'future', daysInMonth: D, elapsedDays: 0, remainingDays: D, cutoffDate: null };
  }
  const E = Number(today.slice(8, 10)) - 1;
  return {
    month,
    today,
    phase: 'current',
    daysInMonth: D,
    elapsedDays: E,
    remainingDays: D - E,
    cutoffDate: E > 0 ? addDays(today, -1) : null,
  };
}

interface Acc {
  items: number;
  reconciledItems: number;
  orders: Set<string>;
  units: number;
  devices: number;
  accessories: number;
  gifts: number;
  revenue: number;
  cost: number;
  profit: number;
  iphoneProfit: number;
  iphoneUnits: number;
  profitUntilCutoff: number;
  profitToday: number;
  byCategory: Record<FinanceCategory, { profit: number; revenue: number; units: number }>;
}

function newAcc(): Acc {
  return {
    items: 0,
    reconciledItems: 0,
    orders: new Set(),
    units: 0,
    devices: 0,
    accessories: 0,
    gifts: 0,
    revenue: 0,
    cost: 0,
    profit: 0,
    iphoneProfit: 0,
    iphoneUnits: 0,
    profitUntilCutoff: 0,
    profitToday: 0,
    byCategory: {
      Aparelhos: { profit: 0, revenue: 0, units: 0 },
      Acessórios: { profit: 0, revenue: 0, units: 0 },
      Brindes: { profit: 0, revenue: 0, units: 0 },
    },
  };
}

function add(acc: Acc, sale: FinanceSale, category: FinanceCategory, ctx: MonthContext) {
  acc.items += 1;
  acc.units += sale.quantity;
  if (sale.mp_order_id) acc.orders.add(sale.mp_order_id);
  else acc.orders.add(`row:${sale.id}`);
  if (category === 'Aparelhos') acc.devices += sale.quantity;
  else if (category === 'Acessórios') acc.accessories += sale.quantity;
  else acc.gifts += sale.quantity;
  acc.byCategory[category].units += sale.quantity;

  if (!isReconciled(sale)) return;
  const profit = cents(sale.profit!);
  acc.reconciledItems += 1;
  acc.revenue += cents(sale.revenue ?? 0);
  acc.cost += cents(sale.cost ?? 0);
  acc.profit += profit;
  acc.byCategory[category].profit += profit;
  acc.byCategory[category].revenue += cents(sale.revenue ?? 0);
  if (category === 'Aparelhos') {
    acc.iphoneProfit += profit;
    acc.iphoneUnits += sale.quantity;
  }
  if (ctx.cutoffDate && sale.sold_date <= ctx.cutoffDate) acc.profitUntilCutoff += profit;
  if (ctx.phase === 'current' && sale.sold_date === ctx.today) acc.profitToday += profit;
}

function finish(acc: Acc): Aggregate {
  const cat = (c: FinanceCategory) => ({
    profit: fromCents(acc.byCategory[c].profit),
    revenue: fromCents(acc.byCategory[c].revenue),
    units: acc.byCategory[c].units,
  });
  return {
    items: acc.items,
    reconciledItems: acc.reconciledItems,
    orders: acc.orders.size,
    units: acc.units,
    devices: acc.devices,
    accessories: acc.accessories,
    gifts: acc.gifts,
    revenue: fromCents(acc.revenue),
    cost: fromCents(acc.cost),
    profit: fromCents(acc.profit),
    iphoneProfit: fromCents(acc.iphoneProfit),
    iphoneUnits: acc.iphoneUnits,
    profitUntilCutoff: fromCents(acc.profitUntilCutoff),
    profitToday: fromCents(acc.profitToday),
    byCategory: { Aparelhos: cat('Aparelhos'), Acessórios: cat('Acessórios'), Brindes: cat('Brindes') },
  };
}

/** Avanço de uma meta. Exportado para os testes e para o relatório individual. */
export function goalProgress(
  agg: Pick<Aggregate, 'profit' | 'profitUntilCutoff' | 'profitToday'>,
  target: number | null,
  worst: number | null,
  ctx: MonthContext
): GoalProgress {
  const positive = target != null && target > 0 ? target : null;
  const worstPositive = worst != null && worst > 0 ? worst : null;
  const L = agg.profitUntilCutoff;
  const H = agg.profitToday;
  const D = ctx.daysInMonth;
  const E = ctx.elapsedDays;
  const R = ctx.remainingDays;

  const projection = ctx.phase === 'past' ? agg.profit : ctx.phase === 'current' && E > 0 ? (L / E) * D : null;
  const neededPerDay = positive != null && ctx.phase !== 'past' && R > 0 ? Math.max(positive - L, 0) / R : null;
  const todayGap = neededPerDay != null && ctx.phase === 'current' ? Math.max(neededPerDay - H, 0) : null;

  return {
    target,
    worst,
    pctTarget: positive != null ? (agg.profit / positive) * 100 : null,
    pctWorst: worstPositive != null ? (agg.profit / worstPositive) * 100 : null,
    gap: positive != null ? Math.max(positive - agg.profit, 0) : null,
    projection,
    neededPerDay,
    todayGap,
    goalReached: positive != null && agg.profit >= positive,
  };
}

function devicesFor(gap: number | null, avg: number | null): number | null {
  if (gap == null || avg == null || avg <= 0) return null;
  return Math.ceil(gap / avg);
}

function sellerFinance(
  seller: FinanceSeller,
  agg: Aggregate,
  goal: ProfitGoal | undefined | { profit_target: number | null; worst_case_target: number | null },
  ctx: MonthContext,
  baselineAvg: number | null
): SellerFinance {
  const progress = goalProgress(agg, goal?.profit_target ?? null, goal?.worst_case_target ?? null, ctx);
  return {
    seller,
    ...agg,
    ...progress,
    margin: agg.revenue > 0 ? (agg.profit / agg.revenue) * 100 : null,
    ticket: agg.orders > 0 && agg.reconciledItems > 0 ? agg.revenue / agg.orders : null,
    avgPerUnit: agg.units > 0 && agg.reconciledItems > 0 ? agg.revenue / agg.units : null,
    avgIphoneProfit: agg.iphoneUnits > 0 ? agg.iphoneProfit / agg.iphoneUnits : null,
    devicesToday: devicesFor(progress.todayGap, baselineAvg),
  };
}

export function buildMonthFinance(input: MonthFinanceInput): MonthFinance {
  const ctx = buildContext(input.month, input.today);
  const D = ctx.daysInMonth;
  const categoryOf = (s: FinanceSale) => financeCategory(input.productNames.get(s.product_id), Number(s.amount) || 0);

  const active = input.sales.filter(isActive);
  const goalBySeller = new Map(input.goals.map((g) => [g.seller_id, g]));
  const consolidatedTarget = sumNullable(input.goals.map((g) => g.profit_target));
  const consolidatedWorst = sumNullable(input.goals.map((g) => g.worst_case_target));

  // Cobertura
  const pending: Coverage['pending'] = { pending: 0, mismatch: 0, ambiguous: 0, not_found: 0 };
  let reconciled = 0;
  let revenueKnown = 0;
  let amountPending = 0;
  let completeUntilCutoff = true;
  let zeroCostDevices = 0;
  for (const s of active) {
    if (isReconciled(s)) {
      reconciled += 1;
      revenueKnown += cents(s.revenue ?? 0);
      if (s.cost === 0 && categoryOf(s) === 'Aparelhos') zeroCostDevices += 1;
    } else {
      const key = s.financial_status === 'ok' ? 'pending' : s.financial_status;
      pending[key] += 1;
      amountPending += cents(Number(s.amount) || 0);
      if (ctx.cutoffDate && s.sold_date <= ctx.cutoffDate) completeUntilCutoff = false;
    }
  }
  const coverage: Coverage = {
    items: active.length,
    reconciled,
    pending,
    revenueKnown: fromCents(revenueKnown),
    amountPending: fromCents(amountPending),
    complete: reconciled === active.length,
    completeUntilCutoff,
    zeroCostDevices,
  };

  const baseline = input.iphoneBaseline ?? null;
  const baselineAvg = baseline && baseline.complete && baseline.units > 0 && baseline.profit > 0 ? baseline.profit / baseline.units : null;

  // Totais e vendedores
  const totalAcc = newAcc();
  const sellerAcc = new Map<string, Acc>();
  const dayAcc = new Map<string, Acc>();
  for (const s of active) {
    const category = categoryOf(s);
    add(totalAcc, s, category, ctx);
    if (!sellerAcc.has(s.seller_id)) sellerAcc.set(s.seller_id, newAcc());
    add(sellerAcc.get(s.seller_id)!, s, category, ctx);
    if (!dayAcc.has(s.sold_date)) dayAcc.set(s.sold_date, newAcc());
    add(dayAcc.get(s.sold_date)!, s, category, ctx);
  }

  const operationSeller: FinanceSeller = { id: 'operacao', name: 'Operação', photo_url: null, active: true, show_in_ranking: true };
  const totalsAgg = finish(totalAcc);
  const totals = sellerFinance(
    operationSeller,
    totalsAgg,
    { profit_target: consolidatedTarget, worst_case_target: consolidatedWorst },
    ctx,
    baselineAvg
  );

  const sellerById = new Map(input.sellers.map((s) => [s.id, s]));
  const involved = new Set<string>([...sellerAcc.keys(), ...goalBySeller.keys()]);
  for (const s of input.sellers) if (s.show_in_ranking && s.active) involved.add(s.id);
  const sellers = [...involved]
    .map((id) => {
      const seller = sellerById.get(id) ?? { id, name: 'Vendedor não cadastrado', photo_url: null, active: false, show_in_ranking: false };
      return sellerFinance(seller, finish(sellerAcc.get(id) ?? newAcc()), goalBySeller.get(id), ctx, baselineAvg);
    })
    .sort((a, b) => b.profit - a.profit || a.seller.name.localeCompare(b.seller.name));

  // Dias
  const M = consolidatedTarget != null && consolidatedTarget > 0 ? consolidatedTarget : null;
  const dailyGoal = M != null ? M / D : null;
  const days: DayFinance[] = [];
  let cumulative = 0;
  let daysHit = 0;
  for (let day = 1; day <= D; day += 1) {
    const date = dayDate(input.month, day);
    const isToday = ctx.phase === 'current' && date === ctx.today;
    const isFuture = ctx.phase === 'future' || (ctx.phase === 'current' && date > ctx.today);
    const complete = !isToday && !isFuture;
    const agg = finish(dayAcc.get(date) ?? newAcc());
    const partial = agg.reconciledItems < agg.items;
    if (!isFuture) cumulative += cents(agg.profit);
    const expectedCumulative = M != null ? (M * day) / D : null;
    const cumValue = isFuture ? null : fromCents(cumulative);

    let status: DayStatus;
    if (isFuture) status = 'future';
    else if (isToday) status = 'today';
    else if (partial) status = 'partial';
    else if (dailyGoal == null) status = 'no_goal';
    else status = agg.profit >= dailyGoal ? 'hit' : 'below';
    if (status === 'hit') daysHit += 1;

    let pace: PaceStatus;
    if (isFuture) pace = 'future';
    else if (isToday) pace = 'in_progress';
    else if (M == null) pace = 'no_goal';
    else if (partial) pace = 'partial';
    else pace = cumValue! >= expectedCumulative! ? 'on_pace' : 'below_pace';

    days.push({
      date,
      day,
      isToday,
      isFuture,
      complete,
      orders: agg.orders,
      items: agg.items,
      reconciledItems: agg.reconciledItems,
      devices: agg.devices,
      accessories: agg.accessories,
      gifts: agg.gifts,
      revenue: agg.revenue,
      cost: agg.cost,
      profit: agg.profit,
      dailyGoal,
      pctDailyGoal: dailyGoal != null && !isFuture ? (agg.profit / dailyGoal) * 100 : null,
      cumulative: cumValue,
      expectedCumulative,
      status,
      pace,
    });
  }

  // Evolução: realizado contínuo até hoje, meta linear e projeção tracejada a partir do corte.
  const E = ctx.elapsedDays;
  const L = totals.profitUntilCutoff;
  const projectionAvailable = ctx.phase === 'current' && E > 0;
  const evolution: EvolutionPoint[] = days.map((d) => ({
    day: d.day,
    date: d.date,
    realized: d.cumulative,
    goal: d.expectedCumulative,
    projection: projectionAvailable && d.day >= E ? (L / E) * d.day : null,
  }));

  const paceDeviation = M != null && ctx.phase !== 'future' ? L - (M * E) / D : null;
  const plan = buildPlan(totals, ctx, coverage, baseline, baselineAvg, M);

  const emptyCompleteDays = days.filter((d) => d.complete && d.items === 0).map((d) => d.date);

  return { context: ctx, coverage, totals, sellers, days, evolution, plan, dailyGoal, daysHit, paceDeviation, emptyCompleteDays };
}

function sumNullable(values: (number | null | undefined)[]): number | null {
  let any = false;
  let total = 0;
  for (const v of values) {
    if (v == null) continue;
    any = true;
    total += cents(v);
  }
  return any ? fromCents(total) : null;
}

function buildPlan(
  totals: SellerFinance,
  ctx: MonthContext,
  coverage: Coverage,
  baseline: IphoneBaseline | null,
  baselineAvg: number | null,
  M: number | null
): ActionPlan {
  const E = ctx.elapsedDays;
  const L = totals.profitUntilCutoff;
  const H = totals.profitToday;
  const projection = ctx.phase === 'current' && E > 0 ? (L / E) * ctx.daysInMonth : null;
  const neededPerDay = totals.neededPerDay;
  const todayGap = totals.todayGap;

  let devicesReason: string | null = null;
  let devicesEquivalent: number | null = null;
  if (ctx.phase !== 'current') devicesReason = 'Disponível apenas no mês atual';
  else if (M == null) devicesReason = 'Sem meta cadastrada';
  else if (!baseline || baseline.units === 0) devicesReason = 'Sem base para estimar: não há iPhones vendidos no período de referência';
  else if (!baseline.complete) devicesReason = 'Sem base para estimar: há iPhones sem custo conciliado no período de referência';
  else if (baselineAvg == null) devicesReason = 'Sem base para estimar: lucro médio por iPhone não é positivo';
  else if (!coverage.completeUntilCutoff) devicesReason = 'Sem base para estimar: há itens sem custo conciliado no mês';
  else devicesEquivalent = devicesFor(todayGap, baselineAvg);

  const messages: string[] = [];
  const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (M == null) {
    messages.push('Cadastre as metas de lucro dos vendedores para calcular ritmo e necessidade diária.');
  } else if (ctx.phase === 'current') {
    if (todayGap != null && todayGap > 0) messages.push(`Faltam ${money(todayGap)} para a meta-base de hoje.`);
    else if (todayGap === 0) messages.push('A meta-base de hoje já foi alcançada.');
    if (projection != null) {
      const diff = projection - M;
      messages.push(
        diff >= 0
          ? `No ritmo dos dias completos, a projeção fica ${money(diff)} acima da meta.`
          : `No ritmo dos dias completos, a projeção fica ${money(-diff)} abaixo da meta.`
      );
    } else {
      messages.push('Projeção pelo ritmo disponível a partir do segundo dia do mês (é preciso ao menos um dia completo).');
    }
    if (neededPerDay != null && E > 0) {
      const pace = L / E;
      messages.push(
        neededPerDay > pace
          ? `É preciso ${money(neededPerDay)} por dia até o fim do mês — ${money(neededPerDay - pace)} a mais que o ritmo atual.`
          : `O ritmo atual (${money(pace)}/dia) cobre a necessidade de ${money(neededPerDay)} por dia.`
      );
    }
    if (!coverage.completeUntilCutoff) messages.push('Atenção: há itens sem custo conciliado; os valores acima são parciais.');
  } else if (ctx.phase === 'past') {
    messages.push(totals.profit >= M ? 'Mês encerrado com a meta atingida.' : `Mês encerrado ${money(M - totals.profit)} abaixo da meta.`);
  }

  return {
    goal: M,
    realizedUntilCutoff: L,
    realizedToday: H,
    projection,
    projectionDiff: projection != null && M != null ? projection - M : null,
    pacePerDay: E > 0 && ctx.phase === 'current' ? L / E : null,
    neededPerDay,
    todayBase: neededPerDay,
    todayGap,
    devicesEquivalent,
    devicesReason,
    avgIphoneProfit: baselineAvg,
    baseline,
    messages,
  };
}

/** Lucro médio por iPhone de um conjunto de linhas (base da equivalência em aparelhos). */
export function computeIphoneBaseline(
  sales: Pick<FinanceSale, 'product_id' | 'quantity' | 'amount' | 'item_status' | 'financial_status' | 'profit'>[],
  productNames: Map<string, string>,
  from: string,
  to: string
): IphoneBaseline {
  let profit = 0;
  let units = 0;
  let complete = true;
  for (const s of sales) {
    if (!isActive(s)) continue;
    if (classifyProductCategory(productNames.get(s.product_id)) !== 'Aparelhos') continue;
    if (!isReconciled(s)) {
      complete = false;
      continue;
    }
    profit += cents(s.profit!);
    units += s.quantity;
  }
  return { from, to, profit: fromCents(profit), units, complete };
}

/**
 * Soma um subconjunto de vendedores (ex.: só os visíveis no ranking) recalculando percentuais e
 * médias a partir dos numeradores e denominadores — nunca média de percentuais. `orders` vira a
 * soma das participações (um pedido com dois vendedores conta para os dois).
 */
export function combineSellers(rows: SellerFinance[], ctx: MonthContext): Omit<SellerFinance, 'seller'> {
  const sum = (pick: (s: SellerFinance) => number) => fromCents(rows.reduce((a, s) => a + cents(pick(s)), 0));
  const count = (pick: (s: SellerFinance) => number) => rows.reduce((a, s) => a + pick(s), 0);
  const cat = (c: FinanceCategory) => ({
    profit: sum((s) => s.byCategory[c].profit),
    revenue: sum((s) => s.byCategory[c].revenue),
    units: count((s) => s.byCategory[c].units),
  });
  const agg: Aggregate = {
    items: count((s) => s.items),
    reconciledItems: count((s) => s.reconciledItems),
    orders: count((s) => s.orders),
    units: count((s) => s.units),
    devices: count((s) => s.devices),
    accessories: count((s) => s.accessories),
    gifts: count((s) => s.gifts),
    revenue: sum((s) => s.revenue),
    cost: sum((s) => s.cost),
    profit: sum((s) => s.profit),
    iphoneProfit: sum((s) => s.iphoneProfit),
    iphoneUnits: count((s) => s.iphoneUnits),
    profitUntilCutoff: sum((s) => s.profitUntilCutoff),
    profitToday: sum((s) => s.profitToday),
    byCategory: { Aparelhos: cat('Aparelhos'), Acessórios: cat('Acessórios'), Brindes: cat('Brindes') },
  };
  const target = sumNullable(rows.map((s) => s.target));
  const worst = sumNullable(rows.map((s) => s.worst));
  const progress = goalProgress(agg, target, worst, ctx);
  return {
    ...agg,
    ...progress,
    margin: agg.revenue > 0 ? (agg.profit / agg.revenue) * 100 : null,
    ticket: null,
    avgPerUnit: agg.units > 0 && agg.reconciledItems > 0 ? agg.revenue / agg.units : null,
    avgIphoneProfit: agg.iphoneUnits > 0 ? agg.iphoneProfit / agg.iphoneUnits : null,
    devicesToday: null,
  };
}
