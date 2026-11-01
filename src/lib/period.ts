import { PRESET_LABELS, presetRange, type DateRange, type PeriodPreset } from './finance/dashboard.ts';
import { addDays, addMonths, firstDay, lastDay, monthOf } from './finance/dates.ts';

/** Regras do filtro de período geral (sem React; ver context/PeriodContext.tsx). */

export const PRESETS = Object.keys(PRESET_LABELS) as PeriodPreset[];
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export interface StoredPeriod {
  preset: PeriodPreset;
  custom?: DateRange;
}

export function isFullMonth(range: DateRange): boolean {
  const m = monthOf(range.from);
  return range.from === firstDay(m) && range.to === lastDay(m);
}

/** Reconhece o preset equivalente a um intervalo (ex.: a semana atual vira "Esta semana"). */
export function presetFor(range: DateRange, today: string): StoredPeriod {
  for (const p of PRESETS) {
    if (p === 'custom') continue;
    const r = presetRange(p, today);
    if (r.from === range.from && r.to === range.to) return { preset: p };
  }
  return { preset: 'custom', custom: range };
}

/** Mês de competência do período: o do último dia já decorrido (como as janelas de meta). */
export function monthOfRange(range: DateRange, today: string): string {
  const refDay = range.to <= today ? range.to : range.from <= today ? today : range.from;
  return monthOf(refDay);
}

/** Período vizinho: meses inteiros andam de mês em mês, semanas de 7 em 7, o resto pelo próprio tamanho. */
export function shiftRange(range: DateRange, dir: 1 | -1): DateRange {
  if (isFullMonth(range)) {
    const m = addMonths(monthOf(range.from), dir);
    return { from: firstDay(m), to: lastDay(m) };
  }
  const len = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(range.from, dir * len), to: addDays(range.to, dir * len) };
}
