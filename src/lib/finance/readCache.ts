import type { FinanceSource } from './financeApi.ts';

/**
 * Cópia curta (no navegador) das leituras pesadas do financeiro. Voltar a uma página logo depois
 * reaproveita os dados — a página monta de novo e as animações tocam outra vez, sem consultar o banco.
 * "Atualizar" e qualquer gravação (metas, visibilidade, conciliação) descartam a cópia.
 */
export const READ_CACHE_MS = 2 * 60_000;

const entries = new Map<string, { at: number; value: Promise<unknown> }>();

export function invalidateFinanceCache(): void {
  entries.clear();
}

function cached<T>(key: string, load: () => Promise<T>, now: () => number): Promise<T> {
  const hit = entries.get(key);
  if (hit && now() - hit.at < READ_CACHE_MS) return hit.value as Promise<T>;
  const value = load();
  entries.set(key, { at: now(), value });
  // Falha não fica guardada: a próxima tentativa consulta de novo.
  value.catch(() => entries.get(key)?.value === value && entries.delete(key));
  return value;
}

export function withReadCache(source: FinanceSource, now: () => number = Date.now): FinanceSource {
  const write =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } finally {
        invalidateFinanceCache();
      }
    };
  return {
    ...source,
    loadMonth: (month) => cached(`month:${month}`, () => source.loadMonth(month), now),
    loadForecast: (month) => cached(`forecast:${month}`, () => source.loadForecast(month), now),
    loadDashboard: (from, to) => cached(`dashboard:${from}:${to}`, () => source.loadDashboard(from, to), now),
    loadDeviceGoals: (month) => cached(`deviceGoals:${month}`, () => source.loadDeviceGoals(month), now),
    saveGoals: write(source.saveGoals.bind(source)),
    deleteGoal: write(source.deleteGoal.bind(source)),
    setSellerVisibility: write(source.setSellerVisibility.bind(source)),
    saveDeviceGoals: write(source.saveDeviceGoals.bind(source)),
    deleteDeviceGoal: write(source.deleteDeviceGoal.bind(source)),
    runSync: async (start, end, mode) => {
      const res = await source.runSync(start, end, mode);
      if (mode === 'apply') invalidateFinanceCache();
      return res;
    },
  };
}
