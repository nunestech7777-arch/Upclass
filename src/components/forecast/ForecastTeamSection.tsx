import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, CalendarClock, Flag, Gauge, Headphones, Smartphone, Target, TrendingUp, Users } from 'lucide-react';
import { SellerAvatar } from '../SellerAvatar';
import { KpiCard, PctWithBar } from '../finance/FinancePrimitives';
import type { MonthContext } from '../../lib/finance/calc';
import { UNIT_COPY, forecastSortLabels, formatPace, projectionNote, roundUnits, teamPace, type ForecastSortKey, type SellerUnitRow, type TeamUnitSummary, type UnitKind } from '../../lib/finance/forecast';
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

function projectionCell(kind: UnitKind, row: SellerUnitRow, ctx: MonthContext) {
  if (row.projection == null) return <span className="fin-muted" title={projectionNote(ctx)}>—</span>;
  const value = roundUnits(row.projection);
  const tone = row.target == null ? '' : value >= row.target ? 'tone-profit' : 'tone-warn';
  return (
    <span className={`strong ${tone}`} title={projectionNote(ctx)}>
      {unitLabel(kind, value)}
    </span>
  );
}

function remainingCell(kind: UnitKind, row: SellerUnitRow) {
  if (row.target == null) return <span className="fin-muted">—</span>;
  if (row.goalReached) return <span className="fc-reached">META ATINGIDA</span>;
  return <span className="strong tone-deficit">{unitLabel(kind, row.remaining!)}</span>;
}

function neededCell(kind: UnitKind, row: SellerUnitRow, ctx: MonthContext) {
  if (row.target == null) return <span className="fin-muted">—</span>;
  if (row.goalReached) return <span className="tone-profit">Meta atingida</span>;
  if (ctx.phase !== 'current' || row.neededPerDay == null) return <span className="fin-muted">—</span>;
  return <span>{formatPace(row.remaining!, ctx.remainingDays, UNIT_COPY[kind].abbr)}</span>;
}

// ---------------------------------------------------------------------------

export function TeamSummaryCards({ kind, team, ctx, sellersCount }: { kind: UnitKind; team: TeamUnitSummary; ctx: MonthContext; sellersCount: number }) {
  const copy = UNIT_COPY[kind];
  const projectionValue = team.projection != null ? roundUnits(team.projection) : null;
  const projectionTone = projectionValue == null || team.target == null ? 'neutral' : projectionValue >= team.target ? 'profit' : 'warn';
  const pace = teamPace(team, ctx, kind);
  return (
    <div className="fc-kpis">
      <KpiCard
        label={copy.soldLabel}
        value={int(team.sold)}
        icon={kind === 'devices' ? <Smartphone size={18} /> : <Headphones size={18} />}
        tone="profit"
        highlight
        caption={`${sellersCount} vendedor(es) · ${copy.soldHint}`}
      />
      <KpiCard
        label="Meta total da equipe"
        value={team.target != null ? int(team.target) : 'Sem meta'}
        icon={<Target size={18} />}
        tone="goal"
        caption={team.pct != null ? `${team.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da meta atingida` : `Cadastre as metas de ${copy.many}`}
        progress={team.pct}
      />
      <KpiCard
        label={ctx.phase === 'past' ? 'Fechamento da equipe' : 'Projeção total'}
        value={projectionValue != null ? int(projectionValue) : 'Indisponível'}
        icon={<TrendingUp size={18} />}
        tone={projectionTone}
        caption={projectionNote(ctx)}
      />
      <KpiCard
        label="Faltam para a meta"
        value={team.remaining == null ? '—' : team.remaining === 0 ? 'Meta batida' : `${int(team.remaining)} ${copy.many}`}
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
    <th className={`align-${align}`} aria-sort={active ? 'descending' : 'none'}>
      <button type="button" className={`fin-th-btn ${active ? 'is-active' : ''}`} onClick={() => onSort(next)}>
        {children}
        {active && <ArrowDown size={12} />}
      </button>
    </th>
  );
}

export function TeamProjectionTable({ kind, rows, team, ctx, month, sortKey, onSort }: TableProps) {
  const copy = UNIT_COPY[kind];
  const teamProjection = team.projection != null ? roundUnits(team.projection) : null;
  return (
    <>
      <div className="fin-table-wrap fc-table-desktop">
        <table className="fin-table fc-table">
          <thead>
            <tr>
              <th className="align-left col-rank">#</th>
              <th className="align-left">Vendedor</th>
              <th className="align-right">{copy.goalLabel}</th>
              <SortTh keys={['sold']} current={sortKey} onSort={onSort}>{copy.soldLabel}</SortTh>
              <SortTh keys={['projection']} current={sortKey} onSort={onSort}>Projeção até o fim do mês</SortTh>
              <SortTh keys={['remainingAsc', 'remainingDesc']} current={sortKey} onSort={onSort}>Faltam vender</SortTh>
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
                <td className="align-right num">{r.target != null ? unitLabel(kind, r.target) : <span className="fin-muted">Sem meta</span>}</td>
                <td className="align-right num">
                  <span className="strong tone-profit">{unitLabel(kind, r.sold)}</span>
                  {r.soldToday > 0 && <span className="fc-today">+{r.soldToday} hoje</span>}
                </td>
                <td className="align-right num">{projectionCell(kind, r, ctx)}</td>
                <td className="align-right num">{remainingCell(kind, r)}</td>
                <td>
                  {r.target != null ? (
                    <div className="fc-pct">
                      <span className="fc-pct-line">
                        {int(r.sold)} / {int(r.target)}
                      </span>
                      <PctWithBar value={r.pct} tone={pctTone(r.pct, ctx)} />
                    </div>
                  ) : (
                    <span className="fin-muted">Sem meta</span>
                  )}
                </td>
                <td className="align-right num">{neededCell(kind, r, ctx)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td />
                <td className="align-left">Total da equipe ({rows.length})</td>
                <td className="align-right num">{team.target != null ? unitLabel(kind, team.target) : 'Sem meta'}</td>
                <td className="align-right num tone-profit">{unitLabel(kind, team.sold)}</td>
                <td className="align-right num">{teamProjection != null ? unitLabel(kind, teamProjection) : '—'}</td>
                <td className="align-right num">{team.remaining == null ? '—' : team.remaining === 0 ? 'META ATINGIDA' : unitLabel(kind, team.remaining)}</td>
                <td>
                  <PctWithBar value={team.pct} tone={pctTone(team.pct, ctx)} />
                </td>
                <td className="align-right num">
                  {team.remaining && ctx.phase === 'current' && ctx.remainingDays > 0 ? formatPace(team.remaining, ctx.remainingDays, copy.abbr) : '—'}
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
              <div><dt>Meta</dt><dd>{r.target != null ? unitLabel(kind, r.target) : 'Sem meta'}</dd></div>
              <div><dt>Vendidos</dt><dd className="tone-profit">{unitLabel(kind, r.sold)}{r.soldToday > 0 ? ` (+${r.soldToday} hoje)` : ''}</dd></div>
              <div><dt>Projeção</dt><dd>{projectionCell(kind, r, ctx)}</dd></div>
              <div><dt>Faltam</dt><dd>{remainingCell(kind, r)}</dd></div>
              <div><dt>Ritmo necessário</dt><dd>{neededCell(kind, r, ctx)}</dd></div>
              <div className="fc-card-pct"><dt>% da meta</dt><dd>{r.target != null ? <><span className="fc-pct-line">{int(r.sold)} / {int(r.target)}</span><PctWithBar value={r.pct} tone={pctTone(r.pct, ctx)} /></> : 'Sem meta'}</dd></div>
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
}

export function TeamFilters({ kind, onKindChange, month, onMonthChange, sellers, sellerFilter, onSellerChange, sortKey, onSortChange }: HeaderProps) {
  const labels = forecastSortLabels(kind);
  return (
    <div className="fc-filters">
      <div className="category-tabs fc-kind-tabs" role="group" aria-label="Categoria">
        {(['devices', 'accessories'] as UnitKind[]).map((k) => (
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
        <select value={sortKey} onChange={(e) => onSortChange(e.target.value as ForecastSortKey)} aria-label="Ordenar por">
          {(Object.keys(labels) as ForecastSortKey[]).map((k) => (
            <option key={k} value={k}>
              {labels[k]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
