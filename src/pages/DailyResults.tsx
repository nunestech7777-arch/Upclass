import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, RefreshCw } from 'lucide-react';
import { formatInstantBR } from '../lib/finance/dates';
import { MigrationPendingError } from '../lib/finance/financeApi';
import { useFinanceParams, useMonthFinance } from '../components/finance/useFinance';
import { MonthPicker } from '../components/finance/MonthPicker';
import { CoverageNotice, EmptyDaysNotice, EmptyState, SectionEyebrow } from '../components/finance/FinancePrimitives';
import { DailyProfitChart, MonthEvolutionChart } from '../components/finance/FinanceCharts';
import { ActionPlanPanel, DailyIndicators, DailyResultsTable, DayDetail, MonthTimeline } from '../components/finance/DailyBlocks';
import { SellerFinanceDrawer } from '../components/finance/SellerFinanceDrawer';
import '../components/finance/finance.css';

export function DailyResults() {
  const { month, sellerId, day, setMonth, openSeller, closeSeller, setDay } = useFinanceParams();
  const { data, finance, loading, error, reload } = useMonthFinance(month);

  const sellerNames = useMemo(() => new Map((data?.sellers ?? []).map((s) => [s.id, s.name])), [data]);
  const lastSaleAt = useMemo(() => {
    const last = data?.sales.reduce<string | null>((max, s) => (max == null || s.sold_at > max ? s.sold_at : max), null);
    // sold_at guarda o horário da loja como UTC: exibe a parte de data/hora sem converter fuso.
    return last ? `${last.slice(8, 10)}/${last.slice(5, 7)}/${last.slice(0, 4)} ${last.slice(11, 16)}` : null;
  }, [data]);
  const planRows = useMemo(
    () =>
      (finance?.sellers ?? [])
        .filter((s) => s.seller.show_in_ranking || (s.target != null && s.target > 0))
        .sort((a, b) => (b.neededPerDay ?? -1) - (a.neededPerDay ?? -1) || b.profit - a.profit),
    [finance]
  );
  const selectedDay = day && day.startsWith(month) ? day : null;
  const openRow = finance?.sellers.find((s) => s.seller.id === sellerId) ?? null;

  const selectDay = (d: string) => {
    setDay(d);
    requestAnimationFrame(() => document.getElementById('fin-day-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div className="fin-page">
      <header className="fin-page-head">
        <Link to={`/resultado-financeiro?mes=${month}`} className="fin-back">
          <ArrowLeft size={15} /> Ranking de lucro
        </Link>
        <SectionEyebrow icon={<CalendarDays size={14} />}>Acompanhamento diário</SectionEyebrow>
        <h1 className="fin-title">Resultados diários</h1>
        <p className="fin-lead">Meta do dia, ritmo acumulado e plano de ação calculado com os dados do Mercado Phone.</p>
      </header>

      <div className="fin-filters">
        <MonthPicker month={month} onChange={setMonth} />
        <button type="button" className="fin-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'fin-spin' : ''} /> Atualizar
        </button>
        <span className="fin-updated">{data ? `Dados carregados em ${formatInstantBR(data.loadedAt)}` : ''}</span>
      </div>

      {error ? (
        <EmptyState title={error instanceof MigrationPendingError ? 'Módulo financeiro ainda não ativado no banco' : 'Não foi possível carregar os resultados'}>
          {error.message}
        </EmptyState>
      ) : !finance || !data ? (
        <div className="fin-loading">Carregando resultados diários…</div>
      ) : (
        <div className={loading ? 'is-reloading' : ''}>
          <DailyIndicators finance={finance} />
          <CoverageNotice coverage={finance.coverage} />
          <EmptyDaysNotice days={finance.emptyCompleteDays} lastSaleAt={lastSaleAt} />
          <ActionPlanPanel finance={finance} rows={planRows} onOpenSeller={openSeller} />
          <MonthEvolutionChart finance={finance} />
          <MonthTimeline days={finance.days} selected={selectedDay} onSelect={selectDay} />
          <DailyProfitChart days={finance.days} dailyGoal={finance.dailyGoal} selected={selectedDay} onSelect={selectDay} />
          <DailyResultsTable days={finance.days} selected={selectedDay} onSelect={selectDay} />
          <DayDetail
            date={selectedDay}
            sales={data.sales}
            productNames={data.productNames}
            sellerNames={sellerNames}
            onOpenSeller={openSeller}
          />
        </div>
      )}

      {openRow && finance && data && (
        <SellerFinanceDrawer
          row={openRow}
          ctx={finance.context}
          sales={data.sales}
          productNames={data.productNames}
          sellerNames={sellerNames}
          onClose={closeSeller}
          onVisibilityChanged={reload}
        />
      )}
    </div>
  );
}
