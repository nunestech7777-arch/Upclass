import React from 'react';
import { CalendarRange, MessagesSquare, UserRound } from 'lucide-react';
import { PRESET_LABELS, type PeriodPreset } from '../../lib/finance/dashboard';
import { CHANNEL_FILTER_LABEL, type ChannelFilter } from '../../lib/supervisor/channels';
import type { SupervisorFilters } from '../../lib/supervisor/filters';
import type { Seller } from '../../lib/database.types';

interface Props {
  filters: SupervisorFilters;
  preset: PeriodPreset;
  today: string;
  sellers: Seller[];
  update: (patch: Record<string, string | null>) => void;
  /** Esconde o filtro de vendedor (ex.: quando a seção já escolhe o vendedor). */
  hideSeller?: boolean;
}

export function SupervisorFiltersBar({ filters, preset, today, sellers, update, hideSeller }: Props) {
  const { range } = filters;
  return (
    <div className="sv-filters" role="group" aria-label="Filtros do Meu Supervisor">
      <label className="fin-sort sv-filter">
        <CalendarRange size={15} aria-hidden="true" />
        <select
          value={preset}
          aria-label="Período"
          onChange={(e) => {
            const p = e.target.value as PeriodPreset;
            update(p === 'custom' ? { periodo: p, de: range.from, ate: range.to } : { periodo: p === 'week' ? null : p, de: null, ate: null });
          }}
        >
          {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </label>

      {preset === 'custom' && (
        <div className="sv-custom-range">
          <label>
            De
            <input
              type="date"
              className="fin-input"
              value={range.from}
              max={today}
              onChange={(e) => e.target.value && update({ de: e.target.value, ate: range.to < e.target.value ? e.target.value : range.to })}
            />
          </label>
          <label>
            Até
            <input type="date" className="fin-input" value={range.to} min={range.from} onChange={(e) => e.target.value && update({ ate: e.target.value })} />
          </label>
        </div>
      )}

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
