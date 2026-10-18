/**
 * Regras do Dashboard comercial, fora dos componentes visuais.
 *
 * - Todo período é um intervalo de datas COMERCIAIS da loja (`AAAA-MM-DD`, inclusivo), filtrado por
 *   `sales.sold_date`. Horas vêm do relógio da loja (ver `wallClock` em dates.ts).
 * - Aparelho = produto iPhone; acessório = demais produtos com valor pago > 0; brinde (acessório
 *   com valor 0) não conta como venda, mas o custo dele entra no lucro (como no módulo financeiro).
 * - Linhas canceladas/obsoletas (`item_status`) nunca contam.
 * - Faturamento, custo e lucro só somam itens conciliados (`financial_status = ok`); o restante
 *   aparece como resultado parcial, nunca como zero.
 * - Vendas únicas = pedidos distintos (`mp_order_id`); uma venda pode ter vários itens.
 */
import { classifyProductCategory } from '../productClassifier.ts';
import { financeCategory, isActive, isReconciled, type Coverage, type FinanceSale, type FinanceSeller } from './calc.ts';
import { addDays, firstDay, formatDateBR, lastDay, longDateBR, monthOf, monthTitle, wallClock } from './dates.ts';

export type PeriodPreset = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'custom';

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  week: 'Esta semana',
  lastWeek: 'Semana passada',
  month: 'Este mês',
  lastMonth: 'Mês passado',
  custom: 'Personalizado',
};

export interface DateRange {
  from: string;
  to: string;
}

const isDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 0 = segunda … 6 = domingo (a semana da loja começa na segunda). */
function mondayIndex(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekRangeOf(date: string): DateRange {
  const from = addDays(date, -mondayIndex(date));
  return { from, to: addDays(from, 6) };
}

export function monthRangeOf(date: string): DateRange {
  const m = monthOf(date);
  return { from: firstDay(m), to: lastDay(m) };
}

export function presetRange(preset: PeriodPreset, today: string, custom?: Partial<DateRange>): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week':
      return weekRangeOf(today);
    case 'lastWeek':
      return weekRangeOf(addDays(today, -7));
    case 'month':
      return monthRangeOf(today);
    case 'lastMonth':
      return monthRangeOf(addDays(firstDay(monthOf(today)), -1));
    case 'custom': {
      const from = isDate(custom?.from) ? custom!.from! : today;
      const to = isDate(custom?.to) ? custom!.to! : from;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export function formatRange(range: DateRange): string {
  return range.from === range.to ? formatDateBR(range.from) : `${formatDateBR(range.from)} a ${formatDateBR(range.to)}`;
}

export function daysBetween(range: DateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Janela de referência da meta: a semana (ou o mês) que contém o último dia JÁ DECORRIDO do período
 * (períodos como "Este mês" terminam no futuro). A meta é sempre comparada com o vendido NESSA
 * janela — nunca se somam metas de períodos diferentes. `fits` indica se o período cabe inteiro
 * na janela; quando não cabe, a tela avisa.
 */
export function goalWindow(range: DateRange, kind: 'week' | 'month', today: string): { window: DateRange; fits: boolean } {
  const refDay = range.to <= today ? range.to : range.from <= today ? today : range.to;
  const window = kind === 'week' ? weekRangeOf(refDay) : monthRangeOf(refDay);
  return { window, fits: range.from >= window.from && range.to <= window.to };
}

/** Intervalo único a buscar: o período e as janelas de referência das metas (evita consultas duplicadas). */
export function dataRange(range: DateRange, today: string): DateRange {
  const w = goalWindow(range, 'week', today).window;
  const m = goalWindow(range, 'month', today).window;
  return {
    from: [range.from, w.from, m.from].sort()[0],
    to: [range.to, w.to, m.to].sort().at(-1)!,
  };
}

export function salesIn<T extends { sold_date: string }>(sales: T[], range: DateRange): T[] {
  return sales.filter((s) => s.sold_date >= range.from && s.sold_date <= range.to);
}

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

export type Names = Map<string, string>;
const cents = (v: number) => Math.round(v * 100);

export interface UnitsSummary {
  devices: number;
  accessories: number;
  gifts: number;
  /** Vendas únicas (pedidos distintos). */
  orders: number;
  items: number;
}

export function summarizeUnits(sales: FinanceSale[], names: Names): UnitsSummary {
  const out: UnitsSummary = { devices: 0, accessories: 0, gifts: 0, orders: 0, items: 0 };
  const orders = new Set<string>();
  for (const s of sales) {
    if (!isActive(s)) continue;
    out.items += 1;
    orders.add(s.mp_order_id ?? `row:${s.id}`);
    const cat = financeCategory(names.get(s.product_id), Number(s.amount) || 0);
    if (cat === 'Aparelhos') out.devices += s.quantity;
    else if (cat === 'Acessórios') out.accessories += s.quantity;
    else out.gifts += s.quantity;
  }
  out.orders = orders.size;
  return out;
}

export interface MoneySummary {
  revenue: number;
  cost: number;
  profit: number;
  /** lucro ÷ faturamento × 100; null com faturamento zero. */
  margin: number | null;
  items: number;
  reconciledItems: number;
}

export function summarizeMoney(sales: FinanceSale[]): MoneySummary {
  let revenue = 0;
  let cost = 0;
  let profit = 0;
  let items = 0;
  let reconciledItems = 0;
  for (const s of sales) {
    if (!isActive(s)) continue;
    items += 1;
    if (!isReconciled(s)) continue;
    reconciledItems += 1;
    revenue += cents(s.revenue ?? 0);
    cost += cents(s.cost ?? 0);
    profit += cents(s.profit ?? 0);
  }
  return {
    revenue: revenue / 100,
    cost: cost / 100,
    profit: profit / 100,
    margin: revenue > 0 ? (profit / revenue) * 100 : null,
    items,
    reconciledItems,
  };
}

/** Cobertura financeira do período (mesmo formato do módulo financeiro). */
export function rangeCoverage(sales: FinanceSale[], names: Names): Coverage {
  const pending: Coverage['pending'] = { pending: 0, mismatch: 0, ambiguous: 0, not_found: 0 };
  let items = 0;
  let reconciled = 0;
  let revenueKnown = 0;
  let amountPending = 0;
  let zeroCostDevices = 0;
  for (const s of sales) {
    if (!isActive(s)) continue;
    items += 1;
    if (isReconciled(s)) {
      reconciled += 1;
      revenueKnown += cents(s.revenue ?? 0);
      if (s.cost === 0 && classifyProductCategory(names.get(s.product_id)) === 'Aparelhos') zeroCostDevices += 1;
    } else {
      pending[s.financial_status === 'ok' ? 'pending' : s.financial_status] += 1;
      amountPending += cents(Number(s.amount) || 0);
    }
  }
  return {
    items,
    reconciled,
    pending,
    revenueKnown: revenueKnown / 100,
    amountPending: amountPending / 100,
    complete: items === reconciled,
    completeUntilCutoff: items === reconciled,
    zeroCostDevices,
  };
}

/** Resumo da conciliação para o botão e o modal (mesmos dados do `rangeCoverage`; nenhuma regra nova). */
export interface CoverageSummary {
  total: number;
  reconciled: number;
  pending: number;
  /** conciliados ÷ total × 100; null sem itens. */
  pct: number | null;
  revenueKnown: number;
  amountPending: number;
  zeroCostDevices: number;
  reasons: { label: string; count: number }[];
}

export function coverageSummary(c: Coverage): CoverageSummary {
  const reasons = [
    { label: 'Aguardando conciliação', count: c.pending.pending },
    { label: 'Correspondência ambígua', count: c.pending.ambiguous },
    { label: 'Sem pedido no histórico do Mercado Phone', count: c.pending.not_found },
    { label: 'Lucro divergente do informado pela origem', count: c.pending.mismatch },
  ].filter((r) => r.count > 0);
  return {
    total: c.items,
    reconciled: c.reconciled,
    pending: c.items - c.reconciled,
    pct: c.items > 0 ? (c.reconciled / c.items) * 100 : null,
    revenueKnown: c.revenueKnown,
    amountPending: c.amountPending,
    zeroCostDevices: c.zeroCostDevices,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Metas de unidades (configuração única da tela Metas)
// ---------------------------------------------------------------------------

export interface UnitTargets {
  weekly_devices_target: number;
  weekly_accessories_target: number;
  monthly_devices_target: number;
  monthly_accessories_target: number;
}

export interface GoalLine {
  sold: number;
  target: number | null;
  /** vendido ÷ meta × 100 (pode passar de 100). */
  pct: number | null;
  /** máx(meta − vendido, 0). */
  remaining: number | null;
}

export interface UnitGoalProgress {
  /** Janela de referência da meta (semana ou mês). */
  window: DateRange;
  /** O período filtrado cabe inteiro na janela. */
  fits: boolean;
  devices: GoalLine;
  accessories: GoalLine;
  /** Há alguma meta aplicável (janela válida e meta > 0). */
  hasGoal: boolean;
}

function goalLine(sold: number, target: number): GoalLine {
  const t = target > 0 ? target : null;
  return { sold, target: t, pct: t != null ? (sold / t) * 100 : null, remaining: t != null ? Math.max(t - sold, 0) : null };
}

export function unitGoalProgress(
  sales: FinanceSale[],
  names: Names,
  ref: { window: DateRange; fits: boolean },
  targets: { devices: number; accessories: number }
): UnitGoalProgress {
  const inWindow = summarizeUnits(salesIn(sales, ref.window), names);
  const devices = goalLine(inWindow.devices, targets.devices);
  const accessories = goalLine(inWindow.accessories, targets.accessories);
  return { window: ref.window, fits: ref.fits, devices, accessories, hasGoal: devices.target != null || accessories.target != null };
}

// ---------------------------------------------------------------------------
// Ranking por vendedor
// ---------------------------------------------------------------------------

export interface SellerDashRow extends MoneySummary {
  seller: FinanceSeller;
  devices: number;
  accessories: number;
  units: number;
}

export type RankSortKey = 'profit' | 'revenue' | 'margin' | 'devices' | 'accessories';

export const RANK_SORT_LABELS: Record<RankSortKey, string> = {
  profit: 'Lucro bruto',
  revenue: 'Faturamento',
  margin: 'Margem',
  devices: 'Aparelhos vendidos',
  accessories: 'Acessórios vendidos',
};

/** Linhas por vendedor do ITEM; só vendedores visíveis no ranking (o total da operação fica nos cards). */
export function buildSellerRows(sales: FinanceSale[], names: Names, sellers: FinanceSeller[], includeHidden = false): SellerDashRow[] {
  const bySeller = new Map<string, FinanceSale[]>();
  for (const s of sales) {
    if (!isActive(s)) continue;
    const list = bySeller.get(s.seller_id) ?? [];
    list.push(s);
    bySeller.set(s.seller_id, list);
  }
  return sellers
    .filter((s) => includeHidden || (s.show_in_ranking && (s.active || bySeller.has(s.id))))
    .map((seller) => {
      const rows = bySeller.get(seller.id) ?? [];
      const units = summarizeUnits(rows, names);
      return { seller, ...summarizeMoney(rows), devices: units.devices, accessories: units.accessories, units: units.devices + units.accessories };
    });
}

export function sortSellerRows(rows: SellerDashRow[], key: RankSortKey): SellerDashRow[] {
  const value = (r: SellerDashRow): number | null => (key === 'margin' ? r.margin : r[key]);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return b.profit - a.profit || a.seller.name.localeCompare(b.seller.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return vb - va || b.profit - a.profit || a.seller.name.localeCompare(b.seller.name);
  });
}

// ---------------------------------------------------------------------------
// Ranking por aparelhos (iPhones) com metas individuais mensais
// ---------------------------------------------------------------------------

export interface DeviceRankRow {
  seller: FinanceSeller;
  /** Aparelhos vendidos no período filtrado. */
  sold: number;
  /** Aparelhos vendidos no mês de referência da meta (acumulado do mês). */
  monthSold: number;
  /** Faturamento e lucro bruto só dos aparelhos (itens conciliados). */
  revenue: number;
  profit: number;
  items: number;
  reconciledItems: number;
  /** Meta mensal de aparelhos; null = sem meta (também quando cadastrada como 0). */
  target: number | null;
  /** Vendidos usados na comparação com a meta: o período, se ele é o mês inteiro; senão o acumulado do mês. */
  basis: number;
  /** A comparação usa o acumulado do mês (o período filtrado não é o mês inteiro). */
  basisIsMonth: boolean;
  /** basis ÷ meta × 100 (pode passar de 100). */
  pct: number | null;
  /** máx(meta − basis, 0). */
  remaining: number | null;
}

function isDeviceSale(s: FinanceSale, names: Names): boolean {
  return isActive(s) && financeCategory(names.get(s.product_id), Number(s.amount) || 0) === 'Aparelhos';
}

/**
 * Ranking de aparelhos pelo vendedor do ITEM. As metas são mensais: só quando o período é o MÊS
 * INTEIRO compara o vendido do período com a meta; em qualquer outro período (ex.: "Hoje", semana)
 * compara o acumulado do mês de referência — a tela deixa claro qual base foi usada. Sem meta = null.
 */
export function buildDeviceRows(
  sales: FinanceSale[],
  names: Names,
  sellers: FinanceSeller[],
  range: DateRange,
  monthRef: { window: DateRange; fits: boolean },
  targets: Map<string, number | null>,
  includeHidden = false
): DeviceRankRow[] {
  const inRange = salesIn(sales, range).filter((s) => isDeviceSale(s, names));
  const inMonth = salesIn(sales, monthRef.window).filter((s) => isDeviceSale(s, names));
  const group = (rows: FinanceSale[]) => {
    const m = new Map<string, FinanceSale[]>();
    for (const r of rows) m.set(r.seller_id, [...(m.get(r.seller_id) ?? []), r]);
    return m;
  };
  const byRange = group(inRange);
  const byMonth = group(inMonth);
  const wholeMonth = range.from === monthRef.window.from && range.to === monthRef.window.to;
  const qty = (rows: FinanceSale[] | undefined) => (rows ?? []).reduce((a, r) => a + r.quantity, 0);

  return sellers
    .filter((s) => includeHidden || (s.show_in_ranking && (s.active || byRange.has(s.id))))
    .map((seller) => {
      const rows = byRange.get(seller.id) ?? [];
      const money = summarizeMoney(rows);
      const sold = qty(rows);
      const monthSold = qty(byMonth.get(seller.id));
      const goal = targets.get(seller.id);
      const target = goal != null && goal > 0 ? goal : null;
      const basis = wholeMonth ? sold : monthSold;
      return {
        seller,
        sold,
        monthSold,
        revenue: money.revenue,
        profit: money.profit,
        items: money.items,
        reconciledItems: money.reconciledItems,
        target,
        basis,
        basisIsMonth: !wholeMonth,
        pct: target != null ? (basis / target) * 100 : null,
        remaining: target != null ? Math.max(target - basis, 0) : null,
      };
    })
    .sort((a, b) => b.sold - a.sold || b.profit - a.profit || a.seller.name.localeCompare(b.seller.name));
}

/** Aparelhos de um vendedor no período, mais recentes primeiro (detalhe do ranking). */
export function deviceItemsOf(sales: FinanceSale[], names: Names, sellerId: string, range: DateRange): FinanceSale[] {
  return salesIn(sales, range)
    .filter((s) => s.seller_id === sellerId && isDeviceSale(s, names))
    .sort((a, b) => b.sold_at.localeCompare(a.sold_at));
}

// ---------------------------------------------------------------------------
// Produto mais vendido
// ---------------------------------------------------------------------------

/** "IPHONE 18 PRO MAX - 512GB - SLV" → "iPhone 18 Pro Max" (agrupa capacidades e cores do mesmo modelo). */
export function deviceModel(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  const m = /^iphone\s*(x[rsm]?|se|\d{1,2})\s*(pro\s*max|pro|plus|mini|max|e)?(?![a-z0-9])/i.exec(raw);
  if (!m) return raw.split(' - ')[0].replace(/\s+/g, ' ').trim() || 'Produto não identificado';
  const suffix = m[2] ? ` ${m[2].replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : '';
  return `iPhone ${m[1].toUpperCase()}${suffix}`;
}

/** "CAPA CASE - . - ." → "CAPA CASE". */
export function accessoryLabel(name: string | null | undefined): string {
  return (name ?? '').split(' - ')[0].replace(/\s+/g, ' ').trim() || 'Produto não identificado';
}

export interface ProductGroup {
  name: string;
  qty: number;
  rows: FinanceSale[];
}

export interface TopProduct {
  name: string;
  qty: number;
  /** Participação nas unidades da categoria (aparelhos ou acessórios pagos). */
  share: number;
  revenue: number;
  /** Itens do produto sem custo/receita conciliados. */
  unreconciled: number;
  rows: FinanceSale[];
  /** Top 5 (inclui o primeiro): resumo exibido no card. */
  ranking: { name: string; qty: number }[];
  /** Todos os produtos da categoria no período, na mesma ordem (detalhe completo). */
  all: ProductGroup[];
}

/** Chave de agrupamento sem diferença de maiúsculas/minúsculas ou de espaços. */
const groupKey = (label: string) => label.replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');

/**
 * Produto mais vendido da categoria no período (unidades reais; brindes e canceladas fora).
 * Empate em unidades: nome em ordem alfabética (determinístico).
 */
export function topProduct(sales: FinanceSale[], names: Names, kind: 'devices' | 'accessories'): TopProduct | null {
  type Group = { qty: number; revenue: number; unreconciled: number; rows: FinanceSale[]; variants: Map<string, number> };
  const groups = new Map<string, Group>();
  let total = 0;
  for (const s of sales) {
    if (!isActive(s)) continue;
    const productName = names.get(s.product_id);
    const cat = financeCategory(productName, Number(s.amount) || 0);
    if ((kind === 'devices') !== (cat === 'Aparelhos') || cat === 'Brindes') continue;
    const label = kind === 'devices' ? deviceModel(productName) : accessoryLabel(productName);
    const key = groupKey(label);
    const g: Group = groups.get(key) ?? { qty: 0, revenue: 0, unreconciled: 0, rows: [], variants: new Map() };
    g.qty += s.quantity;
    total += s.quantity;
    g.rows.push(s);
    g.variants.set(label, (g.variants.get(label) ?? 0) + s.quantity);
    if (isReconciled(s)) g.revenue += cents(s.revenue ?? 0);
    else g.unreconciled += 1;
    groups.set(key, g);
  }
  // Nome exibido: a grafia mais usada do grupo (empate: alfabética).
  const display = (g: { variants: Map<string, number> }) =>
    [...g.variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0][0];
  const ordered = [...groups.values()]
    .map((g) => ({ ...g, name: display(g) }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  if (ordered.length === 0) return null;
  const top = ordered[0];
  const byDate = (rows: FinanceSale[]) => [...rows].sort((a, b) => b.sold_at.localeCompare(a.sold_at));
  return {
    name: top.name,
    qty: top.qty,
    share: total > 0 ? (top.qty / total) * 100 : 0,
    revenue: top.revenue / 100,
    unreconciled: top.unreconciled,
    rows: byDate(top.rows),
    ranking: ordered.slice(0, 5).map((g) => ({ name: g.name, qty: g.qty })),
    all: ordered.map((g) => ({ name: g.name, qty: g.qty, rows: byDate(g.rows) })),
  };
}

// ---------------------------------------------------------------------------
// Evolução de vendas (duas linhas: aparelhos e acessórios)
// ---------------------------------------------------------------------------

export type Granularity = 'hour' | 'day' | 'month';
export type SeriesMode = 'cumulative' | 'period';

export interface SeriesPoint {
  key: string;
  /** Rótulo do eixo X. */
  label: string;
  /** Título do tooltip. */
  title: string;
  /** Unidades vendidas no intervalo (null = intervalo futuro, ainda sem dados). */
  devices: number | null;
  accessories: number | null;
  devicesCum: number | null;
  accessoriesCum: number | null;
}

export interface NowInfo {
  today: string;
  hour: number;
}

export function pickGranularity(range: DateRange): Granularity {
  if (range.from === range.to) return 'hour';
  return daysBetween(range) <= 92 ? 'day' : 'month';
}

/** Hoje/ontem (um dia): por período. Demais: acumulado. */
export function defaultMode(range: DateRange): SeriesMode {
  return range.from === range.to ? 'period' : 'cumulative';
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function buildSeries(sales: FinanceSale[], names: Names, range: DateRange, now: NowInfo): { granularity: Granularity; points: SeriesPoint[] } {
  const granularity = pickGranularity(range);
  const devices = new Map<string, number>();
  const accessories = new Map<string, number>();

  const bucketOf = (s: FinanceSale): string =>
    granularity === 'hour' ? String(wallClock(s.sold_at).hour) : granularity === 'day' ? s.sold_date : monthOf(s.sold_date);

  for (const s of salesIn(sales, range)) {
    if (!isActive(s)) continue;
    const cat = financeCategory(names.get(s.product_id), Number(s.amount) || 0);
    if (cat === 'Brindes') continue;
    const target = cat === 'Aparelhos' ? devices : accessories;
    const key = bucketOf(s);
    target.set(key, (target.get(key) ?? 0) + s.quantity);
  }

  type Bucket = { key: string; label: string; title: string; future: boolean };
  const buckets: Bucket[] = [];
  if (granularity === 'hour') {
    for (let h = 0; h < 24; h += 1) {
      const hh = String(h).padStart(2, '0');
      buckets.push({ key: String(h), label: `${hh}h`, title: `${longDateBR(range.from)} · ${hh}h`, future: range.from > now.today || (range.from === now.today && h > now.hour) });
    }
  } else if (granularity === 'day') {
    const sameMonth = monthOf(range.from) === monthOf(range.to);
    const short = daysBetween(range) <= 7;
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const wd = WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];
      buckets.push({
        key: d,
        label: short ? `${wd} ${d.slice(8, 10)}` : sameMonth ? String(Number(d.slice(8, 10))) : `${d.slice(8, 10)}/${d.slice(5, 7)}`,
        title: longDateBR(d),
        future: d > now.today,
      });
    }
  } else {
    for (let m = monthOf(range.from); m <= monthOf(range.to); m = monthOf(addDays(lastDay(m), 1))) {
      buckets.push({ key: m, label: `${MONTH_ABBR[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`, title: monthTitle(m), future: m > monthOf(now.today) });
    }
  }

  let dCum = 0;
  let aCum = 0;
  const points = buckets.map((b): SeriesPoint => {
    if (b.future) return { key: b.key, label: b.label, title: b.title, devices: null, accessories: null, devicesCum: null, accessoriesCum: null };
    const d = devices.get(b.key) ?? 0;
    const a = accessories.get(b.key) ?? 0;
    dCum += d;
    aCum += a;
    return { key: b.key, label: b.label, title: b.title, devices: d, accessories: a, devicesCum: dCum, accessoriesCum: aCum };
  });
  return { granularity, points };
}

