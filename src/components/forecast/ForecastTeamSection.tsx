import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Apple, ArrowDown, Award, ChevronDown, ChevronRight, BarChart3, CalendarClock, CircleDollarSign, Clock, Flag, Gauge, Headphones, Layers, Receipt, Smartphone, Target, TrendingUp, Users } from 'lucide-react';
import { SellerAvatar } from '../SellerAvatar';
import { KpiCard, PctWithBar } from '../finance/FinancePrimitives';
import type { MonthContext } from '../../lib/finance/calc';
import {
  UNIT_COPY,
  VIEW_LABELS,
  VIEW_OPTIONS,
  formatPA,
  isRatioView,
  APPLE_SORT_KEYS,
  ratioSortLabels,
  sortRatioRows,
  type ForecastView,
  type RatioMetric,
  type RatioRow,
  type RatioSortKey,
  forecastSortLabels,
  formatMoney,
  formatMoneyPace,
  formatPace,
  metricCopy,
  projectionNote,
  roundUnits,
  teamPace,
  type ForecastMetric,
  type ForecastSortKey,
  type SellerUnitRow,
  type TeamUnitSummary,
  type UnitKind,
  type AppleType,
  type AppleReviewItem,
} from '../../lib/finance/forecast';
import { REVIEW_LABELS } from '../../lib/finance/appleProducts';
import { int } from '../../lib/finance/format';
import { MonthPicker } from '../finance/MonthPicker';
import type { FinanceSeller } from '../../lib/finance/calc';

export type TeamRow = SellerUnitRow & { name: string; seller: FinanceSeller };

/** Cor do percentual: acompanha o tempo decorrido do mês. */
function pctTone(pct: number | null, ctx: MonthContext): 'profit' | 'warn' | 'deficit' {
  if (pct == null) return 'warn';
  if (pct >= 100) return 'profit';
  const expected = ctx.phase === 'past' ? 100 : (ctx.elapsedDays / ctx.daysInMonth) * 100;
  if (pct >= expected) return 'profit';
  return pct >= expected * 0.75 ? 'warn' : 'deficit';
}

/** "20 aparelhos" / "1 acessório" conforme a categoria. */
const unitLabel = (kind: UnitKind, n: number) => `${int(n)} ${n === 1 ? UNIT_COPY[kind].one : UNIT_COPY[kind].many}`;

/** Valor na métrica: unidades ("20 aparelhos") ou reais ("R$ 1.234,56"). */
const metricLabel = (kind: UnitKind, metric: ForecastMetric, n: number) => (metric === 'revenue' ? formatMoney(n) : unitLabel(kind, n));
/** Número curto (sem unidade) para "vendido / meta". */
const metricShort = (metric: ForecastMetric, n: number) => (metric === 'revenue' ? formatMoney(n) : int(n));
/** Projeção exibida: unidades arredondadas; reais no centavo. */
const shownProjection = (metric: ForecastMetric, v: number) => (metric === 'revenue' ? Math.round(v * 100) / 100 : roundUnits(v));

/** Ritmo necessário na métrica ("2 ap/dia", "1 ac/3 dias", "R$ 350,00/dia"). */
const paceLabel = (kind: UnitKind, metric: ForecastMetric, remaining: number, days: number) =>
  metric === 'revenue' ? formatMoneyPace(remaining, days) : formatPace(remaining, days, UNIT_COPY[kind].abbr);

function projectionCell(kind: UnitKind, metric: ForecastMetric, row: SellerUnitRow, ctx: MonthContext) {
  if (row.projection == null) return <span className="fin-muted" title={projectionNote(ctx)}>—</span>;
  const value = shownProjection(metric, row.projection);
  const tone = row.target == null ? '' : value >= row.target ? 'tone-profit' : 'tone-warn';
  return (
    <span className={`strong ${tone}`} title={projectionNote(ctx)}>
      {metricLabel(kind, metric, value)}
    </span>
  );
}

function remainingCell(kind: UnitKind, metric: ForecastMetric, row: SellerUnitRow) {
  if (row.target == null) return <span className="fin-muted">—</span>;
  if (row.goalReached) return <span className="fc-reached">META ATINGIDA</span>;
  return <span className="strong tone-deficit">{metricLabel(kind, metric, row.remaining!)}</span>;
}

function neededCell(kind: UnitKind, metric: ForecastMetric, row: SellerUnitRow, ctx: MonthContext) {
  if (row.target == null) return <span className="fin-muted">Sem meta</span>;
  if (row.goalReached) return <span className="tone-profit">Meta atingida</span>;
  if (ctx.phase === 'past') return <span className="tone-deficit">Meta não atingida</span>;
  if (ctx.phase !== 'current' || row.neededPerDay == null) return <span className="fin-muted">—</span>;
  return <span>{paceLabel(kind, metric, row.remaining!, ctx.remainingDays)}</span>;
}

/** "+2 hoje" / "+R$ 70,00 hoje"; itens de faturamento ainda não conciliados. */
function soldExtras(metric: ForecastMetric, row: SellerUnitRow) {
  return (
    <>
      {row.soldToday > 0 && <span className="fc-today">+{metric === 'revenue' ? formatMoney(row.soldToday) : row.soldToday} hoje</span>}
      {metric === 'revenue' && row.pendingItems > 0 && (
        <span className="fc-today" title="Itens ainda não conciliados com o histórico do Mercado Phone: entram no faturamento após a sincronização financeira">
          +{row.pendingItems} a conciliar
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export function TeamSummaryCards({ kind, metric, team, ctx, sellersCount }: { kind: UnitKind; metric: ForecastMetric; team: TeamUnitSummary; ctx: MonthContext; sellersCount: number }) {
  const copy = UNIT_COPY[kind];
  const mc = metricCopy(kind, metric);
  const money = metric === 'revenue';
  const projectionValue = team.projection != null ? shownProjection(metric, team.projection) : null;
  const projectionTone = projectionValue == null || team.target == null ? 'neutral' : projectionValue >= team.target ? 'profit' : 'warn';
  const pace = teamPace(team, ctx, kind, metric);
  const show = (n: number) => (money ? formatMoney(n) : int(n));
  return (
    <div className="fc-kpis">
      <KpiCard
        label={mc.soldLabel}
        value={show(team.sold)}
        icon={money ? <CircleDollarSign size={18} /> : kind === 'devices' ? <Smartphone size={18} /> : <Headphones size={18} />}
        tone="profit"
        highlight
        caption={`${sellersCount} vendedor(es) · ${mc.soldHint}${money && team.pendingItems > 0 ? ` · ${int(team.pendingItems)} item(ns) a conciliar fora da soma` : ''}`}
      />
      <KpiCard
        label="Meta total da equipe"
        value={team.target != null ? show(team.target) : 'Sem meta'}
        icon={<Target size={18} />}
        tone="goal"
        caption={team.pct != null ? `${team.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da meta atingida` : money ? `Cadastre as metas de faturamento de ${copy.many}` : `Cadastre as metas de ${copy.many}`}
        progress={team.pct}
      />
      <KpiCard
        label={ctx.phase === 'past' ? 'Fechamento da equipe' : 'Projeção total'}
        value={projectionValue != null ? show(projectionValue) : 'Indisponível'}
        icon={<TrendingUp size={18} />}
        tone={projectionTone}
        caption={projectionNote(ctx)}
      />
      <KpiCard
        label="Faltam para a meta"
        value={team.remaining == null ? '—' : team.remaining === 0 ? 'Meta batida' : money ? formatMoney(team.remaining) : `${int(team.remaining)} ${copy.many}`}
        icon={<Flag size={18} />}
        tone={team.remaining ? 'deficit' : team.remaining === 0 ? 'profit' : 'neutral'}
        caption={team.remaining == null ? 'Sem meta cadastrada' : 'Meta geral − vendido por quem tem meta'}
      />
      <KpiCard
        label="Ritmo necessário"
        value={pace.value}
        icon={<CalendarClock size={18} />}
        tone={pace.state === 'reached' ? 'profit' : pace.state === 'missed' ? 'deficit' : 'neutral'}
        caption={pace.caption}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TableProps {
  kind: UnitKind;
  metric: ForecastMetric;
  rows: TeamRow[];
  team: TeamUnitSummary;
  ctx: MonthContext;
  month: string;
  sortKey: ForecastSortKey;
  onSort: (key: ForecastSortKey) => void;
}

function SortTh({ keys, current, onSort, children, align = 'right' }: { keys: [ForecastSortKey, ForecastSortKey?]; current: ForecastSortKey; onSort: (k: ForecastSortKey) => void; children: React.ReactNode; align?: 'left' | 'right' }) {
  const active = keys.includes(current);
  const next = keys[1] && current === keys[0] ? keys[1] : keys[0];
  return (
    <th className={`align-${align}`} aria-sort={active ? (current === 'soldAsc' || current === 'remainingAsc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`fin-th-btn ${active ? 'is-active' : ''}`} onClick={() => onSort(next)}>
        {children}
        {active && <ArrowDown size={12} />}
      </button>
    </th>
  );
}

export function TeamProjectionTable({ kind, metric, rows, team, ctx, month, sortKey, onSort }: TableProps) {
  const mc = metricCopy(kind, metric);
  const teamProjection = team.projection != null ? shownProjection(metric, team.projection) : null;
  const label = (n: number) => metricLabel(kind, metric, n);
  const short = (n: number) => metricShort(metric, n);
  return (
    <>
      <div className="fin-table-wrap fc-table-desktop">
        <table className="fin-table fc-table">
          <thead>
            <tr>
              <th className="align-left col-rank">#</th>
              <th className="align-left">Vendedor</th>
              <th className="align-right">{mc.goalColumn}</th>
              <SortTh keys={['sold', 'soldAsc']} current={sortKey} onSort={onSort}>{mc.soldColumn}</SortTh>
              <SortTh keys={['projection']} current={sortKey} onSort={onSort}>Projeção até o fim do mês</SortTh>
              <SortTh keys={['remainingAsc', 'remainingDesc']} current={sortKey} onSort={onSort}>{mc.remainingColumn}</SortTh>
              <SortTh keys={['pct']} current={sortKey} onSort={onSort} align="left">% da meta</SortTh>
              <th className="align-right">Ritmo necessário</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sellerId}>
                <td className="col-rank fin-rank">{String(i + 1).padStart(2, '0')}</td>
                <td className="align-left">
                  <Link to={`/vendedores/${r.sellerId}?mes=${month}`} className="fin-seller-cell" title="Abrir relatório do vendedor">
                    <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                    <span className="fin-seller-name">{r.name}</span>
                  </Link>
                </td>
                <td className="align-right num">{r.target != null ? label(r.target) : <span className="fin-muted">Sem meta</span>}</td>
                <td className="align-right num">
                  <span className="strong tone-profit">{label(r.sold)}</span>
                  {soldExtras(metric, r)}
                </td>
                <td className="align-right num">{projectionCell(kind, metric, r, ctx)}</td>
                <td className="align-right num">{remainingCell(kind, metric, r)}</td>
                <td>
                  {r.target != null ? (
                    <div className="fc-pct">
                      <span className="fc-pct-line">
                        {short(r.sold)} / {short(r.target)}
                      </span>
                      <PctWithBar value={r.pct} tone={pctTone(r.pct, ctx)} />
                    </div>
                  ) : (
                    <span className="fin-muted">Sem meta</span>
                  )}
                </td>
                <td className="align-right num">{neededCell(kind, metric, r, ctx)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td />
                <td className="align-left">Total da equipe ({rows.length})</td>
                <td className="align-right num">{team.target != null ? label(team.target) : 'Sem meta'}</td>
                <td className="align-right num tone-profit">{label(team.sold)}</td>
                <td className="align-right num">{teamProjection != null ? label(teamProjection) : '—'}</td>
                <td className="align-right num">{team.remaining == null ? '—' : team.remaining === 0 ? 'META ATINGIDA' : label(team.remaining)}</td>
                <td>
                  <PctWithBar value={team.pct} tone={pctTone(team.pct, ctx)} />
                </td>
                <td className="align-right num">
                  {team.remaining && ctx.phase === 'current' && ctx.remainingDays > 0 ? paceLabel(kind, metric, team.remaining, ctx.remainingDays) : '—'}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="fc-cards fc-cards-mobile">
        {rows.map((r, i) => (
          <article key={r.sellerId} className="fc-card">
            <header>
              <span className="fin-rank">{String(i + 1).padStart(2, '0')}</span>
              <Link to={`/vendedores/${r.sellerId}?mes=${month}`} className="fin-seller-cell">
                <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                <span className="fin-seller-name">{r.name}</span>
              </Link>
            </header>
            <dl>
              <div><dt>Meta</dt><dd>{r.target != null ? label(r.target) : 'Sem meta'}</dd></div>
              <div><dt>{mc.mobileSold}</dt><dd className="tone-profit">{label(r.sold)}{soldExtras(metric, r)}</dd></div>
              <div><dt>Projeção</dt><dd>{projectionCell(kind, metric, r, ctx)}</dd></div>
              <div><dt>{metric === 'revenue' ? 'Falta faturar' : 'Faltam'}</dt><dd>{remainingCell(kind, metric, r)}</dd></div>
              <div><dt>Ritmo necessário</dt><dd>{neededCell(kind, metric, r, ctx)}</dd></div>
              <div className="fc-card-pct"><dt>% da meta</dt><dd>{r.target != null ? <><span className="fc-pct-line">{short(r.sold)} / {short(r.target)}</span><PctWithBar value={r.pct} tone={pctTone(r.pct, ctx)} /></> : 'Sem meta'}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

interface HeaderProps {
  kind: UnitKind;
  onKindChange: (k: UnitKind) => void;
  month: string;
  onMonthChange: (m: string) => void;
  sellers: { id: string; name: string }[];
  sellerFilter: string;
  onSellerChange: (id: string) => void;
  sortKey: ForecastSortKey;
  onSortChange: (k: ForecastSortKey) => void;
  view: ForecastView;
  onViewChange: (v: ForecastView) => void;
  ratioSort: RatioSortKey;
  onRatioSortChange: (k: RatioSortKey) => void;
}

export function TeamFilters({ kind, onKindChange, month, onMonthChange, sellers, sellerFilter, onSellerChange, sortKey, onSortChange, view, onViewChange, ratioSort, onRatioSortChange }: HeaderProps) {
  // Um único dropdown de ordenação: as opções acompanham a métrica escolhida.
  const sortOptions: [string, string][] = isRatioView(view)
    ? Object.entries(ratioSortLabels(view))
    : Object.entries(forecastSortLabels(kind, view)).filter(([k]) => kind !== 'apple' || APPLE_SORT_KEYS.includes(k as ForecastSortKey));
  return (
    <div className="fc-filters">
      <div className="category-tabs fc-kind-tabs" role="group" aria-label="Categoria">
        {(['devices', 'accessories', 'apple'] as UnitKind[]).map((k) => (
          <button key={k} type="button" className={`category-tab ${kind === k ? 'active' : ''}`} aria-pressed={kind === k} onClick={() => onKindChange(k)}>
            {UNIT_COPY[k].tab}
          </button>
        ))}
      </div>
      <MonthPicker month={month} onChange={onMonthChange} allowFuture={1} />
      <label className="fin-sort">
        <Users size={15} />
        <select value={sellerFilter} onChange={(e) => onSellerChange(e.target.value)} aria-label="Filtrar por vendedor">
          <option value="all">Todos os vendedores</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="fin-sort">
        <Gauge size={15} />
        <select
          value={isRatioView(view) ? ratioSort : sortKey}
          onChange={(e) => (isRatioView(view) ? onRatioSortChange(e.target.value as RatioSortKey) : onSortChange(e.target.value as ForecastSortKey))}
          aria-label="Ordenar por"
        >
          {sortOptions.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="fin-sort">
        <BarChart3 size={15} />
        <select value={view} onChange={(e) => onViewChange(e.target.value as ForecastView)} aria-label="Métrica exibida">
          {VIEW_OPTIONS[kind].map((m) => (
            <option key={m} value={m}>
              {VIEW_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acessórios: ticket médio e PA (médias — sem meta, projeção nem ritmo)
// ---------------------------------------------------------------------------

export type RatioTeamRow = RatioRow & { name: string; seller: FinanceSeller };

const ratioValue = (metric: RatioMetric, r: RatioRow) =>
  metric === 'ticket' ? (r.ticket != null ? formatMoney(r.ticket) : '—') : r.pa != null ? `${formatPA(r.pa)} PA` : '—';

export function RatioSummaryCards({ metric, team, rows }: { metric: RatioMetric; team: RatioRow; rows: RatioTeamRow[] }) {
  // Sempre o maior indicador, independentemente da ordenação escolhida na tabela.
  const best = sortRatioRows(rows, metric, 'value').find((r) => (metric === 'ticket' ? r.ticket : r.pa) != null);
  const bestCard = (
    <KpiCard
      label={metric === 'ticket' ? 'Maior ticket médio' : 'Maior PA'}
      value={best ? ratioValue(metric, best) : '—'}
      icon={<Award size={18} />}
      tone="goal"
      caption={best ? `${best.name} · ${int(best.attendances)} atendimento(s)` : 'Nenhum atendimento com acessório pago'}
    />
  );
  const attendancesCard = (
    <KpiCard
      label="Atendimentos válidos"
      value={int(team.attendances)}
      icon={<Users size={18} />}
      tone="neutral"
      caption="Vendas distintas por vendedor com acessório pago (sem brindes)"
    />
  );
  if (metric === 'ticket') {
    return (
      <div className="fc-kpis">
        <KpiCard
          label="Ticket médio da equipe"
          value={team.ticket != null ? formatMoney(team.ticket) : '—'}
          icon={<Receipt size={18} />}
          tone="profit"
          highlight
          caption="Faturamento total ÷ atendimentos totais (não é média dos tickets)"
        />
        <KpiCard
          label="Faturamento conciliado"
          value={formatMoney(team.revenue)}
          icon={<CircleDollarSign size={18} />}
          tone="neutral"
          caption={`Base do ticket · ${int(team.revenueAttendances)} atendimento(s) com todos os acessórios conciliados`}
        />
        {attendancesCard}
        {bestCard}
        <KpiCard
          label="A conciliar"
          value={team.pendingAttendances > 0 ? int(team.pendingAttendances) : 'Nenhum'}
          icon={<Clock size={18} />}
          tone={team.pendingAttendances > 0 ? 'warn' : 'neutral'}
          caption="Atendimentos fora do ticket até a sincronização financeira"
        />
      </div>
    );
  }
  const multiPct = team.attendances > 0 ? (team.multiPiece / team.attendances) * 100 : null;
  return (
    <div className="fc-kpis">
      <KpiCard
        label="PA da equipe"
        value={team.pa != null ? formatPA(team.pa) : '—'}
        icon={<Layers size={18} />}
        tone="profit"
        highlight
        caption="peças/atendimento · peças totais ÷ atendimentos totais"
      />
      <KpiCard label="Acessórios vendidos" value={int(team.units)} icon={<Headphones size={18} />} tone="neutral" caption="Peças pagas (quantidade de cada item)" />
      {attendancesCard}
      {bestCard}
      <KpiCard
        label="Atendimentos com 2+ peças"
        value={int(team.multiPiece)}
        icon={<BarChart3 size={18} />}
        tone="neutral"
        caption={multiPct != null ? `${multiPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% dos atendimentos` : 'Sem atendimentos'}
      />
    </div>
  );
}

function RatioSortTh({ keys, current, onSort, children }: { keys: [RatioSortKey, RatioSortKey?]; current: RatioSortKey; onSort: (k: RatioSortKey) => void; children: React.ReactNode }) {
  const active = keys.includes(current);
  const next = keys[1] && current === keys[0] ? keys[1] : keys[0];
  return (
    <th className="align-right" aria-sort={active ? (current === 'valueAsc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`fin-th-btn ${active ? 'is-active' : ''}`} onClick={() => onSort(next)}>
        {children}
        {active && <ArrowDown size={12} />}
      </button>
    </th>
  );
}

export function RatioTable({ metric, rows, team, month, sortKey, onSort }: { metric: RatioMetric; rows: RatioTeamRow[]; team: RatioRow; month: string; sortKey: RatioSortKey; onSort: (k: RatioSortKey) => void }) {
  const ticket = metric === 'ticket';
  const middle = (r: RatioRow) => (ticket ? formatMoney(r.revenue) : int(r.units));
  const pending = (r: RatioRow) =>
    ticket && r.pendingAttendances > 0 ? (
      <span className="fc-today" title="Atendimentos com acessório ainda não conciliado: entram no ticket após a sincronização financeira">
        +{r.pendingAttendances} a conciliar
      </span>
    ) : null;
  return (
    <>
      <div className="fin-table-wrap fc-table-desktop">
        <table className="fin-table fc-table">
          <thead>
            <tr>
              <th className="align-left col-rank">#</th>
              <th className="align-left">Vendedor</th>
              <RatioSortTh keys={['attendances']} current={sortKey} onSort={onSort}>Atendimentos válidos</RatioSortTh>
              <th className="align-right">{ticket ? 'Faturamento conciliado' : 'Acessórios vendidos'}</th>
              <RatioSortTh keys={['value', 'valueAsc']} current={sortKey} onSort={onSort}>{ticket ? 'Ticket médio' : 'PA realizado'}</RatioSortTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sellerId}>
                <td className="col-rank fin-rank">{String(i + 1).padStart(2, '0')}</td>
                <td className="align-left">
                  <Link to={`/vendedores/${r.sellerId}?mes=${month}`} className="fin-seller-cell" title="Abrir relatório do vendedor">
                    <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                    <span className="fin-seller-name">{r.name}</span>
                  </Link>
                </td>
                <td className="align-right num">{int(r.attendances)}</td>
                <td className="align-right num">{middle(r)}</td>
                <td className="align-right num">
                  <span className={`strong ${(ticket ? r.ticket : r.pa) != null ? 'tone-profit' : 'fin-muted'}`}>{ratioValue(metric, r)}</span>
                  {pending(r)}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td />
                <td className="align-left">Total da equipe ({rows.length})</td>
                <td className="align-right num">{int(team.attendances)}</td>
                <td className="align-right num">{middle(team)}</td>
                <td className="align-right num tone-profit">{ratioValue(metric, team)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="fc-cards fc-cards-mobile">
        {rows.map((r, i) => (
          <article key={r.sellerId} className="fc-card">
            <header>
              <span className="fin-rank">{String(i + 1).padStart(2, '0')}</span>
              <Link to={`/vendedores/${r.sellerId}?mes=${month}`} className="fin-seller-cell">
                <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                <span className="fin-seller-name">{r.name}</span>
              </Link>
            </header>
            <dl>
              <div><dt>{ticket ? 'Ticket médio' : 'PA'}</dt><dd className="tone-profit">{ratioValue(metric, r)}{pending(r)}</dd></div>
              <div><dt>Atendimentos</dt><dd>{int(r.attendances)}</dd></div>
              <div><dt>{ticket ? 'Faturamento' : 'Acessórios'}</dt><dd>{middle(r)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Produtos Apple: tipos identificados automaticamente, por vendedor
// ---------------------------------------------------------------------------


export type AppleTypeRow = { type: AppleType; row: SellerUnitRow };
export type AppleTeamRow = TeamRow & { types: AppleTypeRow[] };

const appleValue = (metric: ForecastMetric, n: number) => (metric === 'revenue' ? formatMoney(n) : `${int(n)} ${n === 1 ? 'unidade' : 'unidades'}`);

export function AppleSummaryCards({
  metric,
  team,
  teamTypes,
  ctx,
  sellersCount,
  reviewCount,
}: {
  metric: ForecastMetric;
  team: TeamUnitSummary;
  teamTypes: { type: AppleType; team: TeamUnitSummary }[];
  ctx: MonthContext;
  sellersCount: number;
  reviewCount: number;
}) {
  const money = metric === 'revenue';
  const show = (n: number) => (money ? formatMoney(n) : int(n));
  const iphone = teamTypes.find((t) => t.type === 'iPhone')?.team.sold ?? 0;
  const others = teamTypes.filter((t) => t.type !== 'iPhone');
  const othersTotal = money ? others.reduce((a, t) => a + Math.round(t.team.sold * 100), 0) / 100 : others.reduce((a, t) => a + t.team.sold, 0);
  const share = (v: number) => (team.sold > 0 ? ` · ${((v / team.sold) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do total` : '');
  return (
    <div className="fc-kpis">
      <KpiCard
        label={money ? 'Faturamento Apple' : 'Produtos Apple vendidos'}
        value={show(team.sold)}
        icon={<Apple size={18} />}
        tone="profit"
        highlight
        caption={`${sellersCount} vendedor(es) · ${teamTypes.length} tipo(s)${money && team.pendingItems > 0 ? ` · ${int(team.pendingItems)} item(ns) a conciliar fora da soma` : ''}`}
      />
      <KpiCard
        label={ctx.phase === 'past' ? 'Fechamento da equipe' : 'Projeção total'}
        value={team.projection != null ? show(money ? Math.round(team.projection * 100) / 100 : roundUnits(team.projection)) : 'Indisponível'}
        icon={<TrendingUp size={18} />}
        tone="neutral"
        caption={projectionNote(ctx)}
      />
      <KpiCard label="iPhone" value={show(iphone)} icon={<Smartphone size={18} />} tone="neutral" caption={`Mesma regra da aba Aparelhos${share(iphone)}`} />
      <KpiCard
        label="Outros produtos Apple"
        value={show(othersTotal)}
        icon={<Layers size={18} />}
        tone="neutral"
        caption={others.length > 0 ? others.map((t) => `${t.type} ${show(t.team.sold)}`).join(' · ') : 'Nenhum além de iPhone no período'}
      />
      <KpiCard
        label="Para revisão"
        value={reviewCount > 0 ? int(reviewCount) : 'Nenhum'}
        icon={<AlertTriangle size={18} />}
        tone={reviewCount > 0 ? 'warn' : 'neutral'}
        caption="Itens que o sistema não classificou por segurança (lista abaixo da tabela)"
      />
    </div>
  );
}

/** Faixa com o total da equipe em cada tipo identificado. */
export function AppleTypeStrip({ metric, teamTypes }: { metric: ForecastMetric; teamTypes: { type: AppleType; team: TeamUnitSummary }[] }) {
  if (teamTypes.length === 0) return null;
  return (
    <ul className="fc-type-strip" aria-label="Produtos Apple por tipo">
      {teamTypes.map((t) => (
        <li key={t.type}>
          <span className="fc-type-name">{t.type}</span>
          <strong>{appleValue(metric, t.team.sold)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function AppleTable({
  metric,
  rows,
  team,
  ctx,
  month,
  sortKey,
  onSort,
}: {
  metric: ForecastMetric;
  rows: AppleTeamRow[];
  team: TeamUnitSummary;
  ctx: MonthContext;
  month: string;
  sortKey: ForecastSortKey;
  onSort: (k: ForecastSortKey) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const money = metric === 'revenue';
  const projection = (r: { projection: number | null }) =>
    r.projection == null ? <span className="fin-muted" title={projectionNote(ctx)}>—</span> : <span title={projectionNote(ctx)}>{appleValue(metric, money ? Math.round(r.projection * 100) / 100 : roundUnits(r.projection))}</span>;
  const typeChips = (r: AppleTeamRow) =>
    r.types.length === 0 ? (
      <span className="fin-muted">Nenhum</span>
    ) : (
      <span className="fc-type-chips">
        {r.types.map((t) => (
          <span key={t.type} className="fc-type-chip">
            {t.type} <b>{money ? formatMoney(t.row.sold) : int(t.row.sold)}</b>
          </span>
        ))}
      </span>
    );
  return (
    <>
      <div className="fin-table-wrap fc-table-desktop">
        <table className="fin-table fc-table">
          <thead>
            <tr>
              <th className="align-left col-rank">#</th>
              <th className="align-left">Vendedor</th>
              <th className="align-left">Tipo de produto</th>
              <SortTh keys={['sold', 'soldAsc']} current={sortKey} onSort={onSort}>{money ? 'Faturamento realizado' : 'Produtos Apple vendidos'}</SortTh>
              <SortTh keys={['projection']} current={sortKey} onSort={onSort}>Projeção até o fim do mês</SortTh>
              <th className="align-right" aria-label="Detalhar" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const expandable = r.types.length > 0;
              const isOpen = open.has(r.sellerId);
              return (
                <React.Fragment key={r.sellerId}>
                  <tr className={isOpen ? 'is-selected' : ''}>
                    <td className="col-rank fin-rank">{String(i + 1).padStart(2, '0')}</td>
                    <td className="align-left">
                      <Link to={`/vendedores/${r.sellerId}?mes=${month}`} className="fin-seller-cell" title="Abrir relatório do vendedor">
                        <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                        <span className="fin-seller-name">{r.name}</span>
                      </Link>
                    </td>
                    <td className="align-left">{typeChips(r)}</td>
                    <td className="align-right num">
                      <span className="strong tone-profit">{appleValue(metric, r.sold)}</span>
                      {soldExtras(metric, r)}
                    </td>
                    <td className="align-right num">{projection(r)}</td>
                    <td className="align-right">
                      {expandable && (
                        <button
                          type="button"
                          className="fin-icon-btn"
                          onClick={() => toggle(r.sellerId)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Recolher' : 'Ver'} distribuição por tipo de ${r.name}`}
                        >
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen &&
                    r.types.map((t) => (
                      <tr key={`${r.sellerId}-${t.type}`} className="fc-subrow">
                        <td />
                        <td className="align-left fin-muted">↳ {r.name}</td>
                        <td className="align-left">
                          <span className="fc-type-chip">{t.type}</span>
                        </td>
                        <td className="align-right num">
                          {appleValue(metric, t.row.sold)}
                          {soldExtras(metric, t.row)}
                        </td>
                        <td className="align-right num">{projection(t.row)}</td>
                        <td />
                      </tr>
                    ))}
                </React.Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td />
                <td className="align-left">Total da equipe ({rows.length})</td>
                <td />
                <td className="align-right num tone-profit">{appleValue(metric, team.sold)}</td>
                <td className="align-right num">{projection(team)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="fc-cards fc-cards-mobile">
        {rows.map((r, i) => (
          <article key={r.sellerId} className="fc-card">
            <header>
              <span className="fin-rank">{String(i + 1).padStart(2, '0')}</span>
              <Link to={`/vendedores/${r.sellerId}?mes=${month}`} className="fin-seller-cell">
                <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                <span className="fin-seller-name">{r.name}</span>
              </Link>
            </header>
            <dl>
              <div><dt>{money ? 'Faturado' : 'Vendidos'}</dt><dd className="tone-profit">{appleValue(metric, r.sold)}{soldExtras(metric, r)}</dd></div>
              <div><dt>Projeção</dt><dd>{projection(r)}</dd></div>
              <div className="fc-card-pct">
                <dt>Tipo de produto</dt>
                <dd>{typeChips(r)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}

export function AppleReviewPanel({ items, sellerName }: { items: AppleReviewItem[]; sellerName: (id: string) => string }) {
  if (items.length === 0) return null;
  return (
    <details className="fc-review">
      <summary>
        <AlertTriangle size={15} /> {items.length} produto(s) para revisão — não foram classificados automaticamente e não entram em Produtos Apple
      </summary>
      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th className="align-left">Produto (nome no Mercado Phone)</th>
              <th className="align-left">Motivo</th>
              <th className="align-left">Parece</th>
              <th className="align-right">Unidades</th>
              <th className="align-right">Valor pago</th>
              <th className="align-left">Vendedor(es)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={`${it.name}-${it.reason}`}>
                <td className="align-left"><strong>{it.name || '(sem nome)'}</strong></td>
                <td className="align-left fin-small">{REVIEW_LABELS[it.reason]}</td>
                <td className="align-left fin-small">{it.suggested ?? '—'}</td>
                <td className="align-right num">{int(it.units)}</td>
                <td className="align-right num">{formatMoney(it.amount)}</td>
                <td className="align-left fin-small">{it.sellerIds.map(sellerName).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fin-muted fin-small">
        Estes itens seguem a regra anterior do Forecast (contam em Acessórios quando pagos). Para que sejam reconhecidos, corrija o nome do produto no Mercado Phone
        (ex.: “iPhone 15 Plus…”, “MacBook Air…”).
      </p>
    </details>
  );
}
