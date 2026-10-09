import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapItemSellers, planSellerUpdates } from './itemSellers.ts';

// Venda real 8393342: iPhone e brindes com a vendedora da venda (40936), película com outra (40937).
const historico = [
  { vendaId: 8393342, produtoId: 149442, vendedorId: 40936, vendedorNome: 'CAROLINE ' },
  { vendaId: 8393342, produtoId: 11462852, vendedorId: 40936, vendedorNome: 'CAROLINE ' },
  { vendaId: 8393342, produtoId: 328423, vendedorId: 40937, vendedorNome: 'GRACIANE ' },
];
const sellerIds = new Map([['40936', 'uuid-caroline'], ['40937', 'uuid-graciane']]);

describe('mapItemSellers', () => {
  it('guarda o vendedor de cada item, sem herdar o vendedor da venda', () => {
    const map = mapItemSellers(historico);
    assert.deepEqual(map.get('8393342-328423'), { externalId: '40937', name: 'GRACIANE' });
    assert.deepEqual(map.get('8393342-11462852'), { externalId: '40936', name: 'CAROLINE' });
  });

  it('marca como ambíguo o mesmo produto com vendedores diferentes na mesma venda', () => {
    const map = mapItemSellers([
      { vendaId: 1, produtoId: 5, vendedorId: 10 },
      { vendaId: 1, produtoId: 5, vendedorId: 10 },
      { vendaId: 2, produtoId: 5, vendedorId: 10 },
      { vendaId: 2, produtoId: 5, vendedorId: 11 },
    ]);
    assert.equal(map.get('1-5')?.externalId, '10');
    assert.equal(map.get('2-5'), null);
  });

  it('ignora linhas sem vendedor', () => {
    assert.equal(mapItemSellers([{ vendaId: 1, produtoId: 5, vendedorId: null }]).size, 0);
  });
});

describe('planSellerUpdates', () => {
  const sales = [
    { id: 'a', external_id: '8393342-149442-0', seller_id: 'uuid-caroline' },
    { id: 'b', external_id: '8393342-11462852-4', seller_id: 'uuid-caroline' },
    { id: 'c', external_id: '8393342-328423-5', seller_id: 'uuid-caroline' },
  ];

  it('só muda a linha cujo vendedor do item é outro', () => {
    assert.deepEqual(planSellerUpdates(sales, mapItemSellers(historico), sellerIds), [
      { saleId: 'c', externalId: '8393342-328423-5', from: 'uuid-caroline', to: 'uuid-graciane' },
    ]);
  });

  it('não mexe em item ambíguo, sem histórico, sem vendedor cadastrado ou com id fora do padrão', () => {
    const map = mapItemSellers([
      { vendaId: 2, produtoId: 5, vendedorId: 10 },
      { vendaId: 2, produtoId: 5, vendedorId: 11 },
      { vendaId: 3, produtoId: 6, vendedorId: 99 },
    ]);
    const rows = [
      { id: 'x', external_id: '2-5-0', seller_id: 's' },
      { id: 'y', external_id: '3-6-0', seller_id: 's' },
      { id: 'z', external_id: '4-7-0', seller_id: 's' },
      { id: 'w', external_id: null, seller_id: 's' },
      { id: 'v', external_id: 'manual', seller_id: 's' },
    ];
    assert.deepEqual(planSellerUpdates(rows, map, sellerIds), []);
  });
});
