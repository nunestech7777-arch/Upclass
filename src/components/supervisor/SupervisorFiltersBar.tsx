import React from 'react';
import { MessagesSquare, UserRound } from 'lucide-react';
import { CHANNEL_FILTER_LABEL, type ChannelFilter } from '../../lib/supervisor/channels';
import type { SupervisorFilters } from '../../lib/supervisor/filters';
import type { Seller } from '../../lib/database.types';

interface Props {
  filters: SupervisorFilters;
  sellers: Seller[];
  update: (patch: Record<string, string | null>) => void;
  /** Esconde o filtro de vendedor (ex.: quando a seção já escolhe o vendedor). */
  hideSeller?: boolean;
}

/** Atendente e canal do Meu Supervisor (o período vem do filtro geral, no topo). */
export function SupervisorFiltersBar({ filters, sellers, update, hideSeller }: Props) {
  return (
    <div className="sv-filters" role="group" aria-label="Filtros do Meu Supervisor">
      {!hideSeller && (
        <label className="fin-sort sv-filter">
          <UserRound size={15} aria-hidden="true" />
          <select value={filters.seller} aria-label="Atendente (quem respondeu)" onChange={(e) => update({ vendedor: e.target.value })}>
            <option value="all">Todos os atendentes</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? '' : ' (inativo)'}
              </option>
            ))}
            <option value="none">Sem atendente identificado</option>
          </select>
        </label>
      )}

      <label className="fin-sort sv-filter">
        <MessagesSquare size={15} aria-hidden="true" />
        <select value={filters.channel} aria-label="Canal" onChange={(e) => update({ canal: e.target.value })}>
          {(Object.keys(CHANNEL_FILTER_LABEL) as ChannelFilter[]).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_FILTER_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
