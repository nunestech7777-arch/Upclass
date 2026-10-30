// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSellerBackfill } from './sellerBackfill.ts';

test('preenche só quando o responsável do lead está vinculado; o resto é contado, não inventado', () => {
  const plan = planSellerBackfill(
    [
      { id: 'c1', kommo_lead_id: '100' },
      { id: 'c2', kommo_lead_id: '101' },
      { id: 'c3', kommo_lead_id: '102' },
      { id: 'c4', kommo_lead_id: null },
      { id: 'c5', kommo_lead_id: '100' },
    ],
    new Map([
      ['100', '15815704'],
      ['101', '11336555'],
    ]),
    new Map([['15815704', 'seller-caroline']])
  );
  assert.deepEqual(plan.assignments, [
    { id: 'c1', seller_id: 'seller-caroline' },
    { id: 'c5', seller_id: 'seller-caroline' },
  ]);
  assert.deepEqual(plan.bySeller, { 'seller-caroline': 2 });
  assert.deepEqual(plan.unlinkedResponsible, { '11336555': 1 });
  assert.equal(plan.leadNotFound, 2);
});
