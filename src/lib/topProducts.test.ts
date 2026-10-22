import assert from 'node:assert/strict';
import test from 'node:test';
import { topByQuantity } from './topProducts.ts';

test('ordena por unidades, limita a 5 e ignora quantidade zero', () => {
  const rows = [
    { name: 'CAPA A', qty: 3, revenue: 9999 },
    { name: 'CABO', qty: 12, revenue: 1 },
    { name: 'FONE', qty: 7 },
    { name: 'PELÍCULA', qty: 7 },
    { name: 'CARREGADOR', qty: 5 },
    { name: 'SUPORTE', qty: 1 },
    { name: 'BRINDE', qty: 0 },
  ];
  const top = topByQuantity(rows);
  assert.deepEqual(top.map((r) => r.name), ['CABO', 'FONE', 'PELÍCULA', 'CARREGADOR', 'CAPA A']);
  assert.deepEqual(top.map((r) => r.qty), [12, 7, 7, 5, 3], 'faturamento não influencia a ordem');
});

test('menos de cinco produtos mostra só os existentes; sem vendas, lista vazia', () => {
  assert.equal(topByQuantity([{ name: 'IPHONE 15', qty: 2 }]).length, 1);
  assert.deepEqual(topByQuantity([]), []);
});
