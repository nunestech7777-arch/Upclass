import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripIdentifiers, toSellerStockItem, toStockItems } from './stockItems.ts';

describe('estoque para vendedor', () => {
  it('não leva custo, IMEI nem datas; mantém preço de venda e disponibilidade', () => {
    const [full] = toStockItems([
      {
        id: 11677039,
        descricao: '11677039 - IPHONE XR - BLUE - 64GB - Estado: SEMI NOVO - IMEI: 356000000000001',
        aparelhoDescricao: 'IPHONE XR',
        corDescricao: 'BLUE',
        gbDescricao: '64GB',
        quantidade: 1,
        valorCusto: 900,
        valorVenda: 1499,
        produtoDisponibilidadeId: 1,
        imei: '356000000000001',
        dataEntrada: '2026-10-01',
      },
    ]);
    assert.equal(full.cost, 900);
    const item = toSellerStockItem(full);
    const keys = Object.keys(item);
    for (const banned of ['cost', 'imei', 'entryDate', 'updatedAt']) assert.ok(!keys.includes(banned), banned);
    assert.ok(!JSON.stringify(item).includes('900'));
    assert.ok(!JSON.stringify(item).includes('356000000000001'));
    assert.deepEqual([item.price, item.available, item.color, item.storage, item.quantity], [1499, true, 'BLUE', '64GB', 1]);
  });
});

describe('identificadores fora da descrição do vendedor', () => {
  it('remove IMEI/série em formatos que a limpeza da tela não cobre', () => {
    assert.equal(stripIdentifiers('IPHONE XR - IMEI2: 359912345678901'), 'IPHONE XR');
    assert.equal(stripIdentifiers('IPHONE XR - BLUE - IMEI1: 35'), 'IPHONE XR - BLUE');
    assert.equal(stripIdentifiers('CAPA - S/N: ABC123'), 'CAPA');
    assert.equal(stripIdentifiers('IPHONE 13 64GB IMEI 351234567890123'), 'IPHONE 13 64GB');
    assert.equal(stripIdentifiers('PELICULA 3D'), 'PELICULA 3D');
  });
  it('aparelho com modelo: descrição só dos campos estruturados', () => {
    const [full] = toStockItems([{ id: 1, descricao: '1 - IPHONE 13 - AZUL - 128GB - obs interna: IMEI2 3599', aparelhoDescricao: 'IPHONE 13', corDescricao: 'AZUL', gbDescricao: '128GB', quantidade: 1, valorVenda: 3000 }]);
    assert.equal(toSellerStockItem(full).description, 'IPHONE 13 - AZUL - 128GB');
  });
});
