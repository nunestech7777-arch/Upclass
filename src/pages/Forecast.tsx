import React, { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ShoppingBag, Smartphone, Headphones, AlertTriangle, Apple } from 'lucide-react';
import './Forecast.css';
import '../components/finance/finance.css';
import { buildContext } from '../lib/finance/calc';
import { formatInstantBR, monthLabel } from '../lib/finance/dates';
import {
  APPLE_SORT_KEYS,
  APPLE_TYPES,
  appleReviewItems,
  measureAppleBySeller,
  accessoryAttendancesBySeller,
  buildRatioRow,
  isRatioView,
  sortRatioRows,
  summarizeRatio,
  VIEW_OPTIONS,
  type ForecastView,
  type RatioSortKey,
  buildCategoryForecast,
  buildSellerRow,
  countByCategory,
  formatMoney,
  formatPA,
  formatPerDay,
  goalFor,
  measureBySeller,
  metricCopy,
  roundUnits,
  sortUnitRows,
  summarizeTeam,
  type CategoryForecast,
  type ForecastMetric,
  type ForecastSortKey,
  type UnitKind,
  UNIT_COPY,
} from '../lib/finance/forecast';
import type { ForecastData } from '../lib/finance/financeApi';
import { useFinanceParams, useFinanceSource } from '../components/finance/useFinance';
import { EmptyState, SectionEyebrow } from '../components/finance/FinancePrimitives';
import {
  AppleReviewPanel,
  AppleSummaryCards,
  AppleTable,
  AppleTypeStrip,
  type AppleTeamRow,
  RatioSummaryCards,
  RatioTable,
  TeamFilters, TeamProjectionTable, TeamSummaryCards, type RatioTeamRow, type TeamRow } from '../components/forecast/ForecastTeamSection';
import { Link } from 'react-router-dom';
import { tooltipStyle, useChartTheme } from '../lib/chartTheme';

type CategoryFilter = 'all' | 'devices' | 'accessories';

export function Forecast() {
  const chart = useChartTheme();
  const chartColor = chart.series[0];
  const gridColor = chart.grid;

  const source = useFinanceSource();
  const { month, setMonth } = useFinanceParams();
  const [data, setData] = useState<ForecastData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sellerFilter, setSellerFilter] = useState('all');
  const [sortKey, setSortKey] = useState<ForecastSortKey>('sold');
  const [unit, setUnit] = useState<UnitKind>('devices');
  const [metricView, setMetricView] = useState<ForecastView>(VIEW_OPTIONS.devices[0]);
  const [ratioSort, setRatioSort] = useState<RatioSortKey>('value');
  // Trocar de categoria volta para a métrica padrão dela (Aparelhos → quantidade; Acessórios → faturamento).
  const changeUnit = (k: UnitKind) => {
    setUnit(k);
    setMetricView(VIEW_OPTIONS[k][0]);
    // Produtos Apple não têm meta: ordenações por meta voltam para "mais vendidos".
    if (k === 'apple' && !APPLE_SORT_KEYS.includes(sortKey)) setSortKey('sold');
  };
  const changeView = (v: ForecastView) => {
    setMetricView(v);
    setRatioSort('value');
  };
  // Ticket médio e PA não têm meta/projeção; as demais telas usam a métrica de meta (unidades ou R$).
  const ratio = isRatioView(metricView) ? metricView : null;
  const metric: ForecastMetric = isRatioView(metricView) ? 'revenue' : metricView;

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
    // Metas independentes por categoria (aparelhos × acessórios), por métrica (unidades × R$) e por vendedor.
    const deviceGoalBy = new Map(data.deviceGoals.map((g) => [g.seller_id, g.device_target]));
    const accessoryGoalBy = new Map(data.deviceGoals.map((g) => [g.seller_id, g.accessory_target]));
    const goalRowBy = new Map(data.deviceGoals.map((g) => [g.seller_id, g]));
    const counts = measureBySeller(data.sales, data.productNames, ctx, unit, metric);

    // Equipe = vendedores ativos visíveis no ranking + quem tem alguma meta no mês.
    const anyGoal = new Set(
      data.deviceGoals
        .filter((g) => g.device_target != null || g.accessory_target != null || g.device_revenue_target != null || g.accessory_revenue_target != null)
        .map((g) => g.seller_id)
    );
    const team = data.sellers.filter((s) => (s.show_in_ranking && s.active) || anyGoal.has(s.id));
    const allRows: TeamRow[] = team.map((s) => ({
      ...buildSellerRow(s.id, counts.get(s.id), goalFor(goalRowBy.get(s.id), unit, metric), ctx, metric),
      name: s.name,
      seller: s,
    }));
    const rows = allRows.filter((r) => sellerFilter === 'all' || r.sellerId === sellerFilter);
    const summary = summarizeTeam(rows, metric);
    // Operação inteira (inclui vendedores ocultos), na mesma métrica.
    const operationTotal = summarizeTeam(
      [...counts.entries()].map(([id, c]) => buildSellerRow(id, c, null, ctx, metric)),
      metric
    ).sold;

    // Gráfico e categorias: operação inteira (como antes) ou só o vendedor filtrado.
    const scoped = sellerFilter === 'all' ? data.sales : data.sales.filter((s) => s.seller_id === sellerFilter);
    const cat = countByCategory(scoped, data.productNames, ctx);
    const devicesTarget = sellerFilter === 'all' ? data.globalTargets.devices : (deviceGoalBy.get(sellerFilter) ?? 0);
    const accessoriesTarget = sellerFilter === 'all' ? data.globalTargets.accessories : (accessoryGoalBy.get(sellerFilter) ?? 0);
    const byFilter: Record<CategoryFilter, CategoryForecast> = {
      all: buildCategoryForecast(
        'Previsão Geral de Produtos',
        {
          sold: cat.devices.sold + cat.accessories.sold + cat.appleOther.sold,
          untilCutoff: cat.devices.untilCutoff + cat.accessories.untilCutoff + cat.appleOther.untilCutoff,
          today: cat.devices.today + cat.accessories.today + cat.appleOther.today,
        },
        // Com vendedor filtrado, só compara produtos totais se ele tem as DUAS metas (senão seria meta de uma categoria contra vendas das duas).
        sellerFilter === 'all' || (devicesTarget > 0 && accessoriesTarget > 0) ? devicesTarget + accessoriesTarget : 0,
        ctx
      ),
      devices: buildCategoryForecast('Previsão de Aparelhos (iPhones)', cat.devices, devicesTarget, ctx),
      accessories: buildCategoryForecast('Previsão de Acessórios', cat.accessories, accessoriesTarget, ctx),
    };

    // Ticket médio e PA (só acessórios): mesmos vendedores da equipe, atendimento = venda × vendedor.
    const attendances = accessoryAttendancesBySeller(data.sales, data.productNames);
    const ratioAll: RatioTeamRow[] = team
      .map((s) => ({ ...buildRatioRow(s.id, attendances.get(s.id)), name: s.name, seller: s }))
      .filter((r) => sellerFilter === 'all' || r.sellerId === sellerFilter);
    const ratioOperation = summarizeRatio([...attendances.entries()].map(([id, st]) => buildRatioRow(id, st)));

    // Produtos Apple: tipos identificados automaticamente (sem meta), por vendedor do item.
    const appleBy = measureAppleBySeller(data.sales, data.productNames, ctx, metric);
    const appleAll: AppleTeamRow[] = team
      .map((s) => {
        const m = appleBy.get(s.id);
        return {
          ...buildSellerRow(s.id, m?.total, null, ctx, metric),
          name: s.name,
          seller: s,
          types: [...(m?.byType ?? new Map()).entries()].map(([type, c]) => ({ type, row: buildSellerRow(s.id, c, null, ctx, metric) })),
        };
      })
      .map((r) => {
        // Projeção do vendedor = soma das projeções por tipo, para as sub-linhas fecharem com o total.
        const parts = r.types.map((t) => t.row.projection).filter((p): p is number => p != null);
        return parts.length > 0 ? { ...r, projection: parts.reduce((a, p) => a + p, 0) } : r;
      })
      .filter((r) => sellerFilter === 'all' || r.sellerId === sellerFilter);
    const appleTeamTypes = APPLE_TYPES.map((type) => ({
      type,
      team: summarizeTeam(appleAll.flatMap((r) => r.types.filter((t) => t.type === type).map((t) => t.row)), metric),
    })).filter((t) => appleAll.some((r) => r.types.some((x) => x.type === t.type)));
    const reviewScope = sellerFilter === 'all' ? data.sales : data.sales.filter((s) => s.seller_id === sellerFilter);

    return {
      appleRows: sortUnitRows(appleAll, sortKey),
      appleTeam: summarizeTeam(appleAll, metric),
      appleOperation: summarizeTeam([...appleBy.entries()].map(([id, m]) => buildSellerRow(id, m.total, null, ctx, metric)), metric).sold,
      appleTeamTypes,
      appleReview: appleReviewItems(reviewScope, data.productNames),
      sellerNames: new Map(data.sellers.map((s) => [s.id, s.name])),
      ratioRows: ratio ? sortRatioRows(ratioAll, ratio, ratioSort) : ratioAll,
      ratioTeam: summarizeRatio(ratioAll),
      ratioOperation,
      rows: sortUnitRows(rows, sortKey),
      summary,
      byFilter,
      globalTarget: unit === 'devices' ? data.globalTargets.devices : data.globalTargets.accessories,
      devicesTarget,
      accessoriesTarget,
      teamOptions: team.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
      operationTotal,
    };
  }, [data, month, ctx, sellerFilter, sortKey, unit, metric, ratio, ratioSort]);

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
            {data && data.deviceGoalsAvailable && !data.revenueGoalsAvailable && metricView === 'revenue' && unit !== 'apple' && (
              <div className="fin-notice is-partial" role="status">
                <AlertTriangle size={16} />
                <span>
                  As metas de faturamento por vendedor ainda não estão ativas no banco (migração 0016). O faturamento aparece normalmente; os vendedores ficam sem meta financeira até lá.
                </span>
              </div>
            )}
            {data && data.deviceGoalsAvailable && !data.accessoryGoalsAvailable && unit === 'accessories' && metricView === 'units' && (
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
                  <SectionEyebrow icon={unit === 'devices' ? <Smartphone size={14} /> : unit === 'apple' ? <Apple size={14} /> : <Headphones size={14} />}>{UNIT_COPY[unit].eyebrow}</SectionEyebrow>
                  <h2 className="fin-panel-title is-large">Projeção de vendas por vendedor</h2>
                  <p className="fin-lead">
                    {unit === 'apple'
                      ? UNIT_COPY.apple.subtitle
                      : ratio === 'ticket'
                      ? 'Acompanhe quanto cada vendedor fatura, em média, por atendimento com venda de acessórios.'
                      : ratio === 'pa'
                        ? 'Acompanhe quantos acessórios cada vendedor vende, em média, por atendimento.'
                        : metricCopy(unit, metric).subtitle}
                  </p>
                </div>
                <TeamFilters
                  kind={unit}
                  onKindChange={changeUnit}
                  view={metricView}
                  onViewChange={changeView}
                  ratioSort={ratioSort}
                  onRatioSortChange={setRatioSort}
                  month={month}
                  onMonthChange={setMonth}
                  sellers={view.teamOptions}
                  sellerFilter={sellerFilter}
                  onSellerChange={setSellerFilter}
                  sortKey={sortKey}
                  onSortChange={setSortKey}
                />
              </div>

              {unit === 'apple' ? (
                <>
                  <AppleSummaryCards
                    metric={metric}
                    team={view.appleTeam}
                    teamTypes={view.appleTeamTypes}
                    ctx={ctx}
                    sellersCount={view.appleRows.length}
                    reviewCount={view.appleReview.length}
                  />
                  <AppleTypeStrip metric={metric} teamTypes={view.appleTeamTypes} />
                  {view.appleRows.length === 0 ? (
                    <EmptyState title="Nenhum vendedor no filtro">Ative vendedores no ranking.</EmptyState>
                  ) : (
                    <AppleTable metric={metric} rows={view.appleRows} team={view.appleTeam} ctx={ctx} month={month} sortKey={sortKey} onSort={setSortKey} />
                  )}
                  <AppleReviewPanel items={view.appleReview} sellerName={(id) => view.sellerNames.get(id) ?? '—'} />
                  <p className="fin-muted fin-small fin-table-note">
                    Tipo identificado automaticamente pelo nome do produto no Mercado Phone (iPhone, MacBook, iPad, Apple Watch, AirPods, iMac, Mac mini, outros Apple); a
                    palavra “Apple” sozinha não classifica, e capas, películas, pulseiras e cabos são acessórios compatíveis. Itens com indício de réplica, valor abaixo do
                    original ou nome não reconhecido ficam “para revisão”. Cada item conta uma vez, no seu tipo e para o vendedor do item; brindes e canceladas não entram.
                    Neste Forecast, produtos Apple reconhecidos (exceto iPhone) não contam em Acessórios. iPhone segue a regra da aba Aparelhos.{' '}
                    {metric === 'revenue' ? 'Faturamento = valorTotal conciliado (o mesmo do Dashboard), não é lucro. ' : 'Quantidade = soma das unidades de cada item. '}
                    Projeção = realizado até ontem ÷ dias completos × dias do mês (soma por tipo). Sem meta (nenhuma é criada automaticamente).{' '}
                    {sellerFilter === 'all' && view.appleOperation !== view.appleTeam.sold && (
                      <>
                        Operação inteira: {metric === 'revenue' ? formatMoney(view.appleOperation) : `${view.appleOperation.toLocaleString('pt-BR')} produtos Apple`} (inclui vendedores
                        ocultos do ranking).{' '}
                      </>
                    )}
                    {data ? `Dados de ${formatInstantBR(data.loadedAt)}` : ''}
                  </p>
                </>
              ) : ratio ? (
                <>
                  <RatioSummaryCards metric={ratio} team={view.ratioTeam} rows={view.ratioRows} />
                  {view.ratioRows.length === 0 ? (
                    <EmptyState title="Nenhum vendedor no filtro">Ative vendedores no ranking.</EmptyState>
                  ) : (
                    <RatioTable metric={ratio} rows={view.ratioRows} team={view.ratioTeam} month={month} sortKey={ratioSort} onSort={setRatioSort} />
                  )}
                  <p className="fin-muted fin-small fin-table-note">
                    Atendimento = venda (pedido) distinta do Mercado Phone por vendedor, com ao menos um acessório pago — o Mercado Phone não tem identificador de atendimento,
                    então a métrica é baseada em vendas. Um pedido com acessórios de dois vendedores conta um atendimento para cada um; pedidos só com brindes não contam; canceladas
                    não contam. Cada item vai para o vendedor do item.{' '}
                    {ratio === 'ticket'
                      ? 'Ticket médio = faturamento de acessórios (valorTotal) ÷ atendimentos; atendimentos com acessório ainda não conciliado ficam fora do numerador e do denominador até a sincronização financeira. '
                      : 'PA = acessórios pagos (soma das quantidades) ÷ atendimentos, com duas casas decimais. '}
                    Equipe = total ÷ total, nunca média dos vendedores. Sem meta, projeção nem ritmo: são médias.{' '}
                    {sellerFilter === 'all' && view.ratioOperation.attendances !== view.ratioTeam.attendances && (
                      <>
                        Operação inteira: {view.ratioOperation.attendances.toLocaleString('pt-BR')} atendimentos,{' '}
                        {ratio === 'ticket' ? `ticket ${view.ratioOperation.ticket != null ? formatMoney(view.ratioOperation.ticket) : '—'}` : `PA ${view.ratioOperation.pa != null ? formatPA(view.ratioOperation.pa) : '—'}`} (inclui
                        vendedores ocultos do ranking).{' '}
                      </>
                    )}
                    {data ? `Dados de ${formatInstantBR(data.loadedAt)}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <TeamSummaryCards kind={unit} metric={metric} team={view.summary} ctx={ctx} sellersCount={view.rows.length} />

                  {view.rows.length === 0 ? (
                    <EmptyState title="Nenhum vendedor no filtro">Ative vendedores no ranking ou cadastre metas de {metric === 'revenue' ? 'faturamento de ' : ''}{UNIT_COPY[unit].many}.</EmptyState>
                  ) : (
                    <TeamProjectionTable kind={unit} metric={metric} rows={view.rows} team={view.summary} ctx={ctx} month={month} sortKey={sortKey} onSort={setSortKey} />
                  )}

                  <p className="fin-muted fin-small fin-table-note">
                    {unit === 'devices'
                      ? 'Aparelhos = produtos iPhone, atribuídos ao vendedor de cada item (brindes, acessórios e canceladas não entram). '
                      : 'Acessórios = produtos que não são iPhone, vendidos por valor maior que zero e atribuídos ao vendedor de cada item (brindes e canceladas não entram). '}
                    {metric === 'revenue' ? (
                      <>
                        Faturamento = valor de venda de cada item (valorTotal do Mercado Phone, o mesmo do Dashboard), atribuído ao vendedor do item; não é lucro nem custo. Itens ainda não
                        conciliados ficam fora até a sincronização financeira{view.summary.pendingItems > 0 ? ` (${view.summary.pendingItems} no filtro)` : ''}.
                        Projeção = faturamento até ontem ÷ dias completos × dias do mês, nunca abaixo do já faturado. Ritmo necessário = falta faturar ÷ dias restantes (hoje incluso),
                        arredondado para cima no centavo.{' '}
                      </>
                    ) : (
                      <>
                        Projeção = vendidos até ontem ÷ dias completos × dias do mês, nunca abaixo do já vendido; o total da equipe é a soma exata arredondada uma só vez.
                        Ritmo necessário = faltam ÷ dias restantes (hoje incluso).{' '}
                      </>
                    )}
                    {view.operationTotal !== view.summary.sold && sellerFilter === 'all' && (
                      <>
                        Operação inteira: {metric === 'revenue' ? formatMoney(view.operationTotal) : `${view.operationTotal.toLocaleString('pt-BR')} ${UNIT_COPY[unit].many}`} (inclui vendedores ocultos do
                        ranking).{' '}
                      </>
                    )}
                    {metric === 'units' && sellerFilter === 'all' && view.summary.target != null && view.globalTarget !== view.summary.target && (
                      <>
                        A meta global de {UNIT_COPY[unit].many} em <Link className="fin-link" to="/metas">Metas</Link> ({view.globalTarget.toLocaleString('pt-BR')}) difere da soma das
                        metas individuais ({view.summary.target.toLocaleString('pt-BR')}); o gráfico e as categorias abaixo usam a meta global.{' '}
                      </>
                    )}
                    <Link className="fin-link" to={`/metas?mes=${month}`}>
                      Editar metas de {metric === 'revenue' ? 'faturamento de ' : ''}{UNIT_COPY[unit].many}
                    </Link>
                    {data ? ` · dados de ${formatInstantBR(data.loadedAt)}` : ''}
                  </p>
                </>
              )}
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
                <span style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: chartColor, display: 'inline-block' }}></span>
                <span className="text-muted">Projeção de Unidades</span>
              </div>
              <div className="flex-center gap-2">
                <span style={{ width: '14px', height: 0, borderTop: `2px dashed ${chart.reference}`, display: 'inline-block' }}></span>
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
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: chart.axis }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: chart.axis }} unit=" un" width={75} />
                  <Tooltip
                    formatter={(value: any, name: any) => [
                      `${Number(value || 0).toLocaleString('pt-BR')} unidades`,
                      name === 'produtos' ? 'Projeção de Produtos' : 'Meta Acumulada',
                    ]}
                    contentStyle={tooltipStyle(chart)}
                  />
                  <Area type="monotone" dataKey="meta" name="meta" stroke={chart.reference} strokeDasharray="5 5" strokeWidth={2} fill="none" />
                  <Area type="monotone" dataKey="produtos" name="produtos" stroke={chartColor} strokeWidth={3} fillOpacity={1} fill="url(#colorForecastProducts)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card flex-col gap-4">
            <div className="flex-between">
              <h2 className="h2 flex-center gap-2">
                <ShoppingBag size={20} color="var(--accent-text)" />
                Projeção por Categoria de Produto
              </h2>
              <span className="text-muted text-sm">
                Unidades Projetadas vs Meta{sellerFilter !== 'all' ? ' · vendedor filtrado' : ''} · Acessórios sem produtos Apple (MacBook, iPad, Watch…), que seguem em
                “Todos os Produtos”
              </span>
            </div>
            <div className="progress-list" style={{ marginTop: '12px' }}>
              {[
                { name: 'Aparelhos', data: view.byFilter.devices, color: chartColor },
                { name: 'Acessórios', data: view.byFilter.accessories, color: chart.series[1] },
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
