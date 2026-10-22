/**
 * Evolução acumulada da meta semanal (segunda a domingo) a partir das vendas diárias reais.
 * Só reorganiza os dados já calculados pelo painel: não define meta, total nem percentual.
 */

export interface WeeklyEvolutionPoint {
  /** Data da loja, `YYYY-MM-DD`. */
  date: string;
  /** Sigla do dia: SEG, TER… */
  label: string;
  /** Vendido no dia. */
  daily: number;
  /** Acumulado até o fim do dia; `null` nos dias futuros. */
  realized: number | null;
  /** Ritmo esperado acumulado: 0 na segunda e a meta inteira no domingo. */
  expected: number;
  isToday: boolean;
  isFuture: boolean;
}

const LABELS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Sete datas `YYYY-MM-DD` a partir da segunda-feira (calendário, sem fuso). */
export function weekDateKeys(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
}

export function buildWeeklyEvolution(
  weekStart: Date,
  dailyByDate: ReadonlyMap<string, number>,
  target: number,
  today: string,
): WeeklyEvolutionPoint[] {
  let running = 0;
  return weekDateKeys(weekStart).map((date, i) => {
    const daily = dailyByDate.get(date) ?? 0;
    const isFuture = date > today;
    if (!isFuture) running += daily;
    return {
      date,
      label: LABELS[i],
      daily,
      realized: isFuture ? null : running,
      expected: Math.round((target * i / 6) * 10) / 10,
      isToday: date === today,
      isFuture,
    };
  });
}

/** Há dados para desenhar? Precisa de meta definida e ao menos uma venda na semana. */
export function hasWeeklyEvolution(points: readonly WeeklyEvolutionPoint[]): boolean {
  return points.some((p) => p.daily > 0);
}
