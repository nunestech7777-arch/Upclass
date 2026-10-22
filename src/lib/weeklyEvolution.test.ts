import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyEvolution, hasWeeklyEvolution, weekDateKeys } from './weeklyEvolution.ts';

const monday = new Date(2026, 9, 19); // 19/10/2026 é segunda-feira

test('semana de segunda a domingo com datas reais', () => {
  assert.deepEqual(weekDateKeys(monday), [
    '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
  ]);
});

test('acumulado sobe com as vendas reais e dias futuros ficam vazios', () => {
  const daily = new Map([['2026-10-19', 10], ['2026-10-21', 20], ['2026-10-22', 9]]);
  const pts = buildWeeklyEvolution(monday, daily, 310, '2026-10-22');
  assert.deepEqual(pts.map((p) => p.realized), [10, 10, 30, 39, null, null, null]);
  assert.equal(pts[3].isToday, true);
  assert.equal(pts[4].isFuture, true);
  // o último acumulado realizado é o total vendido da semana
  assert.equal(pts[3].realized, 39);
});

test('ritmo esperado começa em zero e chega na meta no domingo', () => {
  const pts = buildWeeklyEvolution(monday, new Map(), 310, '2026-10-22');
  assert.equal(pts[0].expected, 0);
  assert.equal(pts[6].expected, 310);
  assert.ok(pts.every((p, i) => i === 0 || p.expected > pts[i - 1].expected));
});

test('sem vendas não há evolução para desenhar', () => {
  const pts = buildWeeklyEvolution(monday, new Map(), 310, '2026-10-22');
  assert.equal(hasWeeklyEvolution(pts), false);
});
