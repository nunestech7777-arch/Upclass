import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleDollarSign, Headphones, Percent, RefreshCw, Smartphone, TrendingUp, Wallet } from 'lucide-react';
import './Dashboard.css';
import '../components/finance/finance.css';
import '../components/dashboard/dashboard.css';
import { SoldProductsModal } from '../components/SoldProductsModal';
import { EmptyState, KpiCard, SectionEyebrow } from '../components/finance/FinancePrimitives';
import { CoverageStatus } from '../components/dashboard/CoverageStatus';
import { useFinanceSource } from '../components/finance/useFinance';
import { usePeriod } from '../context/PeriodContext';
import { GoalCards } from '../components/dashboard/GoalCards';
import { SalesItemsDialog, TopProductCard, TopProductDialog } from '../components/dashboard/TopProducts';
import { SalesEvolutionChart } from '../components/dashboard/SalesEvolutionChart';
import { ConversionNotice, SellerRankings } from '../components/dashboard/SellerRankings';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { countDelay, useScrollReveal } from '../lib/motion';
import { MigrationPendingError, type ConversionStatus, type DashboardData, type DeviceGoal } from '../lib/finance/financeApi';
import { formatInstantBR, monthOf, monthTitle, storeHourNow } from '../lib/finance/dates';
import { brl, int, pct } from '../lib/finance/format';
import {
  PRESET_LABELS,
  buildDeviceRows,
  buildSellerRows,
  buildSeries,
  deviceItemsOf,
  dataRange,
  defaultMode,
  formatRange,
  goalWindow,
  rangeCoverage,
  salesIn,
  summarizeMoney,
  summarizeUnits,
  topProduct,
  unitGoalProgress,
  type SeriesMode,
} from '../lib/finance/dashboard';

const REVEAL_TARGETS = ':scope > .dv-kpis > *, :scope > .dv-goals > *, :scope > .dv-tops > *, :scope > :not(.dv-kpis, .dv-goals, .dv-tops, .dv-reload-bar)';

export function Dashboard() {
  const source = useFinanceSource();
  const { preset, range, today } = usePeriod();
  const need = useMemo(() => dataRange(range, today), [range, today]);

  const [data, setData] = useState<DashboardData | null>(null);
  const dataRef = useRef<DashboardData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [conversion, setConversion] = useState<ConversionStatus | null | undefined>(undefined);
  const [mode, setMode] = useState<{ key: string; value: SeriesMode } | null>(null);
  const [salesOpen, setSalesOpen] = useState(false);
  const [detail, setDetail] = useState<'devices' | 'accessories' | null>(null);
  const [deviceSeller, setDeviceSeller] = useState<string | null>(null);
  const [goalsState, setGoalsState] = useState<{ month: string; goals: DeviceGoal[]; available: boolean } | null>(null);

  // Metas individuais de aparelhos (mensais) do mês de referência — consulta leve e isolada.
  const refMonth = monthOf(goalWindow(range, 'month', today).window.from);
  useEffect(() => {
    let alive = true;
    source
      .loadDeviceGoals(refMonth)
      .then((goals) => alive && setGoalsState({ month: refMonth, goals, available: true }))
      .catch(() => alive && setGoalsState({ month: refMonth, goals: [], available: false }));
    return () => {
      alive = false;
    };
  }, [source, refMonth, nonce]);

  // Uma consulta cobre período + janelas de meta; trocar o filtro dentro do intervalo já carregado não consulta de novo.
  useEffect(() => {
    const cur = dataRef.current;
    if (nonce === 0 && cur && cur.range.from <= need.from && cur.range.to >= need.to) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    source
      .loadDashboard(need.from, need.to)
      .then((d) => {
        if (!alive) return;
        dataRef.current = d;
        setData(d);
      })
      .catch((err) => alive && setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, need.from, need.to, nonce]);

  // Conversão: só contagens, isolada do resto (falha do CRM não afeta o Dashboard).
  useEffect(() => {
    source
      .loadConversionStatus()
      .then(setConversion)
      .catch(() => setConversion(null));
  }, [source]);

  const view = useMemo(() => {
    if (!data || data.range.from > need.from || data.range.to < need.to) return null;
    const names = data.productNames;
    const inRange = salesIn(data.sales, range);
    const weekWindow = goalWindow(range, 'week', today);
    const monthWindow = goalWindow(range, 'month', today);
    const now = { today, hour: storeHourNow() };
    return {
      names,
      inRange,
      units: summarizeUnits(inRange, names),
      money: summarizeMoney(inRange),
      coverage: rangeCoverage(inRange, names),
      week: unitGoalProgress(data.sales, names, weekWindow, { devices: data.targets.weekly_devices_target, accessories: data.targets.weekly_accessories_target }),
      month: unitGoalProgress(data.sales, names, monthWindow, { devices: data.targets.monthly_devices_target, accessories: data.targets.monthly_accessories_target }),
      topDevice: topProduct(inRange, names, 'devices'),
      topAccessory: topProduct(inRange, names, 'accessories'),
      sellerRows: buildSellerRows(inRange, names, data.sellers),
      deviceRows: buildDeviceRows(
        data.sales,
        names,
        data.sellers,
        range,
        monthWindow,
        new Map((goalsState?.month === monthOf(monthWindow.window.from) ? goalsState.goals : []).map((g) => [g.seller_id, g.device_target]))
      ),
      series: buildSeries(data.sales, names, range, now),
      sellerNames: new Map(data.sellers.map((s) => [s.id, s.name])),
    };
  }, [data, need.from, need.to, range, today, goalsState]);

  // Enquanto um período fora do intervalo carregado é consultado, o painel anterior fica na tela
  // (esmaecido) em vez de sumir: a recarga é discreta e os números contam do valor antigo ao novo.
  const [lastView, setLastView] = useState(view);
  if (view && view !== lastView) setLastView(view);
  const shown = view ?? lastView;
  const reloading = loading || (!view && !!lastView);

  // Cards e seções abaixo da dobra entram quando chegam à tela (no celular, quase tudo).
  const contentRef = useRef<HTMLDivElement>(null);
  useScrollReveal(contentRef, REVEAL_TARGETS, !!shown && !!data && !error);

  const deviceRow = view?.deviceRows.find((r) => r.seller.id === deviceSeller);
  const modeKey = `${range.from}|${range.to}`;
  const activeMode: SeriesMode = mode && mode.key === modeKey ? mode.value : defaultMode(range);

  return (
    <div className="fin-page dv-page">
      <header className="dv-head">
        <div>
          <SectionEyebrow icon={<TrendingUp size={14} />}>Painel comercial</SectionEyebrow>
          <h1 className="fin-title">Dashboard</h1>
          <p className="fin-lead">
            {PRESET_LABELS[preset]} · {formatRange(range)} · horário da loja (América/São Paulo)
          </p>
        </div>
        <div className="dv-head-actions">
          <button type="button" className="fin-btn" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'fin-spin' : ''} /> Atualizar
          </button>
          <CoverageStatus coverage={view?.coverage ?? null} />
        </div>
      </header>

      {error ? (
        <EmptyState title={error instanceof MigrationPendingError ? 'Módulo financeiro ainda não ativado no banco' : 'Não foi possível carregar o Dashboard'}>{error.message}</EmptyState>
      ) : !shown || !data ? (
        <DashboardSkeleton />
      ) : (
        <div ref={contentRef} className={`dv-content dv-enter ${reloading ? 'dv-reloading' : ''}`} aria-busy={reloading}>
          <span className="dv-reload-bar" aria-hidden="true" />
          <div className="dv-kpis">
            <KpiCard label="Aparelhos vendidos" value={<AnimatedNumber value={shown.units.devices} format={int} delay={countDelay(1)} />} icon={<Smartphone size={18} />} tone="goal" caption="iPhones no período" />
            <KpiCard label="Acessórios vendidos" value={<AnimatedNumber value={shown.units.accessories} format={int} delay={countDelay(2)} />} icon={<Headphones size={18} />} tone="profit" caption={shown.units.gifts ? `${int(shown.units.gifts)} brinde(s) fora da contagem` : 'Acessórios pagos'} />
            <KpiCard label="Faturamento" value={<AnimatedNumber value={shown.money.revenue} format={brl} delay={countDelay(3)} />} icon={<CircleDollarSign size={18} />} tone="neutral" badge={shown.coverage.complete ? undefined : 'Parcial'} caption="Receita líquida conciliada" />
            <KpiCard label="Lucro bruto" value={<AnimatedNumber value={shown.money.profit} format={brl} delay={countDelay(4)} />} icon={<Wallet size={18} />} tone={shown.money.profit < 0 ? 'deficit' : 'profit'} highlight badge={shown.coverage.complete ? undefined : 'Parcial'} caption="Faturamento − custo dos produtos" />
            <KpiCard label="Margem" value={<AnimatedNumber value={shown.money.margin} format={pct} delay={countDelay(5)} />} icon={<Percent size={18} />} tone="neutral" caption={shown.money.margin == null ? 'Indisponível sem faturamento' : 'Lucro bruto ÷ faturamento'} />
          </div>

          <GoalCards week={shown.week} month={shown.month} units={shown.units} onOpenSales={() => setSalesOpen(true)} />

          <div className="dv-tops">
            <TopProductCard kind="devices" product={shown.topDevice} onOpen={() => setDetail('devices')} />
            <TopProductCard kind="accessories" product={shown.topAccessory} onOpen={() => setDetail('accessories')} />
          </div>

          <SalesEvolutionChart
            points={shown.series.points}
            granularity={shown.series.granularity}
            mode={activeMode}
            onModeChange={(m) => setMode({ key: modeKey, value: m })}
            totals={{ devices: shown.units.devices, accessories: shown.units.accessories }}
            subtitle={`${shown.series.granularity === 'hour' ? 'Por hora' : shown.series.granularity === 'day' ? 'Por dia' : 'Por mês'} · ${formatRange(range)}${activeMode === 'cumulative' ? ' · acumulado até o último dado real' : ''}`}
          />

          <SellerRankings
            rows={shown.sellerRows}
            operation={{ profit: shown.money.profit, revenue: shown.money.revenue, orders: shown.units.orders }}
            devices={{
              rows: shown.deviceRows,
              monthLabel: monthTitle(refMonth),
              goalsAvailable: goalsState?.available ?? true,
              operationDevices: shown.units.devices,
              onOpenSeller: setDeviceSeller,
            }}
          />

          <ConversionNotice status={conversion} />
          <p className="fin-muted fin-small fin-table-note">Dados carregados em {formatInstantBR(data.loadedAt)} · os mesmos filtros e classificações valem para cards, gráfico e rankings.</p>
        </div>
      )}

      {view && detail && (
        <TopProductDialog
          title={detail === 'devices' ? 'Aparelho mais vendido' : 'Acessório mais vendido'}
          product={(detail === 'devices' ? view.topDevice : view.topAccessory)!}
          productNames={view.names}
          sellerNames={view.sellerNames}
          onClose={() => setDetail(null)}
        />
      )}

      {view && data && deviceSeller && (
        <SalesItemsDialog
          title={`Aparelhos vendidos por ${view.sellerNames.get(deviceSeller) ?? 'vendedor'}`}
          summary={`${formatRange(range)} · ${int(deviceRow?.sold ?? 0)} aparelho(s) · faturamento ${brl(deviceRow?.revenue ?? 0)} · lucro bruto ${brl(deviceRow?.profit ?? 0)}`}
          rows={deviceItemsOf(data.sales, view.names, deviceSeller, range)}
          productNames={view.names}
          sellerNames={view.sellerNames}
          columns={{ order: true, profit: true }}
          unreconciled={deviceRow ? deviceRow.items - deviceRow.reconciledItems : 0}
          onClose={() => setDeviceSeller(null)}
        />
      )}

      <SoldProductsModal
        isOpen={salesOpen}
        onClose={() => setSalesOpen(false)}
        initialCategory="all"
        initialStartDate={range.from}
        initialEndDate={range.to}
      />
    </div>
  );
}

/** Placeholders foscos no formato do painel enquanto a primeira carga não chega. */
function DashboardSkeleton() {
  const blocks = (n: number, cls: string) => Array.from({ length: n }, (_, i) => <span key={i} className={`dv-skel ${cls}`} />);
  return (
    <div className="dv-skeleton" role="status" aria-live="polite">
      <span className="uc-sr-only">Carregando o Dashboard…</span>
      <div className="dv-kpis">{blocks(5, 'is-kpi')}</div>
      <div className="dv-goals">{blocks(3, 'is-goal')}</div>
      <div className="dv-tops">{blocks(2, 'is-top')}</div>
      {blocks(1, 'is-chart')}
    </div>
  );
}
