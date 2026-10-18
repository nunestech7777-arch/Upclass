import React, { useMemo } from 'react';
import { DAY_STATUS_LABEL } from '../../lib/finance/ui';
import {
  CalendarCheck,
  ClipboardList,
  Flag,
  Gauge,
  Percent,
  Smartphone,
  Target,
  TrendingUp,
  Calculator,
} from 'lucide-react';
import {
  financeCategory,
  isActive,
  isReconciled,
  type DayFinance,
  type FinanceCategory,
  type FinanceSale,
  type MonthFinance,
  type SellerFinance,
} from '../../lib/finance/calc';
import { brl, int, pct } from '../../lib/finance/format';
import { dayLabel, formatDateBR } from '../../lib/finance/dates';
import { PaceLabel } from './FinancePrimitives';

// ---------------------------------------------------------------------------
// Indicadores do dia/mês (anexos 06–07, topo)
// ---------------------------------------------------------------------------

function Indicator({ icon, label, value, tone, hint }: { icon: React.ReactNode; label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="fin-indicator">
      <span className="fin-indicator-label">
        {icon}
        {label}
      </span>
      <span className={`fin-indicator-value ${tone ?? ''}`}>{value}</span>
      {hint && <span className="fin-indicator-hint">{hint}</span>}
    </div>
  );
}

export function DailyIndicators({ finance }: { finance: MonthFinance }) {
  const { totals, context: ctx, plan, dailyGoal, daysHit, paceDeviation } = finance;
  const completeDays = finance.days.filter((d) => d.complete).length;
  const deviationLabel = paceDeviation == null ? 'Desvio do ritmo' : paceDeviation >= 0 ? 'Acima do ritmo' : 'Abaixo do ritmo';
  return (
    <div className="fin-indicators">
      <Indicator icon={<Target size={14} />} label="Meta diária" value={dailyGoal != null ? brl(dailyGoal) : 'Sem meta'} tone="tone-goal" hint="Meta do mês ÷ dias do mês" />
      <Indicator
        icon={<TrendingUp size={14} />}
        label="Acumulado"
        value={brl(totals.profit)}
        tone="tone-profit"
        hint={ctx.phase === 'current' ? `Até ontem ${brl(plan.realizedUntilCutoff)} + hoje ${brl(plan.realizedToday)}` : undefined}
      />
      <Indicator
        icon={<Flag size={14} />}
        label={deviationLabel}
        value={paceDeviation == null ? '—' : brl(paceDeviation)}
        tone={paceDeviation == null ? '' : paceDeviation >= 0 ? 'tone-profit' : 'tone-deficit'}
        hint="Acumulado até ontem − esperado"
      />
      <Indicator
        icon={<CalendarCheck size={14} />}
        label="Dias na meta"
        value={dailyGoal != null ? `${int(daysHit)} de ${int(completeDays)}` : '—'}
        hint="Dias completos que atingiram a meta do dia"
      />
      <Indicator
        icon={<Gauge size={14} />}
        label="Necessário por dia"
        value={plan.neededPerDay != null ? brl(plan.neededPerDay) : '—'}
        hint={ctx.phase === 'current' ? `Restante ÷ ${ctx.remainingDays} dia(s), incluindo hoje` : undefined}
      />
      <Indicator icon={<Percent size={14} />} label="% da meta" value={pct(totals.pctTarget)} tone="tone-goal" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plano de ação de hoje (anexos 06–07)
// ---------------------------------------------------------------------------

export function ActionPlanPanel({
  finance,
  rows,
  onOpenSeller,
}: {
  finance: MonthFinance;
  rows: SellerFinance[];
  onOpenSeller: (id: string) => void;
}) {
  const { plan, context: ctx } = finance;
  const D = ctx.daysInMonth;
  const E = ctx.elapsedDays;
  const current = ctx.phase === 'current';

  return (
    <section className="fin-panel fin-plan" aria-label="Plano de ação de hoje">
      <h3 className="fin-panel-title">
        <ClipboardList size={18} className="tone-profit" />
        {current ? 'Plano de ação de hoje' : 'Resumo do plano do mês'}
      </h3>
      <div className="fin-plan-summary">
        <div>
          <span>Projeção</span>
          <strong className={plan.projectionDiff != null && plan.projectionDiff < 0 ? 'tone-deficit' : 'tone-profit'}>
            {plan.projection != null ? brl(plan.projection) : 'Indisponível'}
          </strong>
        </div>
        <div>
          <span>Meta</span>
          <strong className="tone-goal">{plan.goal != null ? brl(plan.goal) : 'Sem meta'}</strong>
        </div>
        <div>
          <span>Diferença projetada</span>
          <strong className={plan.projectionDiff != null && plan.projectionDiff < 0 ? 'tone-deficit' : 'tone-profit'}>
            {plan.projectionDiff != null ? brl(plan.projectionDiff) : '—'}
          </strong>
        </div>
        <div>
          <span>Ritmo atual</span>
          <strong>{plan.pacePerDay != null ? `${brl(plan.pacePerDay)}/dia` : '—'}</strong>
        </div>
        <div>
          <span>Necessário hoje (meta-base)</span>
          <strong>{current && plan.todayBase != null ? brl(plan.todayBase) : '—'}</strong>
          {current && plan.todayGap != null && <em>Falta hoje: {brl(plan.todayGap)}</em>}
        </div>
        <div>
          <span>iPhones equivalentes hoje</span>
          <strong>{plan.devicesEquivalent != null ? int(plan.devicesEquivalent) : '—'}</strong>
          <em>
            {plan.devicesEquivalent != null && plan.avgIphoneProfit != null && plan.baseline
              ? `Lucro médio ${brl(plan.avgIphoneProfit)}/iPhone (${formatDateBR(plan.baseline.from)}–${formatDateBR(plan.baseline.to)})`
              : plan.devicesReason}
          </em>
        </div>
      </div>

      <h4 className="fin-subtitle">Por vendedor</h4>
      <div className="fin-table-wrap">
        <table className="fin-table fin-plan-table">
          <thead>
            <tr>
              <th className="align-left">Vendedor</th>
              <th className="align-right">Realizado</th>
              <th className="align-right">Hoje</th>
              <th className="align-right">Projeção</th>
              <th className="align-right">Meta</th>
              <th className="align-right">Desvio</th>
              <th className="align-right">% da meta</th>
              <th className="align-right">Diferença projetada</th>
              <th className="align-right">Meta de hoje</th>
              <th className="align-right">Falta hoje</th>
              <th className="align-right">iPhones hoje</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const expected = s.target != null && s.target > 0 && ctx.phase !== 'future' ? (s.target * E) / D : null;
              const deviation = expected != null ? s.profitUntilCutoff - expected : null;
              const projDiff = s.projection != null && s.target != null && s.target > 0 ? s.projection - s.target : null;
              return (
                <tr key={s.seller.id} className="is-clickable" onClick={() => onOpenSeller(s.seller.id)}>
                  <td className="align-left">
                    <button
                      type="button"
                      className="fin-link-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSeller(s.seller.id);
                      }}
                    >
                      {s.seller.name}
                    </button>
                  </td>
                  <td className="align-right num">{brl(s.profit)}</td>
                  <td className="align-right num">{current ? brl(s.profitToday) : '—'}</td>
                  <td className={`align-right num ${projDiff == null ? '' : projDiff >= 0 ? 'tone-profit' : 'tone-deficit'}`}>
                    {s.projection != null ? brl(s.projection) : '—'}
                  </td>
                  <td className="align-right num">{s.target != null && s.target > 0 ? brl(s.target) : <span className="fin-muted">Sem meta</span>}</td>
                  <td className={`align-right num ${deviation == null ? '' : deviation >= 0 ? 'tone-profit' : 'tone-deficit'}`}>
                    {deviation != null ? brl(deviation) : '—'}
                  </td>
                  <td className="align-right num">{pct(s.pctTarget)}</td>
                  <td className={`align-right num ${projDiff == null ? '' : projDiff >= 0 ? 'tone-profit' : 'tone-deficit'}`}>
                    {projDiff != null ? brl(projDiff) : '—'}
                  </td>
                  <td className="align-right num tone-goal">
                    {s.goalReached ? <span className="tone-profit">Meta batida</span> : current && s.neededPerDay != null ? brl(s.neededPerDay) : '—'}
                  </td>
                  <td className="align-right num">{current && s.todayGap != null && !s.goalReached ? brl(s.todayGap) : '—'}</td>
                  <td className="align-right num">{current && !s.goalReached && s.devicesToday != null ? int(s.devicesToday) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="fin-plan-guidance">
        <h4 className="fin-subtitle">
          <Calculator size={15} /> Orientações calculadas
        </h4>
        <ul>
          {plan.messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="fin-muted fin-small">
          iPhones equivalentes = teto(falta de hoje ÷ lucro médio por iPhone dos últimos 90 dias). É uma equivalência de lucro: acessórios,
          brindes e a composição das vendas mudam o resultado, e vender essa quantidade não garante a meta. Desvio = lucro até ontem − meta ×
          dias completos ÷ dias do mês.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Linha do tempo do mês (anexo 08)
// ---------------------------------------------------------------------------

export function MonthTimeline({ days, selected, onSelect }: { days: DayFinance[]; selected: string | null; onSelect: (d: string) => void }) {
  return (
    <section className="fin-panel" aria-label="Linha do tempo do mês">
      <h3 className="fin-panel-title">
        <CalendarCheck size={18} className="tone-profit" />
        Linha do tempo do mês
      </h3>
      <div className="fin-timeline" role="list">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            role="listitem"
            className={`fin-day-chip status-${d.status} ${selected === d.date ? 'is-selected' : ''}`}
            onClick={() => !d.isFuture && onSelect(d.date)}
            disabled={d.isFuture}
            title={`${dayLabel(d.date)} — ${DAY_STATUS_LABEL[d.status]}${d.isFuture ? '' : ` · ${brl(d.profit)}`}`}
            aria-label={`${formatDateBR(d.date)}: ${DAY_STATUS_LABEL[d.status]}`}
          >
            {d.day}
          </button>
        ))}
      </div>
      <div className="fin-legend">
        <span className="fin-legend-item">
          <i className="chip status-hit" /> Bateu a meta do dia
        </span>
        <span className="fin-legend-item">
          <i className="chip status-below" /> Abaixo da meta
        </span>
        <span className="fin-legend-item">
          <i className="chip status-today" /> Hoje (em andamento)
        </span>
        <span className="fin-legend-item">
          <i className="chip status-partial" /> Dados parciais
        </span>
        <span className="fin-legend-item">
          <i className="chip status-future" /> Dia futuro
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Resultado dia a dia (anexos 09–10)
// ---------------------------------------------------------------------------

export function DailyResultsTable({ days, selected, onSelect }: { days: DayFinance[]; selected: string | null; onSelect: (d: string) => void }) {
  const rows = days.filter((d) => !d.isFuture).reverse();
  return (
    <section className="fin-panel" aria-label="Resultado dia a dia">
      <h3 className="fin-panel-title">Resultado dia a dia</h3>
      <div className="fin-table-wrap">
        <table className="fin-table fin-daily-table">
          <thead>
            <tr>
              <th className="align-left">Dia</th>
              <th className="align-right">Pedidos</th>
              <th className="align-right">Aparelhos</th>
              <th className="align-right">Acessórios</th>
              <th className="align-right">Faturamento</th>
              <th className="align-right">Custo</th>
              <th className="align-right">Lucro do dia</th>
              <th className="align-right">Meta do dia</th>
              <th className="align-right">% meta do dia</th>
              <th className="align-right">Acumulado</th>
              <th className="align-right">Esperado</th>
              <th className="align-left">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="fin-muted">
                  Nenhum dia decorrido nesta competência.
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr
                key={d.date}
                className={`is-clickable ${selected === d.date ? 'is-selected' : ''}`}
                onClick={() => onSelect(d.date)}
                aria-selected={selected === d.date}
              >
                <td className="align-left strong nowrap">
                  {dayLabel(d.date)}
                  {d.isToday && <span className="fin-tag tone-goal">hoje</span>}
                </td>
                <td className="align-right num">{int(d.orders)}</td>
                <td className="align-right num">{int(d.devices)}</td>
                <td className="align-right num">{int(d.accessories)}</td>
                <td className="align-right num">{brl(d.revenue)}</td>
                <td className="align-right num">{brl(d.cost)}</td>
                <td className={`align-right num strong ${d.profit < 0 ? 'tone-deficit' : 'tone-profit'}`}>
                  {brl(d.profit)}
                  {d.reconciledItems < d.items && <span className="fin-tag tone-warn">parcial</span>}
                </td>
                <td className="align-right num">{brl(d.dailyGoal)}</td>
                <td className="align-right num">{pct(d.pctDailyGoal)}</td>
                <td className="align-right num">{brl(d.cumulative)}</td>
                <td className="align-right num">{brl(d.expectedCumulative)}</td>
                <td className="align-left">
                  <PaceLabel status={d.pace} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fin-muted fin-small fin-table-note">
        “% meta do dia” compara o lucro do dia com a meta diária. “Situação” compara o acumulado com o esperado para o mês até aquele dia.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Vendas do dia por vendedor
// ---------------------------------------------------------------------------

interface DayGroup {
  sellerId: string;
  name: string;
  profit: number;
  byCategory: Record<FinanceCategory, { units: number; profit: number; items: { sale: FinanceSale; name: string }[] }>;
}

export function DayDetail({
  date,
  sales,
  productNames,
  sellerNames,
  onOpenSeller,
}: {
  date: string | null;
  sales: FinanceSale[];
  productNames: Map<string, string>;
  sellerNames: Map<string, string>;
  onOpenSeller: (id: string) => void;
}) {
  const groups = useMemo(() => {
    if (!date) return [];
    const map = new Map<string, DayGroup>();
    for (const s of sales) {
      if (s.sold_date !== date || !isActive(s)) continue;
      const name = productNames.get(s.product_id) ?? 'Produto não identificado';
      const cat = financeCategory(name, s.amount);
      const g =
        map.get(s.seller_id) ??
        ({
          sellerId: s.seller_id,
          name: sellerNames.get(s.seller_id) ?? 'Vendedor não cadastrado',
          profit: 0,
          byCategory: {
            Aparelhos: { units: 0, profit: 0, items: [] },
            Acessórios: { units: 0, profit: 0, items: [] },
            Brindes: { units: 0, profit: 0, items: [] },
          },
        } as DayGroup);
      g.byCategory[cat].units += s.quantity;
      g.byCategory[cat].items.push({ sale: s, name });
      if (isReconciled(s)) {
        g.profit += s.profit!;
        g.byCategory[cat].profit += s.profit!;
      }
      map.set(s.seller_id, g);
    }
    return [...map.values()].sort((a, b) => b.profit - a.profit);
  }, [date, sales, productNames, sellerNames]);

  return (
    <section className="fin-panel" aria-label="Vendas do dia por vendedor" id="fin-day-detail">
      <h3 className="fin-panel-title">Vendas do dia por vendedor{date ? ` · ${dayLabel(date)} (${formatDateBR(date)})` : ''}</h3>
      {!date ? (
        <p className="fin-muted fin-center">Clique em um dia para ver quem vendeu, separando aparelhos, acessórios pagos e brindes.</p>
      ) : groups.length === 0 ? (
        <p className="fin-muted fin-center">Nenhuma venda registrada neste dia.</p>
      ) : (
        <div className="fin-day-groups">
          {groups.map((g) => (
            <article key={g.sellerId} className="fin-day-group">
              <header>
                <button type="button" className="fin-link-btn" onClick={() => onOpenSeller(g.sellerId)}>
                  {g.name}
                </button>
                <strong className={g.profit < 0 ? 'tone-deficit' : 'tone-profit'}>{brl(g.profit)}</strong>
              </header>
              {(['Aparelhos', 'Acessórios', 'Brindes'] as FinanceCategory[]).map((cat) =>
                g.byCategory[cat].items.length === 0 ? null : (
                  <div key={cat} className="fin-day-cat">
                    <span className="fin-day-cat-head">
                      {cat === 'Aparelhos' && <Smartphone size={13} />}
                      {cat === 'Acessórios' ? 'Acessórios pagos' : cat} · {int(g.byCategory[cat].units)} un. · {brl(g.byCategory[cat].profit)}
                    </span>
                    <ul>
                      {g.byCategory[cat].items.map(({ sale, name }) => (
                        <li key={sale.id}>
                          <span>
                            {sale.quantity > 1 ? `${sale.quantity}× ` : ''}
                            {name}
                          </span>
                          <span className="num">
                            {isReconciled(sale) ? (
                              <>
                                {brl(sale.revenue)} − {brl(sale.cost)} = <b className={(sale.profit ?? 0) < 0 ? 'tone-deficit' : 'tone-profit'}>{brl(sale.profit)}</b>
                              </>
                            ) : (
                              <span className="tone-warn">não conciliado</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
