import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { usePeriod } from '../../context/PeriodContext';
import { storeToday } from '../../lib/finance/dates';
import { AUTO_REFRESH_MAX_DAYS, AUTO_REFRESH_MS, includesToday } from '../../lib/supervisor/cachePolicy';
import { isChannelFilter } from '../../lib/supervisor/channels';
import { daysOf, type SupervisorFilters } from '../../lib/supervisor/filters';
import type { Seller } from '../../lib/database.types';
import { derivePeriodSummary, loadPeriod, peekPeriod, periodKeyOf, subscribePeriod, type PeriodSummaryResult } from '../../lib/supervisor/supervisorApi';

/** Filtros do Meu Supervisor: período = filtro geral do sistema; atendente e canal ficam na URL. */
export function useSupervisorFilters() {
  const [params, setParams] = useSearchParams();
  const { preset, range, today } = usePeriod();
  const rawChannel = params.get('canal');
  const seller = params.get('vendedor') || 'all';

  const filters: SupervisorFilters = useMemo(
    () => ({
      range,
      seller,
      channel: isChannelFilter(rawChannel) ? rawChannel : 'all',
    }),
    [range, seller, rawChannel]
  );

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '' || v === 'all') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  return { filters, preset, today, update, search: params.toString() };
}

/** Estado do cache de um período (assina as mudanças: dados novos, responsáveis, erro, logout). */
function usePeriodEntry(filters: SupervisorFilters) {
  const key = periodKeyOf(filters);
  const subscribe = useCallback((onChange: () => void) => subscribePeriod(key, onChange), [key]);
  // Cada mudança no cache cria um objeto novo: a identidade basta para o React saber que mudou.
  const entry = useSyncExternalStore(subscribe, () => peekPeriod(key));
  return { key, entry };
}

/**
 * Busca o período se o cache venceu (ao abrir e ao voltar para a aba). Com hoje num período de até
 * 7 dias, refaz também a cada AUTO_REFRESH_MS com a aba visível; períodos longos, que custam mais
 * consultas, só atualizam ao voltar ou pelo botão.
 */
function useRevalidate(filters: SupervisorFilters, key: string) {
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const auto = includesToday(filters.range, storeToday()) && daysOf(filters.range).length <= AUTO_REFRESH_MAX_DAYS;
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'visible') loadPeriod(filtersRef.current).catch(() => undefined);
    };
    revalidate();
    document.addEventListener('visibilitychange', revalidate);
    const timer = auto ? setInterval(revalidate, AUTO_REFRESH_MS) : undefined;
    return () => {
      document.removeEventListener('visibilitychange', revalidate);
      if (timer) clearInterval(timer);
    };
  }, [key, auto]);
}

/**
 * Indicadores do período com cache em memória (stale-while-revalidate): com dados guardados a tela
 * aparece na hora e atualiza em segundo plano; sem eles, mostra o período anterior esmaecido até chegar.
 */
export function usePeriodSummary(filters: SupervisorFilters) {
  const { key, entry } = usePeriodEntry(filters);
  useRevalidate(filters, key);

  const current = entry?.data ? derivePeriodSummary(entry.data, filters, entry.at ?? 0) : null;
  // Último resultado exibido, para trocar de filtro sem tela vazia — nunca de outra conta (escopo na chave).
  const shown = useRef<{ key: string; data: PeriodSummaryResult } | null>(null);
  if (current) shown.current = { key, data: current };
  const previous = shown.current && shown.current.key.split('|')[0] === key.split('|')[0] ? shown.current.data : null;

  const error = !current && entry?.error ? entry.error : null;
  return {
    data: current ?? (error ? null : previous),
    error,
    /** Sem dados deste período ainda (a tela mostra o anterior esmaecido ou "carregando"). */
    loading: !current && !error,
    reload: () => {
      loadPeriod(filters, { force: true }).catch(() => undefined);
    },
  };
}

/** Situação da atualização do período atual, para o aviso discreto no topo do Meu Supervisor. */
export function usePeriodFreshness(filters: SupervisorFilters) {
  const { entry } = usePeriodEntry(filters);
  return {
    loadedAt: entry?.data ? (entry.at ?? null) : null,
    refreshing: !!entry?.inflight || entry?.data?.responsibles === 'pending',
    /** Falha na última atualização, com dados anteriores ainda na tela. */
    failed: !!(entry?.error && entry.data),
    refresh: () => {
      loadPeriod(filters, { force: true }).catch(() => undefined);
    },
  };
}

export interface SupervisorContext extends ReturnType<typeof useSupervisorFilters> {
  sellers: Seller[];
  /** Nome do atendente: id do vendedor, "kommo:<id>" ou null (sem atendente identificado). */
  sellerName: (id: string | null) => string;
  /** Nome de um usuário do Kommo (o do vendedor vinculado, quando houver). */
  kommoUserName: (id: string | null | undefined) => string;
}

/** Contexto entregue pelo SupervisorLayout às seções (filtros e nomes dos vendedores). */
export function useSupervisor(): SupervisorContext {
  return useOutletContext<SupervisorContext>();
}
