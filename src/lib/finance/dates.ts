/**
 * Datas comerciais no fuso da loja (America/Sao_Paulo). Datas são strings `AAAA-MM-DD` e
 * competências `AAAA-MM` — nunca `Date` local, para não deslocar vendas entre dias.
 */

export const STORE_TIME_ZONE = 'America/Sao_Paulo';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Data de hoje na loja. */
export function storeToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: STORE_TIME_ZONE }).format(now);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function isMonthKey(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function dayDate(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`;
}

export function firstDay(month: string): string {
  return `${month}-01`;
}

export function lastDay(month: string): string {
  return dayDate(month, daysInMonth(month));
}

/** "outubro de 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}

export function weekdayShort(date: string): string {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** "Ter 13" */
export function dayLabel(date: string): string {
  return `${weekdayShort(date)} ${date.slice(8, 10)}`;
}

/** "13/10/2026" */
export function formatDateBR(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Data e hora de um instante, no fuso da loja: "13/10/2026, 08:38". */
export function formatInstantBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: STORE_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

const MONTHS_CAP = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** "15 de Outubro de 2026" */
export function longDateBR(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} de ${MONTHS_CAP[m - 1]} de ${y}`;
}

/** "Outubro de 2026" */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_CAP[m - 1]} de ${y}`;
}

/**
 * `sales.sold_at` guarda o horário da loja como se fosse UTC (o MercadoPhone envia o relógio da loja
 * sem fuso). Por isso as partes UTC SÃO o relógio da loja; converter para o fuso do navegador
 * deslocaria a venda em 3 horas (uma venda das 09h apareceria às 06h).
 */
export function wallClock(iso: string): { date: string; time: string; hour: number } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    hour: d.getUTCHours(),
  };
}

/** "16/10/2026 às 09:00" — relógio da loja. */
export function formatWallDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const w = wallClock(iso);
  return `${formatDateBR(w.date)} às ${w.time}`;
}

/** Hora atual (0–23) no fuso da loja. */
export function storeHourNow(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: STORE_TIME_ZONE, hour: '2-digit', hour12: false }).format(now)) % 24;
}
