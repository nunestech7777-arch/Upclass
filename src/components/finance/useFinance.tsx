import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { chartThemeFor } from '../../lib/chartTheme';
import { useTheme } from '../../context/ThemeContext';
import { buildMonthFinance, type MonthFinance } from '../../lib/finance/calc';
import { isMonthKey, monthOf, storeToday } from '../../lib/finance/dates';
import { supabaseFinanceSource, type FinanceSource, type MonthFinanceData } from '../../lib/finance/financeApi';

const FinanceSourceContext = createContext<FinanceSource>(supabaseFinanceSource);

export function FinanceSourceProvider({ source, children }: { source: FinanceSource; children: React.ReactNode }) {
  return <FinanceSourceContext.Provider value={source}>{children}</FinanceSourceContext.Provider>;
}

export function useFinanceSource(): FinanceSource {
  return useContext(FinanceSourceContext);
}

/**
 * Competência (`?mes=AAAA-MM`) e vendedor aberto no painel lateral (`?vendedor=`) ficam na URL,
 * para o período sobreviver à navegação entre ranking, resultados diários e relatório.
 */
export function useFinanceParams() {
  const [params, setParams] = useSearchParams();
  const rawMonth = params.get('mes');
  const month = isMonthKey(rawMonth) ? rawMonth : monthOf(storeToday());
  const sellerId = params.get('vendedor');
  const day = params.get('dia');

  const update = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value == null) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace }
      );
    },
    [setParams]
  );

  return {
    month,
    sellerId,
    day,
    setMonth: (m: string) => update({ mes: m, dia: null }),
    openSeller: (id: string) => update({ vendedor: id }),
    closeSeller: () => update({ vendedor: null }),
    setDay: (d: string | null) => update({ dia: d }, true),
  };
}

export interface MonthFinanceState {
  data: MonthFinanceData | null;
  finance: MonthFinance | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

export function useMonthFinance(month: string): MonthFinanceState {
  const source = useFinanceSource();
  const [data, setData] = useState<MonthFinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    source
      .loadMonth(month)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, month, nonce]);

  const finance = useMemo(
    () =>
      data && data.month === month
        ? buildMonthFinance({
            month,
            sellers: data.sellers,
            productNames: data.productNames,
            sales: data.sales,
            goals: data.goals,
            iphoneBaseline: data.iphoneBaseline,
          })
        : null,
    [data, month]
  );

  return { data, finance, loading, error, reload: () => setNonce((n) => n + 1) };
}

/** Cores do módulo financeiro, coerentes entre cards, gráficos e legendas. */
export interface FinanceColors {
  profit: string;
  goal: string;
  worst: string;
  deficit: string;
  warn: string;
  muted: string;
  grid: string;
  text: string;
  surface: string;
  future: string;
}

export function useFinanceColors(): FinanceColors {
  const { theme } = useTheme();
  const c = chartThemeFor(theme);
  // Realizado = ciano (série 2), meta = azul elétrico (série 1), pior cenário = âmbar,
  // déficit = vermelho semântico. Metas usam linha tracejada para não depender só da cor.
  return {
    profit: c.series[1],
    goal: c.series[0],
    worst: c.warning,
    deficit: c.danger,
    warn: theme === 'dark' ? '#FB923C' : '#C2410C',
    muted: c.axis,
    grid: c.grid,
    text: c.text,
    surface: c.surface,
    future: theme === 'dark' ? 'rgba(142, 166, 255, 0.3)' : '#CDD1E4',
  };
}
