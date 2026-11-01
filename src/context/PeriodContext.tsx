import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { presetRange, type DateRange, type PeriodPreset } from '../lib/finance/dashboard';
import { firstDay, isMonthKey, lastDay, storeToday } from '../lib/finance/dates';
import { PRESETS, isDate, monthOfRange, presetFor, shiftRange, type StoredPeriod as Stored } from '../lib/period';

/**
 * Filtro de período GERAL do sistema: um só período (preset ou personalizado) vale para todas as
 * páginas e fica salvo no navegador. Páginas por competência (financeiro, forecast) usam o mês do
 * período — ver `month`.
 */

const STORAGE_KEY = 'upclass.period';

function readStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (raw && PRESETS.includes(raw.preset)) {
      if (raw.preset !== 'custom') return { preset: raw.preset };
      if (isDate(raw.custom?.from) && isDate(raw.custom?.to)) return { preset: 'custom', custom: { from: raw.custom.from, to: raw.custom.to } };
    }
  } catch {
    // navegador sem armazenamento: usa o padrão
  }
  return { preset: 'month' };
}

export interface PeriodState {
  preset: PeriodPreset;
  range: DateRange;
  today: string;
  /** Competência (AAAA-MM) para as páginas mensais. */
  month: string;
  setPeriod: (preset: PeriodPreset, custom?: DateRange) => void;
  setRange: (range: DateRange) => void;
  setMonth: (month: string) => void;
  shift: (dir: 1 | -1) => void;
}

const PeriodContext = createContext<PeriodState | null>(null);

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState<Stored>(readStored);
  const today = storeToday();
  const range = useMemo(() => presetRange(stored.preset, today, stored.custom), [stored, today]);

  const save = useCallback((next: Stored) => {
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // sem armazenamento: vale só nesta aba
    }
  }, []);

  const setRange = useCallback(
    (r: DateRange) => save(presetFor(r.from <= r.to ? r : { from: r.to, to: r.from }, storeToday())),
    [save]
  );

  const value = useMemo<PeriodState>(
    () => ({
      preset: stored.preset,
      range,
      today,
      month: monthOfRange(range, today),
      setPeriod: (preset, custom) => (preset === 'custom' ? save({ preset, custom: custom ?? range }) : save({ preset })),
      setRange,
      setMonth: (m) => isMonthKey(m) && setRange({ from: firstDay(m), to: lastDay(m) }),
      shift: (dir) => setRange(shiftRange(range, dir)),
    }),
    [stored.preset, range, today, save, setRange]
  );

  // Links e favoritos antigos (?periodo=&de=&ate= do Dashboard/Supervisor, ?mes= do financeiro):
  // o período da URL passa a ser o período geral e sai do endereço.
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(search);
    const rawPreset = params.get('periodo');
    const rawMonth = params.get('mes');
    if (!rawPreset && !params.has('de') && !params.has('ate') && !rawMonth) return;
    if (rawPreset && PRESETS.includes(rawPreset as PeriodPreset)) {
      const p = rawPreset as PeriodPreset;
      const de = params.get('de');
      const ate = params.get('ate');
      if (p === 'custom') setRange(presetRange('custom', storeToday(), { from: de ?? undefined, to: ate ?? undefined }));
      else save({ preset: p });
    } else if (isMonthKey(rawMonth)) {
      setRange({ from: firstDay(rawMonth), to: lastDay(rawMonth) });
    }
    ['periodo', 'de', 'ate', 'mes'].forEach((k) => params.delete(k));
    const q = params.toString();
    navigate(`${pathname}${q ? `?${q}` : ''}${hash}`, { replace: true });
  }, [pathname, search, hash, navigate, save, setRange]);

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodState {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod precisa do PeriodProvider');
  return ctx;
}

