import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { SupervisorFilters } from '../../lib/supervisor/filters';
import { usePeriodFreshness } from './useSupervisor';

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/**
 * Aviso discreto de quando os dados do período foram buscados, com atualização manual. A atualização
 * automática acontece em segundo plano sem esconder os indicadores; se falhar, os dados anteriores
 * continuam na tela, com o horário deles.
 */
export function SupervisorFreshness({ filters }: { filters: SupervisorFilters }) {
  const { loadedAt, refreshing, failed, refresh } = usePeriodFreshness(filters);
  if (loadedAt == null && !refreshing) return null;
  const label = refreshing
    ? 'Atualizando…'
    : failed
      ? `Falha ao atualizar · dados de ${hhmm(loadedAt!)}`
      : `Atualizado às ${hhmm(loadedAt!)}`;
  return (
    <span className={`sv-freshness ${failed ? 'is-failed' : ''}`} role="status" aria-live="polite">
      <span>{label}</span>
      <button type="button" onClick={refresh} disabled={refreshing} aria-label={failed ? 'Tentar atualizar de novo' : 'Atualizar dados agora'} title="Atualizar agora">
        <RefreshCw size={13} className={refreshing ? 'fin-spin' : ''} aria-hidden="true" />
      </button>
    </span>
  );
}
