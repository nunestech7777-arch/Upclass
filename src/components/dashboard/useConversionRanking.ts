import { useEffect, useState } from 'react';
import { useFinanceSource } from '../finance/useFinance';
import { AttendanceCountPendingError, loadAttendedConversations, peekAttendedConversations } from '../../lib/finance/conversionApi';
import { buildConversionRanking, type ConversionRow } from '../../lib/finance/conversionRanking';
import { dataRange, salesIn, type DateRange } from '../../lib/finance/dashboard';
import { storeToday } from '../../lib/finance/dates';

export interface ConversionState {
  rows: ConversionRow[] | null;
  failed: 'error' | 'pending' | null;
}

/**
 * Ranking de Conversão de um período para telas fora do Dashboard (Vendedores, relatório do vendedor):
 * mesmas vendas (loadDashboard, em cache) e mesmos atendimentos (0021, em cache) que o card do
 * Dashboard — a taxa de um vendedor é a mesma em qualquer lugar para o mesmo período.
 */
export function useConversionRanking(range: DateRange): ConversionState {
  const source = useFinanceSource();
  const key = `${range.from}|${range.to}`;
  const [state, setState] = useState<{ key: string } & ConversionState>({ key: '', rows: null, failed: null });

  useEffect(() => {
    let alive = true;
    const cached = peekAttendedConversations(range);
    // Mesmo intervalo que o Dashboard pede (período + janelas de meta): reaproveita a mesma leitura em cache.
    const need = dataRange(range, storeToday());
    Promise.all([source.loadDashboard(need.from, need.to), cached ? Promise.resolve(cached) : loadAttendedConversations(range)])
      .then(([data, attended]) => {
        if (!alive) return;
        setState({ key, rows: buildConversionRanking(salesIn(data.sales, range), data.productNames, data.sellers, attended), failed: null });
        // Valor em cache vencido: mostra já e confere em segundo plano.
        if (cached) {
          loadAttendedConversations(range)
            .then((fresh) => alive && fresh !== attended && setState({ key, rows: buildConversionRanking(salesIn(data.sales, range), data.productNames, data.sellers, fresh), failed: null }))
            .catch(() => undefined);
        }
      })
      .catch((err) => alive && setState({ key, rows: null, failed: err instanceof AttendanceCountPendingError ? 'pending' : 'error' }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);

  return state.key === key ? { rows: state.rows, failed: state.failed } : { rows: null, failed: null };
}
