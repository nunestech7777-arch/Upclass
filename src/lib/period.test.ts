import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFullMonth, monthOfRange, presetFor, shiftRange } from './period.ts';

const TODAY = '2026-11-01'; // domingo

describe('filtro de período geral', () => {
  it('reconhece os presets a partir do intervalo', () => {
    assert.deepEqual(presetFor({ from: '2026-11-01', to: '2026-11-30' }, TODAY), { preset: 'month' });
    assert.deepEqual(presetFor({ from: '2026-10-01', to: '2026-10-31' }, TODAY), { preset: 'lastMonth' });
    assert.deepEqual(presetFor({ from: '2026-10-26', to: '2026-11-01' }, TODAY), { preset: 'week' });
    assert.deepEqual(presetFor({ from: '2026-11-01', to: '2026-11-01' }, TODAY), { preset: 'today' });
    assert.deepEqual(presetFor({ from: '2026-09-01', to: '2026-09-30' }, TODAY), { preset: 'custom', custom: { from: '2026-09-01', to: '2026-09-30' } });
  });

  it('anda de mês em mês com meses inteiros (tamanhos diferentes)', () => {
    assert.deepEqual(shiftRange({ from: '2026-10-01', to: '2026-10-31' }, -1), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(shiftRange({ from: '2026-01-01', to: '2026-01-31' }, 1), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(shiftRange({ from: '2026-12-01', to: '2026-12-31' }, 1), { from: '2027-01-01', to: '2027-01-31' });
  });

  it('anda pelo tamanho do período nos demais casos', () => {
    assert.deepEqual(shiftRange({ from: '2026-10-26', to: '2026-11-01' }, -1), { from: '2026-10-19', to: '2026-10-25' });
    assert.deepEqual(shiftRange({ from: '2026-11-01', to: '2026-11-01' }, -1), { from: '2026-10-31', to: '2026-10-31' });
    assert.deepEqual(shiftRange({ from: '2026-10-10', to: '2026-10-19' }, 1), { from: '2026-10-20', to: '2026-10-29' });
  });

  it('competência das páginas mensais = mês do último dia já decorrido', () => {
    assert.equal(monthOfRange({ from: '2026-10-26', to: '2026-11-01' }, TODAY), '2026-11');
    assert.equal(monthOfRange({ from: '2026-10-27', to: '2026-11-02' }, '2026-10-29'), '2026-10');
    assert.equal(monthOfRange({ from: '2026-11-01', to: '2026-11-30' }, TODAY), '2026-11');
    assert.equal(monthOfRange({ from: '2026-09-15', to: '2026-10-05' }, TODAY), '2026-10');
  });

  it('detecta mês inteiro', () => {
    assert.equal(isFullMonth({ from: '2026-02-01', to: '2026-02-28' }), true);
    assert.equal(isFullMonth({ from: '2026-02-01', to: '2026-02-27' }), false);
    assert.equal(isFullMonth({ from: '2026-10-26', to: '2026-11-01' }), false);
  });
});
