import React from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePeriod } from '../context/PeriodContext';
import { isFullMonth } from '../lib/period';
import { PRESET_LABELS, formatRange, type PeriodPreset } from '../lib/finance/dashboard';
import { monthLabel } from '../lib/finance/dates';
import './PeriodBar.css';

const PRESETS = Object.keys(PRESET_LABELS) as PeriodPreset[];

// Páginas sem período (cadastros e configurações) não mostram a barra.
const HIDDEN = [/^\/metas/, /^\/configuracoes/, /^\/supervisor\/configuracoes/];
// Páginas por competência: usam o mês do período.
const MONTHLY = [/^\/forecast/, /^\/resultado-financeiro/, /^\/resultados-diarios/, /^\/vendedores\/[^/]+/];

/** Filtro de período geral (abaixo do menu do topo): vale para todas as páginas. */
export function PeriodBar() {
  const { pathname } = useLocation();
  const { preset, range, today, month, setPeriod, shift } = usePeriod();
  if (HIDDEN.some((r) => r.test(pathname))) return null;

  const fullMonth = isFullMonth(range);
  const monthly = MONTHLY.some((r) => r.test(pathname));

  return (
    <div className="pb-bar" role="group" aria-label="Período de todo o sistema">
      <span className="pb-title">
        <CalendarRange size={15} aria-hidden="true" />
        Período
      </span>
      <div className="pb-control">
        <button type="button" className="pb-arrow" onClick={() => shift(-1)} aria-label="Período anterior">
          <ChevronLeft size={16} />
        </button>
        <select value={preset} onChange={(e) => setPeriod(e.target.value as PeriodPreset)} aria-label="Período">
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
        <button type="button" className="pb-arrow" onClick={() => shift(1)} disabled={range.to >= today} aria-label="Próximo período">
          <ChevronRight size={16} />
        </button>
      </div>

      {(preset !== 'custom' || fullMonth) && <span className="pb-range">{fullMonth ? monthLabel(month) : formatRange(range)}</span>}
      {preset === 'custom' && (
        <div className="pb-dates">
          <label>
            De
            <input type="date" value={range.from} max={today} onChange={(e) => e.target.value && setPeriod('custom', { from: e.target.value, to: range.to < e.target.value ? e.target.value : range.to })} />
          </label>
          <label>
            Até
            <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setPeriod('custom', { from: range.from, to: e.target.value < range.from ? range.from : e.target.value })} />
          </label>
        </div>
      )}

      {monthly && !fullMonth && <span className="pb-hint">Página mensal: mostra {monthLabel(month)}</span>}
    </div>
  );
}
