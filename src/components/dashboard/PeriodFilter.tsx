import React from 'react';
import { CalendarRange } from 'lucide-react';
import { PRESET_LABELS, type DateRange, type PeriodPreset } from '../../lib/finance/dashboard';

interface Props {
  preset: PeriodPreset;
  range: DateRange;
  today: string;
  onChange: (preset: PeriodPreset, custom?: DateRange) => void;
}

/** Filtro global do Dashboard (canto superior direito): presets e período personalizado. */
export function PeriodFilter({ preset, range, today, onChange }: Props) {
  return (
    <div className="dv-filter">
      <label className="fin-sort">
        <CalendarRange size={15} />
        <select value={preset} onChange={(e) => onChange(e.target.value as PeriodPreset, e.target.value === 'custom' ? range : undefined)} aria-label="Período do Dashboard">
          {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      {preset === 'custom' && (
        <div className="dv-custom">
          <label>
            De
            <input type="date" className="fin-input" value={range.from} max={today} onChange={(e) => e.target.value && onChange('custom', { from: e.target.value, to: range.to < e.target.value ? e.target.value : range.to })} />
          </label>
          <label>
            Até
            <input type="date" className="fin-input" value={range.to} min={range.from} onChange={(e) => e.target.value && onChange('custom', { from: range.from, to: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}
