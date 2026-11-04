/**
 * Trava compartilhada da conciliação: simula as funções SQL da migração 0022 (UPDATE atômico numa
 * linha só) e confere uma conciliação por vez entre execuções concorrentes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { releaseFinancialLock, tryFinancialLock, withFinancialLock } from './financialLock.ts';
import { fakeLockDb } from './financialLock.fake.ts';

describe('trava compartilhada da conciliação (0022)', () => {
  it('duas execuções ao mesmo tempo (botão × rotina): só uma concilia', async () => {
    const db = fakeLockDb();
    let running = 0;
    let maxRunning = 0;
    const work = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return 'ok';
    };
    const [a, b] = await Promise.all([withFinancialLock(db, 'button#1', work), withFinancialLock(db, 'cron#1', work)]);
    assert.equal([a, b].filter((r) => r.acquired).length, 1);
    assert.equal(maxRunning, 1);
    assert.equal(db.row.holder, null, 'liberada no fim');
  });

  it('rotina espera a trava do botão e concilia depois', async () => {
    const db = fakeLockDb();
    assert.equal(await tryFinancialLock(db, 'button#1'), true);
    let waited = 0;
    const res = await withFinancialLock(db, 'cron#1', async () => 'conciliado', {
      waitMs: 45_000,
      pollMs: 5_000,
      sleep: async (ms) => {
        waited += ms;
        if (waited >= 10_000) await releaseFinancialLock(db, 'button#1');
      },
      now: () => waited,
    });
    assert.deepEqual(res, { acquired: true, value: 'conciliado' });
    assert.equal(waited, 10_000);
  });

  it('ocupada além da espera → desiste sem conciliar', async () => {
    const db = fakeLockDb();
    await tryFinancialLock(db, 'manual#1');
    let t = 0;
    let ran = false;
    const res = await withFinancialLock(db, 'cron#1', async () => (ran = true), { waitMs: 45_000, pollMs: 5_000, sleep: async (ms) => void (t += ms), now: () => t });
    assert.equal(res.acquired, false);
    assert.equal(ran, false);
    assert.equal(db.row.holder, 'manual#1', 'não mexe na trava de outro dono');
  });

  it('trava de execução que caiu vence no prazo e não bloqueia para sempre', async () => {
    const db = fakeLockDb();
    await tryFinancialLock(db, 'button#morto', 180);
    db.clock.now = 181_000;
    assert.equal(await tryFinancialLock(db, 'cron#2'), true);
  });

  it('libera a trava mesmo quando a conciliação falha', async () => {
    const db = fakeLockDb();
    await assert.rejects(withFinancialLock(db, 'button#1', async () => { throw new Error('MercadoPhone fora'); }));
    assert.equal(db.row.holder, null);
  });

  it('liberar trava de outro dono não tem efeito', async () => {
    const db = fakeLockDb();
    await tryFinancialLock(db, 'cron#1');
    await releaseFinancialLock(db, 'button#1');
    assert.equal(db.row.holder, 'cron#1');
  });

  it('trava indisponível (ex.: migração não aplicada) → erro, sem conciliar', async () => {
    let ran = false;
    const broken = { rpc: async () => ({ data: null, error: { message: 'Could not find the function public.try_financial_sync_lock' } }) };
    await assert.rejects(withFinancialLock(broken, 'cron#1', async () => (ran = true)), /trava da conciliação indisponível/);
    assert.equal(ran, false);
  });
});
