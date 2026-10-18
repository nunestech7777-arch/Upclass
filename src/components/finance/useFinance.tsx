import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  return theme === 'dark'
    ? {
        profit: '#22d3ee',
        goal: '#3b82f6',
        worst: '#facc15',
        deficit: '#fb7185',
        warn: '#fb923c',
        muted: '#94a3b8',
        grid: 'rgba(148, 163, 184, 0.14)',
        text: '#e2e8f0',
        surface: '#0f172a',
        future: 'rgba(148, 163, 184, 0.35)',
      }
    : {
        profit: '#0891b2',
        goal: '#2563eb',
        worst: '#ca8a04',
        deficit: '#e11d48',
        warn: '#ea580c',
        muted: '#64748b',
        grid: '#e5e7eb',
        text: '#1f2937',
        surface: '#ffffff',
        future: '#cbd5e1',
      };
}
