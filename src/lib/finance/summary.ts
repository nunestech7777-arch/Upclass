import type { MonthFinance } from './calc.ts';
import { brl, int, pct } from './format.ts';
import { formatDateBR, monthLabel } from './dates.ts';

/** Texto do "Copiar resumo": só copia, nunca envia. */
export function buildSummaryText(finance: MonthFinance, visibleOnly: boolean): string {
  const { context: ctx, totals, coverage, plan } = finance;
  const lines = [
    `Resultado financeiro — ${monthLabel(ctx.month)}`,
    `Data de corte: ${ctx.phase === 'current' ? `${formatDateBR(ctx.cutoffDate)} (dias completos) + hoje em andamento` : ctx.phase === 'past' ? 'mês encerrado' : 'mês futuro'}`,
    `Cobertura: ${int(coverage.reconciled)} de ${int(coverage.items)} itens conciliados${coverage.complete ? '' : ' (RESULTADO PARCIAL)'}`,
    `Lucro comercial: ${brl(totals.profit)}`,
    `Meta: ${brl(totals.target, 'sem metas cadastradas')}${totals.pctTarget != null ? ` (${pct(totals.pctTarget)})` : ''}`,
    `Saldo para a meta: ${brl(totals.gap)}`,
    `Projeção: ${plan.projection != null ? brl(plan.projection) : ctx.phase === 'past' ? 'mês encerrado' : 'indisponível'}`,
    '',
    visibleOnly ? 'Ranking (vendedores visíveis):' : 'Ranking:',
  ];
  return lines.join('\n');
}

