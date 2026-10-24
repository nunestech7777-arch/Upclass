/**
 * Painel do Vendedor — regras dos cards, fora dos componentes (testadas em sellerPortal.test.ts).
 *
 * - Semana da loja: segunda a domingo, datas comerciais no fuso da loja (dashboard.ts weekRangeOf).
 * - Aparelhos vendidos = UNIDADES de iPhone (productClassifier) dos itens do próprio vendedor
 *   (vendedor do item), sem itens cancelados. Uma linha com quantidade 2 conta 2.
 * - Meta: semanal, cadastrada pelo administrador por semana. Só se aplica a um período que seja
 *   exatamente uma semana; em outros períodos não existe equivalência (nada é inventado).
 * - Projeção (mesma regra do Forecast): vendidos até ontem ÷ dias completos × 7, nunca abaixo do já
 *   vendido. Semana encerrada: resultado realizado (sem projeção). 1º dia / semana futura: indisponível.
 * - Faltam = max(0, meta − vendidos). Ritmo = faltam ÷ dias restantes (hoje incluso), em inteiros.
 */
import { addDays } from './finance/dates.ts';
import { daysBetween, presetRange, weekRangeOf, type DateRange } from './finance/dashboard.ts';
import { isDeviceProduct } from './productClassifier.ts';

export type PortalPreset = 'week' | 'lastWeek' | 'custom';

export const PORTAL_PRESET_LABELS: Record<PortalPreset, string> = {
  week: 'Semana atual',
  lastWeek: 'Semana anterior',
  custom: 'Personalizado',
};

/** Linha de `seller_portal_sales` (só campos autorizados ao vendedor). */
export interface PortalSale {
  id: string;
  sold_at: string;
  sold_date: string;
  mp_order_id: string | null;
  product_name: string | null;
  quantity: number;
  amount: number | string;
  item_status: 'active' | 'cancelled' | string;
}

export interface PortalGoal {
  week_start: string;
  device_target: number;
}

export function portalRange(preset: PortalPreset, today: string, custom?: Partial<DateRange>): DateRange {
  return presetRange(preset, today, custom);
}

/** Período é exatamente uma semana da loja (segunda → domingo)? */
export function isFullWeek(range: DateRange): boolean {
  const w = weekRangeOf(range.from);
  return w.from === range.from && w.to === range.to;
}

export interface WeekContext {
  phase: 'past' | 'current' | 'future';
  /** Dias completos decorridos (até ontem); 7 se encerrada. */
  elapsedDays: number;
  /** Dias restantes, hoje incluso. */
  remainingDays: number;
  /** Último dia completo usado na projeção (null se nenhum). */
  cutoffDate: string | null;
}

export function buildWeekContext(weekStart: string, today: string): WeekContext {
  const weekEnd = addDays(weekStart, 6);
  if (weekEnd < today) return { phase: 'past', elapsedDays: 7, remainingDays: 0, cutoffDate: weekEnd };
  if (weekStart > today) return { phase: 'future', elapsedDays: 0, remainingDays: 7, cutoffDate: null };
  const elapsed = daysBetween({ from: weekStart, to: today }) - 1;
  return { phase: 'current', elapsedDays: elapsed, remainingDays: 7 - elapsed, cutoffDate: elapsed > 0 ? addDays(today, -1) : null };
}

export const isCountedItem = (s: Pick<PortalSale, 'item_status'>) => s.item_status === 'active';
export const isDeviceItem = (s: Pick<PortalSale, 'product_name'>) => isDeviceProduct(s.product_name);

/** Unidades de iPhone vendidas (total e até o corte da projeção). */
export function countDeviceUnits(sales: PortalSale[], cutoffDate: string | null = null): { sold: number; untilCutoff: number } {
  let sold = 0;
  let untilCutoff = 0;
  for (const s of sales) {
    if (!isCountedItem(s) || !isDeviceItem(s)) continue;
    const q = Number(s.quantity) || 0;
    sold += q;
    if (cutoffDate && s.sold_date <= cutoffDate) untilCutoff += q;
  }
  return { sold, untilCutoff };
}

const units = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'aparelho' : 'aparelhos'}`;

/**
 * Ritmo necessário em inteiros, a partir dos totais exatos (mesma conta de `formatPace` do Forecast):
 *   ≥ 1 por dia → "N aparelhos por dia" (teto); < 1 por dia → "1 aparelho a cada X dias" (piso).
 */
export function formatPaceWords(remaining: number, days: number): string | null {
  if (!(remaining > 0) || !(days > 0)) return null;
  const eps = 1e-9;
  if (remaining >= days - eps) return `${units(Math.ceil(remaining / days - eps))} por dia`;
  const every = Math.floor(days / remaining + eps);
  return every <= 1 ? '1 aparelho por dia' : `1 aparelho a cada ${every} dias`;
}

export interface PortalSummary {
  range: DateRange;
  weekly: boolean;
  ctx: WeekContext | null;
  sold: number;
  goal: number | null;
  goalNote: string;
  /** 0–100+ (pode passar de 100); null sem meta. */
  progressPct: number | null;
  projection: { value: number | null; kind: 'estimate' | 'final' | 'unavailable'; note: string };
  remaining: { value: number | null; reached: boolean };
  pace: { text: string; caption: string; active: boolean };
}

export function buildPortalSummary(range: DateRange, today: string, sales: PortalSale[], goals: PortalGoal[]): PortalSummary {
  const weekly = isFullWeek(range);
  const ctx = weekly ? buildWeekContext(range.from, today) : null;
  const { sold, untilCutoff } = countDeviceUnits(sales, ctx?.cutoffDate ?? null);
  const goalRow = weekly ? goals.find((g) => g.week_start === range.from) : undefined;
  const goal = goalRow && goalRow.device_target > 0 ? goalRow.device_target : null;
  const goalNote = !weekly
    ? 'Metas são semanais: escolha uma semana completa (segunda a domingo) para ver a meta.'
    : goal == null
      ? 'Nenhuma meta cadastrada para esta semana.'
      : 'Meta semanal de aparelhos definida pela gestão.';

  let projection: PortalSummary['projection'];
  if (!ctx) projection = { value: null, kind: 'unavailable', note: 'Projeção disponível apenas para semanas completas.' };
  else if (ctx.phase === 'future') projection = { value: null, kind: 'unavailable', note: 'Semana ainda não começou.' };
  else if (ctx.phase === 'past') projection = { value: sold, kind: 'final', note: 'Semana encerrada: resultado realizado.' };
  else if (ctx.elapsedDays <= 0) projection = { value: null, kind: 'unavailable', note: 'Disponível a partir de terça (precisa de 1 dia completo de vendas).' };
  else
    projection = {
      value: Math.max(sold, (untilCutoff / ctx.elapsedDays) * 7),
      kind: 'estimate',
      // Sem texto no card: o selo "Estimativa" e o "≈" no valor já indicam que é projeção.
      note: '',
    };

  const remainingValue = goal == null ? null : Math.max(0, goal - sold);
  const reached = goal != null && sold >= goal;

  let pace: PortalSummary['pace'];
  if (goal == null) pace = { text: 'Sem meta definida', caption: weekly ? 'Sem meta, sem ritmo necessário.' : 'Disponível apenas para semanas completas.', active: false };
  else if (reached) pace = { text: 'Meta atingida', caption: 'Nenhum aparelho a mais é necessário.', active: false };
  else if (ctx!.phase === 'past') pace = { text: 'Semana encerrada', caption: 'Não há mais dias para vender nesta semana.', active: false };
  else if (ctx!.phase === 'future') pace = { text: 'Semana não iniciada', caption: `Meta de ${units(goal)} a partir de segunda.`, active: false };
  else
    pace = {
      text: formatPaceWords(remainingValue!, ctx!.remainingDays)!,
      caption: `Faltam ${units(remainingValue!)} em ${ctx!.remainingDays} dia(s), contando hoje.`,
      active: true,
    };

  return {
    range,
    weekly,
    ctx,
    sold,
    goal,
    goalNote,
    progressPct: goal == null ? null : (sold / goal) * 100,
    projection,
    remaining: { value: remainingValue, reached },
    pace,
  };
}

export interface PortalOrder {
  key: string;
  orderId: string | null;
  soldAt: string;
  items: PortalSale[];
  units: number;
  total: number;
  cancelled: boolean;
}

/** Agrupa os itens DO VENDEDOR por pedido (os de outros vendedores nunca chegam aqui). */
export function groupByOrder(sales: PortalSale[]): PortalOrder[] {
  const map = new Map<string, PortalOrder>();
  for (const s of sales) {
    const key = s.mp_order_id ?? `item:${s.id}`;
    const o = map.get(key) ?? { key, orderId: s.mp_order_id, soldAt: s.sold_at, items: [], units: 0, total: 0, cancelled: true };
    o.items.push(s);
    if (isCountedItem(s)) {
      o.units += Number(s.quantity) || 0;
      o.total = Math.round((o.total + (Number(s.amount) || 0)) * 100) / 100;
      o.cancelled = false;
    }
    if (s.sold_at > o.soldAt) o.soldAt = s.sold_at;
    map.set(key, o);
  }
  return [...map.values()].sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0));
}

export const ITEM_STATUS_LABELS: Record<string, string> = { active: 'Concluída', cancelled: 'Cancelada' };
