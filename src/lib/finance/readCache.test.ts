import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { READ_CACHE_MS, dashboardCacheKey, invalidateFinanceCache, isFinanceCached, withReadCache } from './readCache.ts';
import type { FinanceSource } from './financeApi.ts';

function fakeSource() {
  const calls: string[] = [];
  const source = {
    loadMonth: async (m: string) => (calls.push(`month:${m}`), { month: m }),
    loadDashboard: async (f: string, t: string) => (calls.push(`dash:${f}:${t}`), { f, t }),
    loadForecast: async (m: string) => (calls.push(`forecast:${m}`), { m }),
    loadDeviceGoals: async () => [],
    saveGoals: async () => {
      calls.push('save');
    },
    deleteGoal: async () => {},
    setSellerVisibility: async () => {},
    saveDeviceGoals: async () => {},
    deleteDeviceGoal: async () => {},
    runSync: async () => ({}),
  } as unknown as FinanceSource;
  return { source, calls };
}

describe('cópia curta das leituras do financeiro', () => {
  it('voltar à página dentro do prazo não consulta de novo', async () => {
    invalidateFinanceCache();
    let t = 0;
    const { source, calls } = fakeSource();
    const s = withReadCache(source, () => t);
    await s.loadDashboard('2026-10-01', '2026-10-31');
    t = READ_CACHE_MS - 1;
    await s.loadDashboard('2026-10-01', '2026-10-31');
    assert.equal(calls.filter((c) => c.startsWith('dash')).length, 1);
    t = READ_CACHE_MS + 1;
    await s.loadDashboard('2026-10-01', '2026-10-31');
    assert.equal(calls.filter((c) => c.startsWith('dash')).length, 2);
  });

  it('gravação e "Atualizar" descartam a cópia', async () => {
    invalidateFinanceCache();
    const { source, calls } = fakeSource();
    const s = withReadCache(source, () => 0);
    await s.loadMonth('2026-10');
    await s.saveGoals('2026-10', []);
    await s.loadMonth('2026-10');
    invalidateFinanceCache();
    await s.loadMonth('2026-10');
    assert.equal(calls.filter((c) => c === 'month:2026-10').length, 3);
  });

  it('falha não fica guardada', async () => {
    invalidateFinanceCache();
    let fail = true;
    const { source } = fakeSource();
    const s = withReadCache({ ...source, loadForecast: async () => (fail ? Promise.reject(new Error('x')) : ({} as never)) }, () => 0);
    await assert.rejects(s.loadForecast('2026-10'));
    fail = false;
    await s.loadForecast('2026-10');
  });
});

describe('Dashboard aberto a partir da cópia', () => {
  it('sabe quando a leitura veio do cache (para reler em segundo plano)', async () => {
    invalidateFinanceCache();
    const { source } = fakeSource();
    const s = withReadCache(source, () => 0);
    const key = dashboardCacheKey('2026-11-01', '2026-11-30');
    assert.equal(isFinanceCached(key, 0), false);
    await s.loadDashboard('2026-11-01', '2026-11-30');
    assert.equal(isFinanceCached(key, 1000), true);
    assert.equal(isFinanceCached(key, READ_CACHE_MS + 1), false);
  });
  it('conciliação pelo botão (modo pending) descarta a cópia; prévia não', async () => {
    invalidateFinanceCache();
    const { source, calls } = fakeSource();
    const s = withReadCache(source, () => 0);
    await s.loadDashboard('2026-11-01', '2026-11-30');
    await s.runSync('2026-11-01', '2026-11-30', 'preview');
    await s.loadDashboard('2026-11-01', '2026-11-30');
    assert.equal(calls.filter((c) => c.startsWith('dash')).length, 1);
    await s.runSync('2026-11-01', '2026-11-30', 'pending');
    await s.loadDashboard('2026-11-01', '2026-11-30');
    assert.equal(calls.filter((c) => c.startsWith('dash')).length, 2);
  });
});
