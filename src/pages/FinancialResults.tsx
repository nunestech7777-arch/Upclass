import React, { useMemo, useState } from 'react';
import { cutoffCaption, SORT_LABELS, sortSellers, type RankingSortKey } from '../lib/finance/ui';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpDown,
  CircleDollarSign,
  ClipboardCopy,
  FileSpreadsheet,
  Flag,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
  Trophy,
  DatabaseZap,
  Check,
} from 'lucide-react';
import { combineSellers } from '../lib/finance/calc';
import { buildSummaryText } from '../lib/finance/summary';
import { brl, int, pct } from '../lib/finance/format';
import { formatInstantBR, monthLabel } from '../lib/finance/dates';
import { MigrationPendingError } from '../lib/finance/financeApi';
import { useFinanceParams, useMonthFinance } from '../components/finance/useFinance';
import { MonthPicker } from '../components/finance/MonthPicker';
import { CoverageNotice, EmptyDaysNotice, EmptyState, KpiCard, SectionEyebrow } from '../components/finance/FinancePrimitives';
import { ProfitRankingTable } from '../components/finance/ProfitRankingTable';
import { MonthEvolutionChart, SellerComparisonChart } from '../components/finance/FinanceCharts';
import { SellerFinanceDrawer } from '../components/finance/SellerFinanceDrawer';
import { GoalsTransferActions } from '../components/finance/GoalsTransfer';
import { FinancialSyncDialog } from '../components/finance/FinancialSyncDialog';
import '../components/finance/finance.css';

function csvCell(value: string | number | null): string {
  if (value == null) return '';
  const s = typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function FinancialResults() {
  const { month, sellerId, setMonth, openSeller, closeSeller } = useFinanceParams();
  const { data, finance, loading, error, reload } = useMonthFinance(month);
  const [sortKey, setSortKey] = useState<RankingSortKey>('profit');
  const [showHidden, setShowHidden] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    if (!finance) return [];
    const list = showHidden ? finance.sellers : finance.sellers.filter((s) => s.seller.show_in_ranking);
    return sortSellers(list, sortKey);
  }, [finance, showHidden, sortKey]);

  const footer = useMemo(() => {
    if (!finance || rows.length === 0) return null;
    return {
      label: showHidden ? `Total dos ${rows.length} vendedores listados` : `Total dos ${rows.length} vendedores visíveis`,
      totals: combineSellers(rows, finance.context),
    };
  }, [finance, rows, showHidden]);

  const sellerNames = useMemo(() => new Map((data?.sellers ?? []).map((s) => [s.id, s.name])), [data]);
  const lastSaleAt = useMemo(() => {
    const last = data?.sales.reduce<string | null>((max, s) => (max == null || s.sold_at > max ? s.sold_at : max), null);
    // sold_at guarda o horário da loja como UTC: exibe a parte de data/hora sem converter fuso.
    return last ? `${last.slice(8, 10)}/${last.slice(5, 7)}/${last.slice(0, 4)} ${last.slice(11, 16)}` : null;
  }, [data]);
  const openRow = finance?.sellers.find((s) => s.seller.id === sellerId) ?? null;
  const hiddenCount = finance ? finance.sellers.filter((s) => !s.seller.show_in_ranking).length : 0;

  const exportCsv = () => {
    if (!finance) return;
    const header = [
      'Posição', 'Vendedor', 'No ranking', 'Meta (lucro)', 'Pior cenário', 'Lucro realizado', '% Meta', '% Pior cenário', 'Falta p/ meta',
      'Faturamento', 'Custo', 'Margem %', 'Pedidos com participação', 'Aparelhos', 'Acessórios', 'Lucro médio por iPhone', 'Itens conciliados', 'Itens',
    ];
    const body = rows.map((s, i) => [
      String(i + 1),
      csvCell(s.seller.name),
      s.seller.show_in_ranking ? 'sim' : 'não',
      ...[s.target, s.worst, s.profit, s.pctTarget, s.pctWorst, s.gap, s.revenue, s.cost, s.margin].map(csvCell),
      String(s.orders),
      String(s.devices),
      String(s.accessories),
      csvCell(s.avgIphoneProfit),
      String(s.reconciledItems),
      String(s.items),
    ]);
    const csv = [header, ...body].map((r) => r.join(';')).join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ranking-lucro-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copySummary = async () => {
    if (!finance) return;
    const ranking = rows.map((s, i) => `${i + 1}. ${s.seller.name}: ${brl(s.profit)}${s.pctTarget != null ? ` (${pct(s.pctTarget)} da meta)` : ''}`);
    await navigator.clipboard.writeText([buildSummaryText(finance, !showHidden), ...ranking].join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fin-page">
      <header className="fin-page-head">
        <SectionEyebrow icon={<TrendingUp size={14} />}>Painel de resultados</SectionEyebrow>
        <h1 className="fin-title">Ranking de lucro por vendedor</h1>
        <p className="fin-lead">Resultados da equipe Você de iPhone, metas e evolução do mês.</p>
      </header>

      <div className="fin-filters">
        <MonthPicker month={month} onChange={setMonth} allowFuture={1} />
        <Link className="fin-btn" to={`/resultados-diarios?mes=${month}`}>
          Resultados diários <ArrowRight size={15} />
        </Link>
      </div>

      <div className="fin-goal-box">
        <span className="fin-eyebrow">Meta do mês</span>
        {finance?.totals.target != null ? (
          <p>
            Usando a soma das metas dos vendedores (<strong className="tone-goal">{brl(finance.totals.target)}</strong>) ·{' '}
            {int(data?.goals.filter((g) => g.profit_target != null).length ?? 0)} vendedor(es) com meta ·{' '}
            <Link to={`/metas?mes=${month}`} className="fin-link">
              editar metas
            </Link>
          </p>
        ) : (
          <p>
            Nenhuma meta de lucro cadastrada para {monthLabel(month)}.{' '}
            <Link to={`/metas?mes=${month}`} className="fin-link">
              Cadastrar metas de lucro
            </Link>
          </p>
        )}
      </div>

      <div className="fin-actions-row">
        <button type="button" className="fin-btn" onClick={reload} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'fin-spin' : ''} /> Atualizar
        </button>
        <button type="button" className="fin-btn" onClick={() => setSyncOpen(true)}>
          <DatabaseZap size={15} /> Conciliar custos (Mercado Phone)
        </button>
        <label className="fin-sort">
          <ArrowUpDown size={15} />
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as RankingSortKey)} aria-label="Ordenar ranking por">
            {(Object.keys(SORT_LABELS) as RankingSortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <span className="fin-updated">
          {data ? `Dados carregados em ${formatInstantBR(data.loadedAt)}` : ''}
          {data?.lastSync?.finished_at ? ` · custos conciliados em ${formatInstantBR(data.lastSync.finished_at)}` : ''}
        </span>
        <span className="fin-spacer" />
        <button type="button" className="fin-btn" onClick={exportCsv} disabled={!finance || rows.length === 0}>
          <FileSpreadsheet size={15} /> Exportar CSV
        </button>
        <button type="button" className="fin-btn" onClick={copySummary} disabled={!finance}>
          {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? 'Resumo copiado' : 'Copiar resumo'}
        </button>
      </div>

      {error ? (
        error instanceof MigrationPendingError ? (
          <EmptyState title="Módulo financeiro ainda não ativado no banco">{error.message}</EmptyState>
        ) : (
          <EmptyState title="Não foi possível carregar os resultados">{error.message}</EmptyState>
        )
      ) : !finance ? (
        <div className="fin-loading">Carregando resultados financeiros…</div>
      ) : (
        <div className={loading ? 'is-reloading' : ''}>
          <div className="fin-kpis">
            <KpiCard
              label="Lucro realizado total"
              value={brl(finance.totals.profit)}
              icon={<CircleDollarSign size={18} />}
              tone="profit"
              highlight
              badge={finance.coverage.complete ? undefined : 'Parcial'}
              caption={
                <>
                  Lucro comercial (receita − custo) · {int(finance.coverage.reconciled)} de {int(finance.coverage.items)} itens conciliados
                </>
              }
            />
            <KpiCard
              label="Meta total"
              value={brl(finance.totals.target, 'Sem meta')}
              icon={<Target size={18} />}
              tone="goal"
              caption={finance.totals.pctTarget != null ? `${pct(finance.totals.pctTarget)} da meta atingida` : 'Cadastre metas de lucro'}
              progress={finance.totals.pctTarget}
            />
            <KpiCard
              label="Pior cenário total"
              value={brl(finance.totals.worst, 'Sem meta')}
              icon={<ShieldCheck size={18} />}
              tone="worst"
              caption={finance.totals.pctWorst != null ? `${pct(finance.totals.pctWorst)} atingido` : '—'}
              progress={finance.totals.pctWorst}
            />
            <KpiCard
              label="Falta para a meta"
              value={finance.totals.gap == null ? '—' : finance.totals.gap === 0 ? 'Meta batida' : brl(finance.totals.gap)}
              icon={<Flag size={18} />}
              tone={finance.totals.gap ? 'deficit' : 'profit'}
              caption={finance.totals.gap == null ? 'Sem meta cadastrada' : 'Para alcançar o objetivo da operação'}
            />
            <KpiCard
              label={finance.context.phase === 'past' ? 'Fechamento do mês' : 'Projeção do mês'}
              value={finance.totals.projection != null ? brl(finance.totals.projection) : 'Indisponível'}
              icon={<TrendingUp size={18} />}
              tone={
                finance.totals.projection == null || finance.totals.target == null
                  ? 'neutral'
                  : finance.totals.projection >= finance.totals.target
                    ? 'profit'
                    : 'deficit'
              }
              badge={finance.totals.projection != null && !finance.coverage.completeUntilCutoff ? 'Parcial' : undefined}
              caption={
                <>
                  {finance.totals.projection != null && finance.totals.target != null
                    ? finance.totals.projection >= finance.totals.target
                      ? 'Bate a meta · '
                      : 'Não bate a meta · '
                    : ''}
                  {finance.context.phase === 'current' ? 'Estimativa linear · ' : ''}
                  {cutoffCaption(finance.context)}
                </>
              }
            />
          </div>

          <CoverageNotice
            coverage={finance.coverage}
            lastSyncAt={data?.lastSync?.finished_at ? formatInstantBR(data.lastSync.finished_at) : null}
          />
          <EmptyDaysNotice days={finance.emptyCompleteDays} lastSaleAt={lastSaleAt} />

          <section className="fin-panel fin-ranking" aria-label="Ranking da equipe">
            <SectionEyebrow>Resultado por vendedor</SectionEyebrow>
            <div className="fin-ranking-head">
              <h2 className="fin-panel-title is-large">
                <Trophy size={20} className="tone-profit" />
                Ranking da equipe
                <span className="fin-count">{int(rows.length)} vendedores</span>
              </h2>
              <div className="fin-ranking-tools">
                <label className="fin-check">
                  <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
                  Mostrar ocultos do ranking ({int(hiddenCount)})
                </label>
                <span className="fin-muted fin-small">Ordenado por {SORT_LABELS[sortKey].toLowerCase()}</span>
              </div>
            </div>
            {data && (
              <GoalsTransferActions month={month} sellers={data.sellers} goals={data.goals} onSaved={reload} />
            )}
            {rows.length === 0 ? (
              <EmptyState title="Nenhum vendedor no ranking">Ative vendedores em Vendedores ou mostre os ocultos.</EmptyState>
            ) : (
              <ProfitRankingTable
                rows={rows}
                ctx={finance.context}
                sortKey={sortKey}
                onSort={setSortKey}
                onOpenSeller={openSeller}
                footer={footer}
              />
            )}
            <p className="fin-muted fin-small fin-table-note">
              Operação inteira (todos os vendedores, inclusive ocultos e brindes): lucro {brl(finance.totals.profit)}, faturamento{' '}
              {brl(finance.totals.revenue)}, {int(finance.totals.orders)} pedidos distintos. Pedidos por vendedor contam participação — um pedido
              com itens de dois vendedores aparece para os dois.
            </p>
          </section>

          <div className="fin-charts-row">
            <SellerComparisonChart sellers={rows} />
            <MonthEvolutionChart finance={finance} />
          </div>
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
      {syncOpen && <FinancialSyncDialog month={month} onClose={() => setSyncOpen(false)} onApplied={reload} />}
    </div>
  );
}
