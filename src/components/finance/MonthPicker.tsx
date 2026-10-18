import React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, monthLabel, monthOf, storeToday } from '../../lib/finance/dates';

interface MonthPickerProps {
  month: string;
  onChange: (month: string) => void;
  /** Meses futuros só fazem sentido para cadastrar metas. */
  allowFuture?: number;
}

export function MonthPicker({ month, onChange, allowFuture = 0 }: MonthPickerProps) {
  const current = monthOf(storeToday());
  const max = addMonths(current, allowFuture);
  const options: string[] = [];
  for (let m = max; options.length < 30; m = addMonths(m, -1)) options.push(m);
  if (!options.includes(month)) options.push(month);

  return (
    <div className="fin-month-picker">
      <span className="fin-filter-label">
        <CalendarDays size={16} />
        Período
      </span>
      <div className="fin-month-control">
        <button type="button" className="fin-icon-btn" onClick={() => onChange(addMonths(month, -1))} aria-label="Mês anterior">
          <ChevronLeft size={16} />
        </button>
        <select value={month} onChange={(e) => onChange(e.target.value)} aria-label="Competência">
          {options.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="fin-icon-btn"
          onClick={() => onChange(addMonths(month, 1))}
          disabled={month >= max}
          aria-label="Próximo mês"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
