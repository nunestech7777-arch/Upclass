import { useMemo } from 'react';
import type { MonthFinance } from '../../lib/finance/calc';
import type { MonthFinanceData } from '../../lib/finance/financeApi';
import { monthLabel } from '../../lib/finance/dates';
import { buildEmptyDaysNotice, type Notice } from '../../lib/notices/notices';
import { usePageNotices } from '../../lib/notices/PageNotices';

/**
 * Dias sem vendas do mês aberto vão para a Central de Avisos (antes ficavam fixos na tela). Usa só os
 * dados que a página já carregou. Resultado parcial da conciliação não vira aviso: pendência de
 * conciliação não aparece no sino. A mesma chave nas duas páginas do financeiro: só a aberta publica.
 */
export function useFinanceNotices(data: MonthFinanceData | null, finance: MonthFinance | null, lastSaleAt: string | null) {
  const notices = useMemo<Notice[]>(() => {
    if (!data || !finance) return [];
    const empty = buildEmptyDaysNotice({ key: data.month, scope: monthLabel(data.month), days: finance.emptyCompleteDays, lastSaleAt });
    return empty ? [empty] : [];
  }, [data, finance, lastSaleAt]);
  usePageNotices('finance-month', notices);
}
