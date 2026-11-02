import { useMemo } from 'react';
import type { MonthFinance } from '../../lib/finance/calc';
import type { MonthFinanceData } from '../../lib/finance/financeApi';
import { monthLabel } from '../../lib/finance/dates';
import { buildEmptyDaysNotice, buildPartialResultNotice, pendingItemsOf, type Notice } from '../../lib/notices/notices';
import { usePageNotices } from '../../lib/notices/PageNotices';

/**
 * Resultado parcial e dias sem vendas do mês aberto vão para a Central de Avisos (antes ficavam
 * fixos na tela). Usa só os dados que a página já carregou. A mesma chave nas duas páginas do
 * financeiro: só a aberta publica.
 */
export function useFinanceNotices(data: MonthFinanceData | null, finance: MonthFinance | null, lastSaleAt: string | null) {
  const notices = useMemo<Notice[]>(() => {
    if (!data || !finance) return [];
    const scope = monthLabel(data.month);
    const partial = buildPartialResultNotice({
      key: data.month,
      scope,
      coverage: finance.coverage,
      items: pendingItemsOf(data.sales, data.productNames),
      lastSyncAt: data.lastSync?.finished_at ?? null,
      at: data.loadedAt,
    });
    const empty = buildEmptyDaysNotice({ key: data.month, scope, days: finance.emptyCompleteDays, lastSaleAt });
    return [partial, empty].filter((n): n is NonNullable<typeof n> => n !== null);
  }, [data, finance, lastSaleAt]);
  usePageNotices('finance-month', notices);
}
