import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { PRESET_LABELS, presetRange, type PeriodPreset } from '../../lib/finance/dashboard';
import { storeToday } from '../../lib/finance/dates';
import { isChannelFilter } from '../../lib/supervisor/channels';
import type { SupervisorFilters } from '../../lib/supervisor/filters';
import type { Seller } from '../../lib/database.types';
import { loadPeriodSummary, type PeriodSummaryResult } from '../../lib/supervisor/supervisorApi';

const PRESETS = Object.keys(PRESET_LABELS) as PeriodPreset[];

/** Filtros do Meu Supervisor guardados na URL — continuam valendo ao trocar de seção. */
export function useSupervisorFilters() {
  const [params, setParams] = useSearchParams();
  const today = storeToday();
  const rawPreset = params.get('periodo');
  const preset: PeriodPreset = PRESETS.includes(rawPreset as PeriodPreset) ? (rawPreset as PeriodPreset) : 'week';
  const rawChannel = params.get('canal');

  const filters: SupervisorFilters = useMemo(
    () => ({
      range: presetRange(preset, today, { from: params.get('de') ?? undefined, to: params.get('ate') ?? undefined }),
      seller: params.get('vendedor') || 'all',
      channel: isChannelFilter(rawChannel) ? rawChannel : 'all',
    }),
    [preset, today, params, rawChannel]
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

export function usePeriodSummary(filters: SupervisorFilters) {
  const [state, setState] = useState<{ data: PeriodSummaryResult | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  // Só o clique em "recarregar" fura o cache; trocas de filtro seguintes voltam a usá-lo.
  const forceNext = useRef(false);

  useEffect(() => {
    let alive = true;
    const force = forceNext.current;
    forceNext.current = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadPeriodSummary(filters, force)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((err: Error) => alive && setState({ data: null, error: err.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [filters, nonce]);

  return {
    ...state,
    reload: () => {
      forceNext.current = true;
      setNonce((n) => n + 1);
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
