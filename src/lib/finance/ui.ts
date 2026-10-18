import type { DayStatus, MonthContext, SellerFinance } from './calc.ts';
import { formatDateBR } from './dates.ts';

/** Tom do avanço da meta comparado ao esperado pelo tempo decorrido do mês. */
export function attainmentTone(pctValue: number | null, ctx: MonthContext): 'profit' | 'warn' | 'deficit' {
  if (pctValue == null) return 'warn';
  if (pctValue >= 100) return 'profit';
  const expected = ctx.phase === 'past' ? 100 : (ctx.elapsedDays / ctx.daysInMonth) * 100;
  if (pctValue >= expected) return 'profit';
  return pctValue >= expected * 0.75 ? 'warn' : 'deficit';
}

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  hit: 'Bateu a meta do dia',
  below: 'Abaixo da meta do dia',
  today: 'Hoje — em andamento',
  future: 'Dia futuro',
  partial: 'Dados parciais',
  no_goal: 'Sem meta cadastrada',
};

export function cutoffCaption(ctx: MonthContext): string {
  if (ctx.phase === 'past') return 'Mês encerrado';
  if (ctx.phase === 'future') return 'Mês futuro';
  return ctx.cutoffDate ? `Ritmo calculado até ${formatDateBR(ctx.cutoffDate)} (dias completos)` : 'Primeiro dia do mês: sem dias completos';
}

export type RankingSortKey =
  | 'profit'
  | 'target'
  | 'pctTarget'
  | 'pctWorst'
  | 'gap'
  | 'revenue'
  | 'margin'
  | 'orders'
  | 'devices'
  | 'avgIphoneProfit'
  | 'name';

export const SORT_LABELS: Record<RankingSortKey, string> = {
  profit: 'Lucro realizado',
  target: 'Meta (lucro)',
  pctTarget: '% da meta',
  pctWorst: '% do pior cenário',
  gap: 'Falta para a meta',
  revenue: 'Faturamento',
  margin: 'Margem',
  orders: 'Pedidos',
  devices: 'Aparelhos',
  avgIphoneProfit: 'Lucro médio por iPhone',
  name: 'Nome',
};

export function sortSellers(rows: SellerFinance[], key: RankingSortKey): SellerFinance[] {
  const value = (s: SellerFinance): number | string | null =>
    key === 'name' ? s.seller.name : key === 'devices' ? s.devices : (s[key] as number | null);
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb);
    if (va == null && vb == null) return b.profit - a.profit;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (vb as number) - (va as number) || b.profit - a.profit;
  });
}

