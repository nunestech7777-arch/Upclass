import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleDollarSign, Headphones, Percent, RefreshCw, Smartphone, TrendingUp, Wallet } from 'lucide-react';
import './Dashboard.css';
import '../components/finance/finance.css';
import '../components/dashboard/dashboard.css';
import { SoldProductsModal } from '../components/SoldProductsModal';
import { EmptyState, KpiCard, SectionEyebrow } from '../components/finance/FinancePrimitives';
import { useFinanceSource } from '../components/finance/useFinance';
import { usePeriod } from '../context/PeriodContext';
import { dashboardCacheKey, invalidateFinanceCache, isFinanceCached } from '../lib/finance/readCache';
import { useSyncSignature } from '../lib/finance/useSyncSignature';
import { notifyFinancialUpdated } from '../lib/notices/noticesApi';
import { GoalCards } from '../components/dashboard/GoalCards';
import { SalesItemsDialog, TopProductCard, TopProductDialog } from '../components/dashboard/TopProducts';
import { SalesEvolutionChart } from '../components/dashboard/SalesEvolutionChart';
import { SellerRankings } from '../components/dashboard/SellerRankings';
import { ConversionRanking } from '../components/dashboard/ConversionRanking';
import { AttendanceCountPendingError, loadAttendedConversations, peekAttendedConversations } from '../lib/finance/conversionApi';
import { buildConversionRanking, salesStillArriving } from '../lib/finance/conversionRanking';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { cardLinks, type SalesCategory } from '../lib/cardLinks';
import { countDelay, useScrollReveal } from '../lib/motion';
import { MigrationPendingError, type DashboardData, type DeviceGoal } from '../lib/finance/financeApi';
import { monthOf, monthTitle, storeHourNow } from '../lib/finance/dates';
import { brl, int, pct } from '../lib/finance/format';
import {
  buildDeviceRows,
  buildSellerRows,
  buildSeries,
  confirmedMoney,
  deviceItemsOf,
  dataRange,
  defaultMode,
  formatRange,
  goalWindow,
  refreshPendingCount,
  salesIn,
  summarizeMoney,
  summarizeUnits,
  topProduct,
  unitGoalProgress,
  type SeriesMode,
  type TopProduct,
} from '../lib/finance/dashboard';

const REVEAL_TARGETS = ':scope > .dv-kpis > *, :scope > .dv-goals > *, :scope > .dv-tops > *, :scope > :not(.dv-kpis, .dv-goals, .dv-tops, .dv-reload-bar)';

/** Vendas do produto mais vendido: pelo id quando é um produto só; senão pela busca do nome. */
function productSalesLink(product: TopProduct | null, categoria: SalesCategory): string | null {
  if (!product) return null;
  const ids = new Set(product.rows.map((r) => r.product_id));
  return ids.size === 1 ? cardLinks.sales({ produto: [...ids][0] }) : cardLinks.sales({ categoria, busca: product.name });
}

export function Dashboard() {
  const source = useFinanceSource();
  const { range, today } = usePeriod();
  const need = useMemo(() => dataRange(range, today), [range, today]);

  const [data, setData] = useState<DashboardData | null>(null);
  const dataRef = useRef<DashboardData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  /** Só o clique em "Atualizar dados" muda: a contagem do Kommo ignora o cache uma vez. */
  const [nonce, setNonce] = useState(0);
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
  }, [source, refMonth]);

  // Atendimentos do Kommo do período (Ranking de Conversão): consulta própria, em cache; falha não derruba o painel.
  const rangeKey = `${range.from}|${range.to}`;
  const [attended, setAttended] = useState<{ key: string; value: Map<string, number> | null; failed: 'error' | 'pending' | null } | null>(null);
  const attendedNonce = useRef(nonce);
  useEffect(() => {
    let alive = true;
    // Só o clique em Atualizar ignora o cache; trocar de período depois dele volta a usar o cache.
    const force = attendedNonce.current !== nonce;
    attendedNonce.current = nonce;
    loadAttendedConversations(range, { force })
      .then((value) => alive && setAttended({ key: rangeKey, value, failed: null }))
      .catch((err) => alive && setAttended({ key: rangeKey, value: null, failed: err instanceof AttendanceCountPendingError ? 'pending' : 'error' }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, nonce]);

  // Uma consulta cobre período + janelas de meta; trocar o filtro dentro do intervalo já carregado não consulta de novo.
  useEffect(() => {
    const cur = dataRef.current;
    if (cur && cur.range.from <= need.from && cur.range.to >= need.to) {
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
  }, [source, need.from, need.to]);

  // Recarga sem esconder a tela (botão e segundo plano): painel e metas chegam juntos, no período e
  // filtros atuais — nenhum card fica com dado de outra leitura. Uma recarga por vez.
  const live = useRef({ need, refMonth });
  live.current = { need, refMonth };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reloading = useRef<Promise<void> | null>(null);
  const reloadAgain = useRef(false);
  const reload = useCallback((): Promise<void> => {
    if (reloading.current) {
      reloadAgain.current = true;
      return reloading.current;
    }
    const run = async () => {
      do {
        reloadAgain.current = false;
        const { need: want, refMonth: month } = live.current;
        invalidateFinanceCache();
        const [d, goals] = await Promise.all([
          source.loadDashboard(want.from, want.to),
          source.loadDeviceGoals(month).then(
            (g) => ({ goals: g, available: true }),
            () => ({ goals: [] as DeviceGoal[], available: false })
          ),
        ]);
        const cur = live.current;
        if (!mounted.current) break;
        // Período trocado no meio: relê no período novo (ele pode estar dentro do intervalo já
        // carregado, e aí nenhuma outra carga traria os valores conciliados).
        if (cur.need.from !== want.from || cur.need.to !== want.to) {
          reloadAgain.current = true;
          continue;
        }
        dataRef.current = d;
        setData(d);
        setError(null);
        if (cur.refMonth === month) setGoalsState({ month, ...goals });
      } while (reloadAgain.current && mounted.current);
    };
    reloading.current = run().finally(() => {
      reloading.current = null;
    });
    return reloading.current;
  }, [source]);

  // Segundo plano: a rotina de 30 min (ou uma venda recebida) mudou o banco → relê, sem F5 e sem
  // consultar o MercadoPhone. Erro aqui só mantém os dados na tela.
  const { baseline } = useSyncSignature(source.loadSyncSignature, () => void reload().catch(() => {}));

  // Abriu com a cópia em cache (voltou à página há pouco): mostra na hora e relê em seguida.
  const openedFromCache = useRef(isFinanceCached(dashboardCacheKey(need.from, need.to)));
  useEffect(() => {
    if (openedFromCache.current) void reload().catch(() => {});
  }, [reload]);

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
      conversion: (() => {
        const value = (attended?.key === `${range.from}|${range.to}` ? attended.value : null) ?? peekAttendedConversations(range);
        return value ? buildConversionRanking(inRange, names, data.sellers, value) : null;
      })(),
      conversionFailed: attended?.key === `${range.from}|${range.to}` ? attended.failed : null,
    };
  }, [data, need.from, need.to, range, today, goalsState, attended]);

  // Enquanto um período fora do intervalo carregado é consultado, o painel anterior fica na tela
  // (esmaecido) em vez de sumir: a recarga é discreta e os números contam do valor antigo ao novo.
  const [lastView, setLastView] = useState(view);
  if (view && view !== lastView) setLastView(view);
  const shown = view ?? lastView;
  const dimmed = loading || (!view && !!lastView);

  // Cards e seções abaixo da dobra entram quando chegam à tela (no celular, quase tudo).
  const contentRef = useRef<HTMLDivElement>(null);
  useScrollReveal(contentRef, REVEAL_TARGETS, !!shown && !!data && !error);

  const deviceRow = view?.deviceRows.find((r) => r.seller.id === deviceSeller);

  // "Atualizar dados": amarelo enquanto houver item não conciliado no período (desde 01/09/2026).
  // Com pendência, tenta conciliar só os dias pendentes no backend; sempre relê o banco depois.
  const pendingCount = shown ? refreshPendingCount(shown.inRange) : 0;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const clicking = useRef(false);
  const refreshNow = async () => {
    if (clicking.current) return;
    clicking.current = true;
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      if (pendingCount > 0) {
        const res = await source.runSync(range.from, range.to, 'pending').catch(() => null);
        if (!res?.ok || (res.days_failed?.length ?? 0) > 0) setRefreshFailed(true);
      }
      // Referência antes de reler: a mudança feita por este clique não dispara outra recarga.
      await baseline();
      await reload();
      setNonce((n) => n + 1);
      notifyFinancialUpdated();
    } catch {
      setRefreshFailed(true);
    } finally {
      clicking.current = false;
      if (mounted.current) setRefreshing(false);
    }
  };
  const modeKey = `${range.from}|${range.to}`;
  const activeMode: SeriesMode = mode && mode.key === modeKey ? mode.value : defaultMode(range);

  return (
    <div className="fin-page dv-page">
      <header className="dv-head">
        <div>
          <SectionEyebrow icon={<TrendingUp size={14} />}>Painel comercial</SectionEyebrow>
          <h1 className="fin-title">Dashboard</h1>
        </div>
        <div className="dv-head-actions">
          <button
            type="button"
            className={`fin-btn dv-refresh-btn ${pendingCount > 0 ? 'is-pending' : ''}`}
            onClick={refreshNow}
            disabled={refreshing || loading}
            aria-busy={refreshing}
            title={refreshFailed ? 'Não foi possível atualizar tudo agora; tente de novo em instantes' : undefined}
          >
            <RefreshCw size={15} className={refreshing || loading ? 'fin-spin' : ''} aria-hidden="true" /> Atualizar dados
          </button>
        </div>
      </header>

      {error ? (
        <EmptyState title={error instanceof MigrationPendingError ? 'Módulo financeiro ainda não ativado no banco' : 'Não foi possível carregar o Dashboard'}>{error.message}</EmptyState>
      ) : !shown || !data ? (
        <DashboardSkeleton />
      ) : (
        <div ref={contentRef} className={`dv-content dv-enter ${dimmed ? 'dv-reloading' : ''}`} aria-busy={dimmed}>
          <span className="dv-reload-bar" aria-hidden="true" />
          <div className="dv-kpis">
            <KpiCard to={cardLinks.sales({ categoria: 'Aparelhos' })} label="Aparelhos vendidos" value={<AnimatedNumber value={shown.units.devices} format={int} delay={countDelay(1)} />} icon={<Smartphone size={18} />} tone="goal" />
            <KpiCard to={cardLinks.sales({ categoria: 'Acessórios' })} label="Acessórios vendidos" value={<AnimatedNumber value={shown.units.accessories} format={int} delay={countDelay(2)} />} icon={<Headphones size={18} />} tone="profit" caption={shown.units.gifts ? `Brindes: ${int(shown.units.gifts)}` : undefined} />
            <KpiCard to={cardLinks.financial()} label="Faturamento" value={<AnimatedNumber value={confirmedMoney(shown.money.revenue, shown.money.items, shown.money.reconciledItems)} format={brl} delay={countDelay(3)} />} icon={<CircleDollarSign size={18} />} tone="neutral" />
            <KpiCard to={cardLinks.financial()} label="Lucro bruto" value={<AnimatedNumber value={confirmedMoney(shown.money.profit, shown.money.items, shown.money.reconciledItems)} format={brl} delay={countDelay(4)} />} icon={<Wallet size={18} />} tone={shown.money.profit < 0 ? 'deficit' : 'profit'} highlight />
            <KpiCard to={cardLinks.financial()} label="Margem" value={<AnimatedNumber value={shown.money.margin} format={pct} delay={countDelay(5)} />} icon={<Percent size={18} />} tone="neutral" />
          </div>

          <GoalCards week={shown.week} month={shown.month} units={shown.units} onOpenSales={() => setSalesOpen(true)} />

          <div className="dv-tops">
            <TopProductCard kind="devices" product={shown.topDevice} onOpen={() => setDetail('devices')} to={productSalesLink(shown.topDevice, 'Aparelhos')} />
            <TopProductCard kind="accessories" product={shown.topAccessory} onOpen={() => setDetail('accessories')} to={productSalesLink(shown.topAccessory, 'Acessórios')} />
          </div>

          <SalesEvolutionChart
            points={shown.series.points}
            granularity={shown.series.granularity}
            mode={activeMode}
            onModeChange={(m) => setMode({ key: modeKey, value: m })}
            totals={{ devices: shown.units.devices, accessories: shown.units.accessories }}
            subtitle={shown.series.granularity === 'hour' ? 'Por hora' : shown.series.granularity === 'day' ? 'Por dia' : 'Por mês'}
          />

          <SellerRankings
            rows={shown.sellerRows}
            devices={{
              rows: shown.deviceRows,
              monthLabel: monthTitle(refMonth),
              goalsAvailable: goalsState?.available ?? true,
              operationDevices: shown.units.devices,
              onOpenSeller: setDeviceSeller,
            }}
          />

          <ConversionRanking
            rows={shown.conversion}
            periodLabel={formatRange(range)}
            failed={shown.conversionFailed}
            salesArriving={salesStillArriving(range.to, today)}
          />
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
          summary={`${int(deviceRow?.sold ?? 0)} aparelho(s) · faturamento ${brl(deviceRow ? confirmedMoney(deviceRow.revenue, deviceRow.items, deviceRow.reconciledItems) : 0)} · lucro bruto ${brl(deviceRow ? confirmedMoney(deviceRow.profit, deviceRow.items, deviceRow.reconciledItems) : 0)}`}
          rows={deviceItemsOf(data.sales, view.names, deviceSeller, range)}
          productNames={view.names}
          sellerNames={view.sellerNames}
          columns={{ order: true, profit: true }}
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
