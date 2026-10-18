import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign } from 'lucide-react';
import { MigrationPendingError } from '../../lib/finance/financeApi';
import { monthLabel } from '../../lib/finance/dates';
import { MonthPicker } from './MonthPicker';
import { EmptyState } from './FinancePrimitives';
import { SellerFinanceDetail } from './SellerFinanceDetail';
import { useFinanceParams, useMonthFinance } from './useFinance';
import './finance.css';

/**
 * Seção financeira do relatório completo do vendedor: mesmos dados, cálculos e componentes do
 * painel lateral. Carrega só vendas/Mercado Phone — independe das conversas do Kommo.
 */
export function SellerFinanceSection({ sellerId }: { sellerId: string }) {
  const { month, setMonth } = useFinanceParams();
  const { data, finance, error } = useMonthFinance(month);
  const sellerNames = useMemo(() => new Map((data?.sellers ?? []).map((s) => [s.id, s.name])), [data]);
  const row = finance?.sellers.find((s) => s.seller.id === sellerId) ?? null;

  return (
    <section className="fin-page" aria-label="Resultado financeiro do vendedor">
      <div className="fin-panel">
        <div className="fin-ranking-head">
          <h2 className="fin-panel-title is-large">
            <CircleDollarSign size={20} className="tone-profit" />
            Resultado financeiro · {monthLabel(month)}
          </h2>
          <div className="fin-filters">
            <MonthPicker month={month} onChange={setMonth} />
            <Link className="fin-btn" to={`/resultado-financeiro?mes=${month}`}>
              Ranking de lucro
            </Link>
          </div>
        </div>
        {error ? (
          <EmptyState title={error instanceof MigrationPendingError ? 'Módulo financeiro ainda não ativado no banco' : 'Resultado financeiro indisponível'}>
            {error.message}
          </EmptyState>
        ) : !finance || !data ? (
          <div className="fin-loading">Carregando resultado financeiro…</div>
        ) : !row ? (
          <p className="fin-muted">Sem vendas nem meta de lucro em {monthLabel(month)}.</p>
        ) : (
          <SellerFinanceDetail row={row} ctx={finance.context} sales={data.sales} productNames={data.productNames} sellerNames={sellerNames} />
        )}
      </div>
    </section>
  );
}
