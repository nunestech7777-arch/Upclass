import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPortalSummary, buildWeekContext, countDeviceUnits, formatPaceWords, groupByOrder, isFullWeek, portalRange, type PortalSale } from './sellerPortal.ts';

let n = 0;
const sale = (sold_date: string, product_name: string, quantity = 1, extra: Partial<PortalSale> = {}): PortalSale => ({
  id: `s${++n}`,
  sold_at: `${sold_date}T12:00:00Z`,
  sold_date,
  mp_order_id: `o${n}`,
  product_name,
  quantity,
  amount: 5000,
  item_status: 'active',
  ...extra,
});

// Quarta, 21/10/2026: semana de segunda 19/10 a domingo 25/10.
const TODAY = '2026-10-21';
const WEEK = { from: '2026-10-19', to: '2026-10-25' };

describe('períodos', () => {
  it('semana atual e anterior vão de segunda a domingo', () => {
    assert.deepEqual(portalRange('week', TODAY), WEEK);
    assert.deepEqual(portalRange('lastWeek', TODAY), { from: '2026-10-12', to: '2026-10-18' });
    assert.equal(isFullWeek(WEEK), true);
    assert.equal(isFullWeek({ from: '2026-10-20', to: '2026-10-26' }), false);
    assert.equal(isFullWeek({ from: '2026-10-19', to: '2026-10-21' }), false);
  });
  it('contexto: semana corrente conta dias completos até ontem; restantes incluem hoje', () => {
    assert.deepEqual(buildWeekContext('2026-10-19', TODAY), { phase: 'current', elapsedDays: 2, remainingDays: 5, cutoffDate: '2026-10-20' });
    assert.deepEqual(buildWeekContext('2026-10-19', '2026-10-19'), { phase: 'current', elapsedDays: 0, remainingDays: 7, cutoffDate: null });
    assert.deepEqual(buildWeekContext('2026-10-19', '2026-10-25'), { phase: 'current', elapsedDays: 6, remainingDays: 1, cutoffDate: '2026-10-24' });
    assert.equal(buildWeekContext('2026-10-12', TODAY).phase, 'past');
    assert.equal(buildWeekContext('2026-10-26', TODAY).phase, 'future');
  });
});

describe('aparelhos vendidos', () => {
  it('conta unidades de iPhone (quantidade 2 = 2), sem acessórios nem cancelados', () => {
    const sales = [
      sale('2026-10-19', 'IPHONE 15 PRO MAX 256GB', 2),
      sale('2026-10-20', 'CAPA MAGSAFE IPHONE 15'),
      sale('2026-10-20', '15 PLUS - 128 GB - PINK'),
      sale('2026-10-20', 'IPHONE 13 128GB', 1, { item_status: 'cancelled' }),
      sale('2026-10-21', 'IPHONE 16 128GB'),
    ];
    assert.deepEqual(countDeviceUnits(sales, '2026-10-20'), { sold: 4, untilCutoff: 3 });
  });
});

describe('cards', () => {
  const sales = [sale('2026-10-19', 'IPHONE 15 128GB', 3), sale('2026-10-20', 'IPHONE 14 128GB', 3), sale('2026-10-21', 'IPHONE 16 128GB', 6)];

  it('semana atual com meta: progresso, projeção estimada, faltam e ritmo', () => {
    const s = buildPortalSummary(WEEK, TODAY, sales, [{ week_start: '2026-10-19', device_target: 20 }]);
    assert.equal(s.sold, 12);
    assert.equal(s.goal, 20);
    assert.equal(s.progressPct, 60);
    // 6 vendidos em 2 dias completos → 3/dia × 7 = 21 (≥ 12 já vendidos).
    assert.deepEqual([s.projection.kind, s.projection.value], ['estimate', 21]);
    assert.deepEqual(s.remaining, { value: 8, reached: false });
    // 8 em 5 dias → teto(1,6) = 2 por dia.
    assert.equal(s.pace.text, '2 aparelhos por dia');
    assert.equal(s.pace.active, true);
  });

  it('sem meta: não inventa meta, faltam nem ritmo', () => {
    const s = buildPortalSummary(WEEK, TODAY, sales, [{ week_start: '2026-10-12', device_target: 15 }]);
    assert.equal(s.goal, null);
    assert.equal(s.progressPct, null);
    assert.deepEqual(s.remaining, { value: null, reached: false });
    assert.equal(s.pace.text, 'Sem meta definida');
  });

  it('meta atingida: faltam 0 (nunca negativo) e sem ritmo', () => {
    const s = buildPortalSummary(WEEK, TODAY, sales, [{ week_start: '2026-10-19', device_target: 10 }]);
    assert.deepEqual(s.remaining, { value: 0, reached: true });
    assert.equal(s.pace.text, 'Meta atingida');
    assert.equal(s.progressPct, 120);
  });

  it('semana encerrada: resultado realizado, sem projeção futura nem ritmo', () => {
    const last = { from: '2026-10-12', to: '2026-10-18' };
    const s = buildPortalSummary(last, TODAY, [sale('2026-10-13', 'IPHONE 15 128GB', 5)], [{ week_start: '2026-10-12', device_target: 8 }]);
    assert.deepEqual([s.projection.kind, s.projection.value], ['final', 5]);
    assert.deepEqual(s.remaining, { value: 3, reached: false });
    assert.equal(s.pace.text, 'Semana encerrada');
    assert.equal(s.pace.active, false);
  });

  it('segunda-feira: projeção indisponível (nenhum dia completo), ritmo usa os 7 dias', () => {
    const s = buildPortalSummary(WEEK, '2026-10-19', [sale('2026-10-19', 'IPHONE 15 128GB', 2)], [{ week_start: '2026-10-19', device_target: 9 }]);
    assert.equal(s.projection.kind, 'unavailable');
    assert.equal(s.pace.text, '1 aparelho por dia');
  });

  it('período personalizado: sem meta/projeção por equivalência', () => {
    const s = buildPortalSummary({ from: '2026-10-01', to: '2026-10-21' }, TODAY, sales, [{ week_start: '2026-10-19', device_target: 20 }]);
    assert.equal(s.weekly, false);
    assert.equal(s.goal, null);
    assert.equal(s.projection.kind, 'unavailable');
    assert.equal(s.sold, 12);
  });
});

describe('formatPaceWords', () => {
  it('inteiros, sem frações de aparelho', () => {
    assert.equal(formatPaceWords(8, 5), '2 aparelhos por dia');
    assert.equal(formatPaceWords(5, 5), '1 aparelho por dia');
    assert.equal(formatPaceWords(3, 7), '1 aparelho a cada 2 dias');
    assert.equal(formatPaceWords(1, 5), '1 aparelho a cada 5 dias');
    assert.equal(formatPaceWords(4, 7), '1 aparelho por dia');
    assert.equal(formatPaceWords(0, 5), null);
    assert.equal(formatPaceWords(3, 0), null);
  });
});

describe('groupByOrder', () => {
  it('agrupa só os itens recebidos por pedido; cancelados não somam', () => {
    const a = sale('2026-10-20', 'IPHONE 15 128GB', 1, { mp_order_id: '12345', amount: 5000 });
    const b = sale('2026-10-20', 'PELICULA', 1, { mp_order_id: '12345', amount: 50 });
    const c = sale('2026-10-19', 'IPHONE 13 128GB', 1, { mp_order_id: '12300', item_status: 'cancelled' });
    const orders = groupByOrder([c, a, b]);
    assert.deepEqual(orders.map((o) => [o.orderId, o.items.length, o.units, o.total, o.cancelled]), [
      ['12345', 2, 2, 5050, false],
      ['12300', 1, 0, 0, true],
    ]);
  });
});
