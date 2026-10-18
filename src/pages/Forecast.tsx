import React, { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ShoppingBag, Smartphone, Headphones, AlertTriangle } from 'lucide-react';
import './Forecast.css';
import '../components/finance/finance.css';
import { useTheme } from '../context/ThemeContext';
import { buildContext } from '../lib/finance/calc';
import { formatInstantBR, monthLabel } from '../lib/finance/dates';
import {
  buildCategoryForecast,
  buildSellerRow,
  countByCategory,
  countUnitsBySeller,
  formatPerDay,
  roundUnits,
  sortUnitRows,
  summarizeTeam,
  type CategoryForecast,
  type ForecastSortKey,
  type UnitKind,
  UNIT_COPY,
} from '../lib/finance/forecast';
import type { ForecastData } from '../lib/finance/financeApi';
import { useFinanceParams, useFinanceSource } from '../components/finance/useFinance';
import { EmptyState, SectionEyebrow } from '../components/finance/FinancePrimitives';
import { TeamFilters, TeamProjectionTable, TeamSummaryCards, type TeamRow } from '../components/forecast/ForecastTeamSection';
import { Link } from 'react-router-dom';

type CategoryFilter = 'all' | 'devices' | 'accessories';

export function Forecast() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const chartColor = isDark ? '#3B82F6' : '#0A25FF';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : '#E5E7EB';

  const source = useFinanceSource();
  const { month, setMonth } = useFinanceParams();
  const [data, setData] = useState<ForecastData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sellerFilter, setSellerFilter] = useState('all');
  const [sortKey, setSortKey] = useState<ForecastSortKey>('sold');
  const [unit, setUnit] = useState<UnitKind>('devices');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    source
      .loadForecast(month)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, month]);

  const ctx = useMemo(() => buildContext(month), [month]);

  const view = useMemo(() => {
    if (!data || data.month !== month) return null;
    // Metas independentes por categoria (aparelhos × acessórios) e por vendedor.
    const deviceGoalBy = new Map(data.deviceGoals.map((g) => [g.seller_id, g.device_target]));
    const accessoryGoalBy = new Map(data.deviceGoals.map((g) => [g.seller_id, g.accessory_target]));
    const goalBySeller = unit === 'devices' ? deviceGoalBy : accessoryGoalBy;
    const counts = countUnitsBySeller(data.sales, data.productNames, ctx, unit);

    // Equipe = vendedores ativos visíveis no ranking + quem tem alguma meta no mês.
    const anyGoal = new Set(data.deviceGoals.filter((g) => g.device_target != null || g.accessory_target != null).map((g) => g.seller_id));
    const team = data.sellers.filter((s) => (s.show_in_ranking && s.active) || anyGoal.has(s.id));
    const allRows: TeamRow[] = team.map((s) => ({
      ...buildSellerRow(s.id, counts.get(s.id), goalBySeller.get(s.id) ?? null, ctx),
      name: s.name,
      seller: s,
    }));
    const rows = allRows.filter((r) => sellerFilter === 'all' || r.sellerId === sellerFilter);
    const summary = summarizeTeam(rows);

    // Gráfico e categorias: operação inteira (como antes) ou só o vendedor filtrado.
    const scoped = sellerFilter === 'all' ? data.sales : data.sales.filter((s) => s.seller_id === sellerFilter);
    const cat = countByCategory(scoped, data.productNames, ctx);
    const devicesTarget = sellerFilter === 'all' ? data.globalTargets.devices : (deviceGoalBy.get(sellerFilter) ?? 0);
    const accessoriesTarget = sellerFilter === 'all' ? data.globalTargets.accessories : (accessoryGoalBy.get(sellerFilter) ?? 0);
    const byFilter: Record<CategoryFilter, CategoryForecast> = {
      all: buildCategoryForecast(
        'Previsão Geral de Produtos',
        { sold: cat.devices.sold + cat.accessories.sold, untilCutoff: cat.devices.untilCutoff + cat.accessories.untilCutoff, today: cat.devices.today + cat.accessories.today },
        // Com vendedor filtrado, só compara produtos totais se ele tem as DUAS metas (senão seria meta de uma categoria contra vendas das duas).
        sellerFilter === 'all' || (devicesTarget > 0 && accessoriesTarget > 0) ? devicesTarget + accessoriesTarget : 0,
        ctx
      ),
      devices: buildCategoryForecast('Previsão de Aparelhos (iPhones)', cat.devices, devicesTarget, ctx),
      accessories: buildCategoryForecast('Previsão de Acessórios', cat.accessories, accessoriesTarget, ctx),
    };

    return {
      rows: sortUnitRows(rows, sortKey),
      summary,
      byFilter,
      globalTarget: unit === 'devices' ? data.globalTargets.devices : data.globalTargets.accessories,
      devicesTarget,
      accessoriesTarget,
      teamOptions: team.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
      operationUnits: unit === 'devices' ? cat.devices.sold : cat.accessories.sold,
    };
  }, [data, month, ctx, sellerFilter, sortKey, unit]);

  // Vendedor filtrado que não existe no mês escolhido volta para "todos".
  useEffect(() => {
    if (view && sellerFilter !== 'all' && !view.teamOptions.some((o) => o.id === sellerFilter)) setSellerFilter('all');
  }, [view, sellerFilter]);

  const current = view?.byFilter[category];
  const fmt = (v: number | null) => (v == null ? '—' : roundUnits(v).toLocaleString('pt-BR'));

  return (
    <div className="forecast-container">
      <div className="forecast-header-row">
        <div>
          <h1 className="h1">Forecast de Produtos</h1>
          <p className="text-muted" style={{ fontSize: '13px', marginTop: '4px' }}>
            Projeção linear com base no ritmo dos dias completos do mês ({monthLabel(month)})
          </p>
        </div>
      </div>

      <div className="fin-page">
        {error ? (
          <EmptyState title="Não foi possível carregar o Forecast">{error.message}</EmptyState>
        ) : !view ? (
          <div className="fin-loading">Carregando projeção da equipe…</div>
        ) : (
          <div className={loading ? 'is-reloading' : ''}>
            {data && !data.deviceGoalsAvailable && (
              <div className="fin-notice is-partial" role="status">
                <AlertTriangle size={16} />
                <span>
                  As metas individuais ainda não estão ativas no banco (migração 0014). Os vendedores aparecem sem meta até lá.
                </span>
              </div>
            )}
            {data && data.deviceGoalsAvailable && !data.accessoryGoalsAvailable && unit === 'accessories' && (
              <div className="fin-notice is-partial" role="status">
                <AlertTriangle size={16} />
                <span>
                  A meta de acessórios por vendedor ainda não está ativa no banco (migração 0015). Os vendedores aparecem sem meta de acessórios até lá.
                </span>
              </div>
            )}

            <section className="fin-panel fc-team" aria-label="Projeção de vendas por vendedor">
              <div className="fc-team-head">
                <div>
                  <SectionEyebrow icon={unit === 'devices' ? <Smartphone size={14} /> : <Headphones size={14} />}>{UNIT_COPY[unit].eyebrow}</SectionEyebrow>
                  <h2 className="fin-panel-title is-large">Projeção de vendas por vendedor</h2>
                  <p className="fin-lead">{UNIT_COPY[unit].subtitle}</p>
                </div>
                <TeamFilters
                  kind={unit}
                  onKindChange={setUnit}
                  month={month}
                  onMonthChange={setMonth}
                  sellers={view.teamOptions}
                  sellerFilter={sellerFilter}
                  onSellerChange={setSellerFilter}
                  sortKey={sortKey}
                  onSortChange={setSortKey}
                />
              </div>

              <TeamSummaryCards kind={unit} team={view.summary} ctx={ctx} sellersCount={view.rows.length} />

              {view.rows.length === 0 ? (
                <EmptyState title="Nenhum vendedor no filtro">Ative vendedores no ranking ou cadastre metas de {UNIT_COPY[unit].many}.</EmptyState>
              ) : (
                <TeamProjectionTable kind={unit} rows={view.rows} team={view.summary} ctx={ctx} month={month} sortKey={sortKey} onSort={setSortKey} />
              )}

              <p className="fin-muted fin-small fin-table-note">
                {unit === 'devices'
                  ? 'Aparelhos = produtos iPhone, atribuídos ao vendedor de cada item (brindes, acessórios e canceladas não entram). '
                  : 'Acessórios = produtos que não são iPhone, vendidos por valor maior que zero e atribuídos ao vendedor de cada item (brindes e canceladas não entram). '}
                Projeção = vendidos até ontem ÷ dias completos × dias do mês, nunca abaixo do já vendido; o total da equipe é a soma exata arredondada uma só vez.
                Ritmo necessário = faltam ÷ dias restantes (hoje incluso).{' '}
                {view.operationUnits !== view.summary.sold && sellerFilter === 'all' && (
                  <>Operação inteira: {view.operationUnits.toLocaleString('pt-BR')} {UNIT_COPY[unit].many} (inclui vendedores ocultos do ranking). </>
                )}
                {sellerFilter === 'all' && view.summary.target != null && view.globalTarget !== view.summary.target && (
                  <>
                    A meta global de {UNIT_COPY[unit].many} em <Link className="fin-link" to="/metas">Metas</Link> ({view.globalTarget.toLocaleString('pt-BR')}) difere da soma das
                    metas individuais ({view.summary.target.toLocaleString('pt-BR')}); o gráfico e as categorias abaixo usam a meta global.{' '}
                  </>
                )}
                <Link className="fin-link" to={`/metas?mes=${month}`}>
                  Editar metas de {UNIT_COPY[unit].many}
                </Link>
                {data ? ` · dados de ${formatInstantBR(data.loadedAt)}` : ''}
              </p>
            </section>
          </div>
        )}
      </div>

      {view && current && (
        <>
          <div className="card forecast-chart-card">
            <div className="forecast-chart-header">
              <div>
                <h2 className="h2">{current.title}</h2>
                <span className="text-muted text-sm">
                  {current.projection != null ? `Projeção ${fmt(current.projection)} un.` : 'Projeção indisponível'} · {current.target > 0 ? `meta ${current.target.toLocaleString('pt-BR')} un.` : 'sem meta'}
                  {current.attainment != null && ` · atingimento projetado ${Math.round(current.attainment)}%`}
                  {current.dailyActual != null && ` · ritmo atual ${formatPerDay(current.dailyActual)}/dia`}
                  {current.dailyNeeded != null && current.target > 0 && ` · necessário ${formatPerDay(current.dailyNeeded)}/dia`}
                </span>
              </div>
              <div className="category-tabs">
                {([['all', 'Todos os Produtos'], ['devices', 'Aparelhos'], ['accessories', 'Acessórios']] as [CategoryFilter, string][]).map(([k, label]) => (
                  <button key={k} className={`category-tab ${category === k ? 'active' : ''}`} onClick={() => setCategory(k)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="forecast-chart-legend text-sm">
              <div className="flex-center gap-2">
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#0A25FF', display: 'inline-block' }}></span>
                <span className="text-muted">Projeção de Unidades</span>
              </div>
              <div className="flex-center gap-2">
                <span style={{ width: '12px', height: '2px', backgroundColor: '#9CA3AF', display: 'inline-block' }}></span>
                <span className="text-muted">Curva de Meta</span>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={current.chartData} margin={{ top: 10, right: 30, left: 15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorForecastProducts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF' }} unit=" un" width={75} />
                  <Tooltip
                    formatter={(value: any, name: any) => [
                      `${Number(value || 0).toLocaleString('pt-BR')} unidades`,
                      name === 'produtos' ? 'Projeção de Produtos' : 'Meta Acumulada',
                    ]}
                    contentStyle={{
                      backgroundColor: isDark ? '#131926' : '#FFFFFF',
                      borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E5E7EB',
                      color: isDark ? '#F9FAFB' : '#1F2937',
                      borderRadius: '8px',
                    }}
                  />
                  <Area type="monotone" dataKey="meta" name="meta" stroke="#9CA3AF" strokeDasharray="5 5" strokeWidth={2} fill="none" />
                  <Area type="monotone" dataKey="produtos" name="produtos" stroke={chartColor} strokeWidth={3} fillOpacity={1} fill="url(#colorForecastProducts)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card flex-col gap-4">
            <div className="flex-between">
              <h2 className="h2 flex-center gap-2">
                <ShoppingBag size={20} color="var(--primary)" />
                Projeção por Categoria de Produto
              </h2>
              <span className="text-muted text-sm">Unidades Projetadas vs Meta{sellerFilter !== 'all' ? ' · vendedor filtrado' : ''}</span>
            </div>
            <div className="progress-list" style={{ marginTop: '12px' }}>
              {[
                { name: 'Aparelhos', data: view.byFilter.devices, color: chartColor },
                { name: 'Acessórios', data: view.byFilter.accessories, color: '#10B981' },
              ].map(({ name, data: d, color }) => {
                const percentage = d.attainment != null ? Math.round(d.attainment) : 0;
                return (
                  <div key={name} className="flex-col gap-1">
                    <div className="progress-header">
                      <span className="progress-name">{name}</span>
                      <span className="progress-percent">
                        <strong>{fmt(d.projection)} un.</strong> / {d.target.toLocaleString('pt-BR')} un. ({d.target > 0 && d.attainment != null ? `${percentage}%` : 'sem meta'})
                      </span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${Math.min(percentage, 100)}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
