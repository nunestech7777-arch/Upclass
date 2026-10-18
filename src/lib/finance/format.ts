const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat('pt-BR');

export function brl(value: number | null | undefined, empty = '—'): string {
  if (value == null || !Number.isFinite(value)) return empty;
  return BRL.format(value);
}

/** Eixos de gráfico: "458 mil", "1,2 mi". */
export function brlAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)} mil`;
  return INT.format(Math.round(value));
}

export function pct(value: number | null | undefined, empty = '—'): string {
  if (value == null || !Number.isFinite(value)) return empty;
  return `${PCT.format(value)}%`;
}

export function int(value: number | null | undefined, empty = '—'): string {
  if (value == null || !Number.isFinite(value)) return empty;
  return INT.format(value);
}

/** Soma em centavos para não acumular erro de ponto flutuante em totais monetários. */
export function sumMoney(values: Iterable<number>): number {
  let cents = 0;
  for (const v of values) cents += Math.round(v * 100);
  return cents / 100;
}
