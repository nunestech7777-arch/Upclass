/**
 * Giro de estoque — regras puras (testadas em stockTurnover.test.ts).
 *
 * Fontes (auditoria da API do MercadoPhone em 21/10/2026):
 * - Vendas: histórico do MercadoPhone (function mercadophone-giro), uma linha por item, com a
 *   `dataEntrada` do CADASTRO do produto.
 * - Unidades com IMEI/série (iPhones, Macs, iPads…): o cadastro é a própria unidade → a data de
 *   entrada é REAL. Vendida antes da entrada registrada = venda sob encomenda: fica fora da média.
 * - Produtos em lote (acessórios, películas, brindes): o MercadoPhone soma reposições no mesmo
 *   cadastro sem registrar a data, então a `dataEntrada` NÃO é usada. A idade vem das entradas
 *   detectadas pelo sistema (stock_movements, desde o início do rastreamento) com FIFO — estimativa
 *   contábil, não rastreabilidade real. Saldo anterior ao rastreamento tem idade DESCONHECIDA.
 *
 * Fórmulas:
 *   permanência da unidade = data da venda − data de entrada (dias corridos, fuso da loja)
 *   giro médio = Σ permanências ÷ unidades vendidas com data válida (média ponderada por unidade)
 *   idade do estoque atual = Σ (hoje − entrada) das unidades disponíveis ÷ unidades com data conhecida
 *
 * Venda comercial = valor pago > 0 (brinde/cortesia não entra no giro de VENDAS, mas sai do estoque
 * e consome os lotes no FIFO). iPhone sempre conta como venda (regra existente do sistema).
 * Canceladas não contam.
 */
import { isDeviceProduct } from '../productClassifier.ts';
import { normalizeName } from './appleProducts.ts';
import { addDays, firstDay, lastDay, monthOf, addMonths } from './dates.ts';
import type { DateRange } from './dashboard.ts';
import type { StockItem } from './stockMetrics.ts';

export type TurnoverCategory = 'iphones' | 'acessorios' | 'peliculas' | 'outros';
export const TURNOVER_CATEGORIES: TurnoverCategory[] = ['iphones', 'acessorios', 'peliculas', 'outros'];
export const TURNOVER_LABELS: Record<TurnoverCategory, string> = {
  iphones: 'iPhones',
  acessorios: 'Acessórios',
  peliculas: 'Películas',
  outros: 'Outros',
};
export type CategoryFilter = 'all' | TurnoverCategory;

/** Tipos oficiais do MercadoPhone tratados como acessório (TORTUGA SHILD = marca de capas/películas). */
const ACCESSORY_TYPES = new Set(['ACESSORIOS', 'BRINDES', 'TORTUGA SHILD']);

/**
 * Uma categoria por produto: iPhone (regra oficial do sistema) → película (nome) → acessório (tipo
 * oficial) → outros (demais Apple, peças, Android…).
 */
/** iPhone cadastrado só pelo modelo, sem capacidade ("15 PLUS"), quando o tipo oficial é PRODUTO APPLE. */
const APPLE_MODEL_ONLY = /^(?:IPHONE )?(1[1-9]|X[RS]?|SE)( (PRO MAX|PRO|PLUS|MINI|E|MAX))?( -|$)/;

export function turnoverCategoryOf(name: string | null | undefined, mpType: string | null | undefined): TurnoverCategory {
  if (isDeviceProduct(name)) return 'iphones';
  const n = normalizeName(name);
  if (normalizeName(mpType) === 'PRODUTO APPLE' && APPLE_MODEL_ONLY.test(n)) return 'iphones';
  // Inclui grafias com erro de digitação vistas no cadastro ("PEÍCULA", "PELCULA").
  if (/\bPE(LI|I|L|LL?I)CULAS?\b/.test(n)) return 'peliculas';
  if (ACCESSORY_TYPES.has(normalizeName(mpType))) return 'acessorios';
  return 'outros';
}

/** Linha da function mercadophone-giro (ver supabase/functions/_shared/turnoverLines.ts). */
export interface TurnoverLine {
  key: string;
  orderId: string;
  productId: string;
  name: string;
  type: string | null;
  quantity: number;
  soldAt: string;
  entryDate: string | null;
  unit: boolean;
  paid: boolean;
  cancelled: boolean;
}

/** Linha de stock_movements com o instante já no relógio da loja (`AAAA-MM-DD HH:mm:ss`). */
export interface StockMovement {
  productId: string;
  detectedAt: string;
  kind: 'baseline' | 'entry' | 'exit' | 'return';
  quantity: number;
  entryDate: string | null;
  /** Saldo do produto logo após o movimento. */
  quantityAfter?: number;
  name?: string | null;
  type?: string | null;
}

export const dayDiff = (to: string, from: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/**
 * Trava extra: cadastro de "unidade" que aparece em mais de uma venda não é unidade única (é lote).
 * Devolve as linhas com `unit` corrigido.
 */
export function normalizeUnitLines(lines: TurnoverLine[]): TurnoverLine[] {
  const count = new Map<string, number>();
  for (const l of lines) if (l.unit && !l.cancelled) count.set(l.productId, (count.get(l.productId) ?? 0) + 1);
  return lines.map((l) => (l.unit && (count.get(l.productId) ?? 0) > 1 ? { ...l, unit: false } : l));
}

export const isCommercial = (l: Pick<TurnoverLine, 'paid' | 'name'>) => l.paid || isDeviceProduct(l.name);

// ---------------------------------------------------------------------------
// FIFO dos produtos em lote
// ---------------------------------------------------------------------------

export interface Lot {
  quantity: number;
  /** null = saldo anterior ao rastreamento (idade desconhecida). */
  entryDate: string | null;
}

export interface Piece {
  quantity: number;
  /** Dias em estoque da parte; null = idade desconhecida. */
  days: number | null;
  reason?: 'before_tracking' | 'untracked' | 'no_lot' | 'baseline';
}

export interface FifoResult {
  pieces: Map<string, Piece[]>;
  /** Lotes restantes por produto, do mais antigo para o mais novo. */
  remaining: Map<string, Lot[]>;
  /** Primeira leitura do rastreamento (relógio da loja) ou null se ainda não começou. */
  trackingStart: string | null;
}

/**
 * Aloca as saídas (vendas e brindes, sem canceladas) aos lotes em ordem de chegada. Só vale a partir
 * da primeira leitura do produto: vendas anteriores ficam com idade desconhecida. `currentQty`
 * (estoque ao vivo) ajusta o saldo final; `historyFrom` = início do histórico de vendas carregado: excesso sai dos lotes mais antigos (baixas não vistas);
 * falta vira saldo de idade desconhecida (devoluções ou ajustes não rastreados).
 */
export function allocateFifo(lines: TurnoverLine[], movements: StockMovement[], currentQty?: Map<string, number>, historyFrom?: string): FifoResult {
  const pieces = new Map<string, Piece[]>();
  const remaining = new Map<string, Lot[]>();
  const movesBy = new Map<string, StockMovement[]>();
  // Sem o histórico de vendas anterior à janela, os lotes de antes dela não podem ser consumidos com
  // segurança: o saldo do produto no início da janela entra como UM lote de idade desconhecida.
  let windowed = movements;
  if (historyFrom) {
    const lastBefore = new Map<string, StockMovement>();
    windowed = [];
    for (const m of movements) {
      if (m.detectedAt.slice(0, 10) >= historyFrom) windowed.push(m);
      else {
        const prev = lastBefore.get(m.productId);
        if (!prev || m.detectedAt >= prev.detectedAt) lastBefore.set(m.productId, m);
      }
    }
    for (const [productId, m] of lastBefore) {
      if ((m.quantityAfter ?? 0) > 0)
        windowed.push({ productId, detectedAt: `${historyFrom} 00:00:00`, kind: 'baseline', quantity: m.quantityAfter!, entryDate: null, name: m.name, type: m.type });
    }
  }
  for (const m of windowed) {
    if (!movesBy.has(m.productId)) movesBy.set(m.productId, []);
    movesBy.get(m.productId)!.push(m);
  }
  const trackingStart = movements.reduce<string | null>((min, m) => (min == null || m.detectedAt < min ? m.detectedAt : min), null);

  const linesBy = new Map<string, TurnoverLine[]>();
  for (const l of lines) {
    if (l.unit || l.cancelled || l.quantity <= 0) continue;
    if (!linesBy.has(l.productId)) linesBy.set(l.productId, []);
    linesBy.get(l.productId)!.push(l);
  }

  for (const productId of new Set([...linesBy.keys(), ...movesBy.keys()])) {
    const moves = (movesBy.get(productId) ?? []).slice().sort((a, b) => (a.detectedAt < b.detectedAt ? -1 : a.detectedAt > b.detectedAt ? 1 : 0));
    const sales = (linesBy.get(productId) ?? []).slice().sort((a, b) => (a.soldAt < b.soldAt ? -1 : a.soldAt > b.soldAt ? 1 : a.key < b.key ? -1 : 1));
    const start = moves[0]?.detectedAt ?? null;
    const queue: Lot[] = [];
    let mi = 0;
    for (const sale of sales) {
      if (start == null || sale.soldAt <= start) {
        pieces.set(sale.key, [{ quantity: sale.quantity, days: null, reason: start == null ? 'untracked' : 'before_tracking' }]);
        continue;
      }
      // Entradas detectadas até o momento da venda.
      while (mi < moves.length && moves[mi].detectedAt <= sale.soldAt) pushMove(queue, moves[mi++]);
      let left = sale.quantity;
      const out: Piece[] = [];
      while (left > 0 && queue.length > 0) {
        const lot = queue[0];
        const take = Math.min(left, lot.quantity);
        out.push(lot.entryDate ? { quantity: take, days: Math.max(0, dayDiff(sale.soldAt, lot.entryDate)) } : { quantity: take, days: null, reason: 'baseline' });
        lot.quantity -= take;
        left -= take;
        if (lot.quantity === 0) queue.shift();
      }
      if (left > 0) out.push({ quantity: left, days: null, reason: 'no_lot' });
      pieces.set(sale.key, mergePieces(out));
    }
    while (mi < moves.length) pushMove(queue, moves[mi++]);
    if (currentQty && start != null) reconcile(queue, currentQty.get(productId) ?? 0);
    if (start != null) remaining.set(productId, queue);
  }
  return { pieces, remaining, trackingStart };
}

function pushMove(queue: Lot[], m: StockMovement) {
  // Saldo inicial e devoluções de canceladas: idade desconhecida.
  if (m.kind === 'baseline' || m.kind === 'return') queue.push({ quantity: m.quantity, entryDate: null });
  else if (m.kind === 'entry') queue.push({ quantity: m.quantity, entryDate: m.entryDate });
  // 'exit' não consome aqui: as vendas/brindes do histórico já consomem (evita contar duas vezes).
}

function reconcile(queue: Lot[], actual: number) {
  let total = queue.reduce((a, l) => a + l.quantity, 0);
  while (total > actual && queue.length > 0) {
    const take = Math.min(total - actual, queue[0].quantity);
    queue[0].quantity -= take;
    total -= take;
    if (queue[0].quantity === 0) queue.shift();
  }
  if (total < actual) queue.unshift({ quantity: actual - total, entryDate: null });
}

function mergePieces(ps: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (last && last.days === p.days && last.reason === p.reason) last.quantity += p.quantity;
    else out.push({ ...p });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Giro realizado (vendas do período)
// ---------------------------------------------------------------------------

export interface TurnoverStats {
  /** Média ponderada por unidade; null sem unidades medidas. */
  avgDays: number | null;
  /** Unidades vendidas (comerciais) com data válida — base da média. */
  measured: number;
  totalDays: number;
  /** Vendas comerciais sem data válida, por motivo. */
  preorder: number;
  unknown: number;
  /** Unidades comerciais vendidas (com e sem data). */
  sold: number;
  /** Saídas por brinde/cortesia (valor 0). */
  brinde: number;
}

const emptyStats = (): TurnoverStats => ({ avgDays: null, measured: 0, totalDays: 0, preorder: 0, unknown: 0, sold: 0, brinde: 0 });

export interface PeriodTurnover extends TurnoverStats {
  byCategory: Record<TurnoverCategory, TurnoverStats>;
}

export const inRange = (date: string, r: DateRange) => date.slice(0, 10) >= r.from && date.slice(0, 10) <= r.to;

/** Partes medidas de uma linha comercial: unidade → data real; lote → FIFO. */
export function linePieces(l: TurnoverLine, fifo: FifoResult): { pieces: Piece[]; preorder: number } {
  if (l.unit) {
    if (!l.entryDate) return { pieces: [{ quantity: l.quantity, days: null, reason: 'untracked' }], preorder: 0 };
    const d = dayDiff(l.soldAt, l.entryDate);
    return d < 0 ? { pieces: [], preorder: l.quantity } : { pieces: [{ quantity: l.quantity, days: d }], preorder: 0 };
  }
  return { pieces: fifo.pieces.get(l.key) ?? [{ quantity: l.quantity, days: null, reason: 'untracked' }], preorder: 0 };
}

export function periodTurnover(lines: TurnoverLine[], fifo: FifoResult, range: DateRange, filter: CategoryFilter = 'all'): PeriodTurnover {
  const total = emptyStats();
  const byCategory = Object.fromEntries(TURNOVER_CATEGORIES.map((c) => [c, emptyStats()])) as Record<TurnoverCategory, TurnoverStats>;
  for (const l of lines) {
    if (l.cancelled || l.quantity <= 0 || !inRange(l.soldAt, range)) continue;
    const cat = turnoverCategoryOf(l.name, l.type);
    if (filter !== 'all' && cat !== filter) continue;
    const targets = [total, byCategory[cat]];
    if (!isCommercial(l)) {
      for (const t of targets) t.brinde += l.quantity;
      continue;
    }
    const { pieces, preorder } = linePieces(l, fifo);
    for (const t of targets) {
      t.sold += l.quantity;
      t.preorder += preorder;
      for (const p of pieces) {
        if (p.days == null) t.unknown += p.quantity;
        else {
          t.measured += p.quantity;
          t.totalDays += p.days * p.quantity;
        }
      }
    }
  }
  for (const t of [total, ...Object.values(byCategory)]) t.avgDays = t.measured > 0 ? t.totalDays / t.measured : null;
  return { ...total, byCategory };
}

export type Trend = 'faster' | 'slower' | 'stable' | 'n/a';

/** Tendência do tempo médio: menos dias = giro mais rápido. ±0,5 dia = estável. */
export function compareTurnover(current: number | null, previous: number | null): { delta: number | null; trend: Trend } {
  if (current == null || previous == null) return { delta: null, trend: 'n/a' };
  const delta = current - previous;
  return { delta, trend: Math.abs(delta) < 0.5 ? 'stable' : delta < 0 ? 'faster' : 'slower' };
}

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------

export type TurnoverPreset = 'last7' | 'last30' | 'month' | 'lastMonth' | 'custom';
export const TURNOVER_PRESET_LABELS: Record<TurnoverPreset, string> = {
  last7: 'Últimos 7 dias',
  last30: 'Últimos 30 dias',
  month: 'Mês atual',
  lastMonth: 'Mês anterior',
  custom: 'Personalizado',
};

export function turnoverRange(preset: TurnoverPreset, today: string, custom?: Partial<DateRange>): DateRange {
  switch (preset) {
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'month':
      return { from: firstDay(monthOf(today)), to: today };
    case 'lastMonth': {
      const m = addMonths(monthOf(today), -1);
      return { from: firstDay(m), to: lastDay(m) };
    }
    case 'custom': {
      const ok = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const from = ok(custom?.from) ? custom!.from! : today;
      const to = ok(custom?.to) ? custom!.to! : from;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** Período anterior de mesmo tamanho (mês anterior para os presets de mês). */
export function previousRange(preset: TurnoverPreset, range: DateRange): DateRange {
  if (preset === 'month' || preset === 'lastMonth') {
    const m = addMonths(monthOf(range.from), -1);
    // Mês atual (parcial) compara com os mesmos dias do mês anterior.
    const to = preset === 'month' ? minDate(addDays(firstDay(m), dayDiff(range.to, range.from)), lastDay(m)) : lastDay(m);
    return { from: firstDay(m), to };
  }
  const len = dayDiff(range.to, range.from) + 1;
  return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
}

const minDate = (a: string, b: string) => (a < b ? a : b);

// ---------------------------------------------------------------------------
// Detalhamento
// ---------------------------------------------------------------------------

export interface ProductTurnover {
  name: string;
  category: TurnoverCategory;
  units: number;
  avgDays: number;
}

/** Produtos com giro mais rápido (agrupados por nome), com mínimo de unidades medidas. */
export function fastestProducts(lines: TurnoverLine[], fifo: FifoResult, range: DateRange, filter: CategoryFilter, minUnits: number, limit = 10): ProductTurnover[] {
  const acc = new Map<string, ProductTurnover & { total: number }>();
  for (const l of lines) {
    if (l.cancelled || !inRange(l.soldAt, range) || !isCommercial(l)) continue;
    const category = turnoverCategoryOf(l.name, l.type);
    if (filter !== 'all' && category !== filter) continue;
    const key = normalizeName(l.name);
    const a = acc.get(key) ?? { name: l.name, category, units: 0, avgDays: 0, total: 0 };
    for (const p of linePieces(l, fifo).pieces) {
      if (p.days == null) continue;
      a.units += p.quantity;
      a.total += p.days * p.quantity;
    }
    acc.set(key, a);
  }
  return [...acc.values()]
    .filter((a) => a.units >= Math.max(1, minUnits))
    .map(({ total, ...a }) => ({ ...a, avgDays: total / a.units }))
    .sort((a, b) => a.avgDays - b.avgDays || b.units - a.units || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, limit);
}

export interface MonthPoint {
  month: string;
  values: Partial<Record<TurnoverCategory | 'all', number | null>>;
  units: Partial<Record<TurnoverCategory | 'all', number>>;
}

/** Tempo médio por mês e categoria (meses de `fromMonth` até o mês de `today`). */
export function monthlyEvolution(lines: TurnoverLine[], fifo: FifoResult, fromMonth: string, today: string): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let m = fromMonth; m <= monthOf(today); m = addMonths(m, 1)) {
    const r = { from: firstDay(m), to: minDate(lastDay(m), today) };
    const t = periodTurnover(lines, fifo, r);
    const point: MonthPoint = { month: m, values: { all: t.avgDays }, units: { all: t.measured } };
    for (const c of TURNOVER_CATEGORIES) {
      point.values[c] = t.byCategory[c].avgDays;
      point.units[c] = t.byCategory[c].measured;
    }
    out.push(point);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Estoque atual (idade das unidades disponíveis)
// ---------------------------------------------------------------------------

export interface StockAgeRow {
  item: StockItem;
  category: TurnoverCategory;
  quantity: number;
  /** Data de entrada das unidades mais antigas com data conhecida. */
  oldestEntry: string | null;
  /** Dias das unidades mais antigas com data conhecida. */
  oldestDays: number | null;
  avgDays: number | null;
  knownUnits: number;
  unknownUnits: number;
  method: 'unit' | 'fifo' | 'untracked';
}

export function stockAgeRows(items: StockItem[], fifo: FifoResult, today: string): StockAgeRow[] {
  return items
    .filter((i) => i.quantity > 0)
    .map((item) => {
      const category = turnoverCategoryOf(item.model ?? item.description, item.mpType);
      if (item.unitTracked) {
        const d = item.entryDate ? dayDiff(today, item.entryDate) : null;
        const known = d != null && d >= 0;
        return {
          item, category, quantity: item.quantity, method: 'unit' as const,
          oldestEntry: known ? item.entryDate!.slice(0, 10) : null, oldestDays: known ? d : null, avgDays: known ? d : null,
          knownUnits: known ? item.quantity : 0, unknownUnits: known ? 0 : item.quantity,
        };
      }
      const lots = fifo.remaining.get(item.id);
      if (!lots) return { item, category, quantity: item.quantity, method: 'untracked' as const, oldestEntry: null, oldestDays: null, avgDays: null, knownUnits: 0, unknownUnits: item.quantity };
      let known = 0;
      let total = 0;
      let oldest: string | null = null;
      for (const lot of lots) {
        if (!lot.entryDate || lot.quantity <= 0) continue;
        known += lot.quantity;
        total += dayDiff(today, lot.entryDate) * lot.quantity;
        if (oldest == null || lot.entryDate < oldest) oldest = lot.entryDate;
      }
      return {
        item, category, quantity: item.quantity, method: 'fifo' as const,
        oldestEntry: oldest, oldestDays: oldest ? dayDiff(today, oldest) : null, avgDays: known > 0 ? total / known : null,
        knownUnits: known, unknownUnits: Math.max(0, item.quantity - known),
      };
    });
}

export interface StockAgeSummary {
  avgDays: number | null;
  knownUnits: number;
  unknownUnits: number;
  byCategory: Record<TurnoverCategory, { avgDays: number | null; knownUnits: number; unknownUnits: number }>;
}

export function summarizeStockAge(rows: StockAgeRow[], filter: CategoryFilter = 'all'): StockAgeSummary {
  const blank = () => ({ avgDays: null as number | null, knownUnits: 0, unknownUnits: 0, total: 0 });
  const all = blank();
  const by = Object.fromEntries(TURNOVER_CATEGORIES.map((c) => [c, blank()])) as Record<TurnoverCategory, ReturnType<typeof blank>>;
  for (const r of rows) {
    if (filter !== 'all' && r.category !== filter) continue;
    for (const t of [all, by[r.category]]) {
      t.knownUnits += r.knownUnits;
      t.unknownUnits += r.unknownUnits;
      if (r.avgDays != null) t.total += r.avgDays * r.knownUnits;
    }
  }
  const fin = (t: ReturnType<typeof blank>) => ({ avgDays: t.knownUnits > 0 ? t.total / t.knownUnits : null, knownUnits: t.knownUnits, unknownUnits: t.unknownUnits });
  return { ...fin(all), byCategory: Object.fromEntries(TURNOVER_CATEGORIES.map((c) => [c, fin(by[c])])) as StockAgeSummary['byCategory'] };
}

/** Saídas do período por motivo. `other` = baixas vistas no estoque além das vendas/brindes do histórico (só produtos rastreados). */
export function exitsBreakdown(lines: TurnoverLine[], movements: StockMovement[], range: DateRange, filter: CategoryFilter = 'all'): { sale: number; brinde: number; other: number | null } {
  let sale = 0;
  let brinde = 0;
  const historyByProduct = new Map<string, number>();
  for (const l of lines) {
    if (l.cancelled || !inRange(l.soldAt, range)) continue;
    const cat = turnoverCategoryOf(l.name, l.type);
    if (filter !== 'all' && cat !== filter) continue;
    if (isCommercial(l)) sale += l.quantity;
    else brinde += l.quantity;
    if (!l.unit) historyByProduct.set(l.productId, (historyByProduct.get(l.productId) ?? 0) + l.quantity);
  }
  const trackingStart = movements.reduce<string | null>((min, m) => (min == null || m.detectedAt < min ? m.detectedAt : min), null);
  if (!trackingStart || trackingStart.slice(0, 10) > range.from) return { sale, brinde, other: null };
  // Categoria do produto pela última leitura com nome (saídas por sumiço da lista vêm sem nome).
  const meta = new Map<string, { name: string | null; type: string | null }>();
  for (const m of movements) if (m.name) meta.set(m.productId, { name: m.name, type: m.type ?? null });
  const exits = new Map<string, number>();
  for (const m of movements) {
    if (m.kind !== 'exit' || !inRange(m.detectedAt, range)) continue;
    const info = meta.get(m.productId);
    if (filter !== 'all' && (!info || turnoverCategoryOf(info.name, info.type) !== filter)) continue;
    exits.set(m.productId, (exits.get(m.productId) ?? 0) + m.quantity);
  }
  let other = 0;
  for (const [productId, q] of exits) other += Math.max(0, q - (historyByProduct.get(productId) ?? 0));
  return { sale, brinde, other };
}
