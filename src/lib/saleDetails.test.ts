import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSaleExternalId, parseSaleOrderDetails, summarizeSaleItems, type SaleOrderEventRow } from './saleDetails.ts';

const baseRow: SaleOrderEventRow = {
  order_id: '1001',
  customer_name: '  CLIENTE TESTE  ',
  seller_name: 'CAROLINE ',
  status: 'concluido',
  sale_type: 'INDICAÇÃO',
  delivery_type: 'Retirada',
  sales_channel: null,
  discount: '0',
  total: '4036.00',
  canceled_at: null,
  cancel_reason: null,
  items: [
    { produtoId: 10, produtoNome: 'IPHONE 14 PRO MAX', quantidade: 1, valorUnitario: 3936, valorTotal: 3936, desconto: 0, imei: '123', serialNumber: null },
    { produtoId: 20, produtoNome: 'CAPA', quantidade: 2, valorUnitario: 50, valorTotal: 100, desconto: 0, imei: null, serialNumber: null },
  ],
  payments: [
    { id: 1, valor: 3000, formaPagamentoId: 2, formaPagamentoDescrita: 'PIX' },
    { id: 2, valor: 1036, formaPagamentoId: 3, formaPagamentoDescrita: 'DINHEIRO' },
  ],
};

describe('parseSaleExternalId', () => {
  it('separa venda, produto e índice do item', () => {
    assert.deepEqual(parseSaleExternalId('8412779-149442-0'), { orderId: '8412779', productId: '149442', itemIndex: 0 });
  });

  it('devolve null para formatos desconhecidos', () => {
    assert.equal(parseSaleExternalId(null), null);
    assert.equal(parseSaleExternalId(''), null);
    assert.equal(parseSaleExternalId('8412779'), null);
    assert.equal(parseSaleExternalId('abc-1-0'), null);
  });
});

describe('parseSaleOrderDetails', () => {
  it('normaliza cliente, totais, itens e pagamentos', () => {
    const details = parseSaleOrderDetails(baseRow, { orderId: '1001', productId: '20', itemIndex: 1 });
    assert.equal(details.customerName, 'CLIENTE TESTE');
    assert.equal(details.total, 4036);
    assert.equal(details.discount, 0);
    assert.equal(details.salesChannel, null);
    assert.equal(details.currentItemIndex, 1);
    assert.deepEqual(details.payments, [
      { description: 'PIX', amount: 3000 },
      { description: 'DINHEIRO', amount: 1036 },
    ]);
    assert.equal(details.items[0].imei, '123');
  });

  it('não inventa valores para campos ausentes', () => {
    const details = parseSaleOrderDetails(
      { ...baseRow, customer_name: '   ', total: null, discount: '', items: null, payments: 'x' },
      { orderId: '1001', productId: '10', itemIndex: 0 }
    );
    assert.equal(details.customerName, null);
    assert.equal(details.total, null);
    assert.equal(details.discount, null);
    assert.deepEqual(details.items, []);
    assert.deepEqual(details.payments, []);
    assert.equal(details.currentItemIndex, -1);
  });

  it('acha o item pelo produto quando a venda foi editada e o índice mudou', () => {
    const details = parseSaleOrderDetails(baseRow, { orderId: '1001', productId: '20', itemIndex: 0 });
    assert.equal(details.currentItemIndex, 1);
  });

  it('não escolhe item quando o produto sumiu ou é ambíguo', () => {
    assert.equal(parseSaleOrderDetails(baseRow, { orderId: '1001', productId: '99', itemIndex: 0 }).currentItemIndex, -1);
    const repeated = { ...baseRow, items: [{ produtoId: 20 }, { produtoId: 10 }, { produtoId: 20 }] };
    assert.equal(parseSaleOrderDetails(repeated, { orderId: '1001', productId: '20', itemIndex: 1 }).currentItemIndex, -1);
  });

  it('usa o vendedor de cada item, não o vendedor da venda', () => {
    const details = parseSaleOrderDetails(baseRow, { orderId: '1001', productId: '10', itemIndex: 0 }, [
      { external_id: '1001-10-0', seller_id: 'caroline' },
      { external_id: '1001-20-1', seller_id: 'graciane' },
      { external_id: '2002-20-1', seller_id: 'outra-venda' },
    ]);
    assert.equal(details.orderSellerName, 'CAROLINE');
    assert.deepEqual(details.items.map((item) => item.sellerId), ['caroline', 'graciane']);
  });

  it('deixa o vendedor do item vazio quando não há linha correspondente ou ela é ambígua', () => {
    const noRows = parseSaleOrderDetails(baseRow, { orderId: '1001', productId: '10', itemIndex: 0 });
    assert.deepEqual(noRows.items.map((item) => item.sellerId), [null, null]);
    const ambiguous = parseSaleOrderDetails(baseRow, { orderId: '1001', productId: '10', itemIndex: 0 }, [
      { external_id: '1001-20-4', seller_id: 'a' },
      { external_id: '1001-20-5', seller_id: 'b' },
    ]);
    assert.equal(ambiguous.items[1].sellerId, null);
  });
});

describe('summarizeSaleItems (venda com vários iPhones)', () => {
  const item = (name: string, quantity: number | null, total: number) => ({ name, quantity, total });
  it('venda real 8613940: 2 iPhones, 0 acessórios, 4 brindes', () => {
    assert.deepEqual(
      summarizeSaleItems([
        item('CAPA TRANSPARENTE - BND - . - .', 1, 0),
        item('CARREGADOR  COMPLETO  - BND - . - .', 1, 0),
        item('PELICULA  VIDRO 3D - BND - . - .', 1, 0),
        item('FONE COM FIO LIGHT E  TIPO C BND - . - .', 1, 0),
        item('IPHONE 18 PRO - 256GB - SLV', 1, 8500),
        item('IPHONE 17 PRO MAX - 256GB - SLV', 1, 7850),
      ]),
      { devices: 2, accessories: 0, gifts: 4, unknown: 0 }
    );
  });
  it('2 unidades do mesmo iPhone + 1 de outro modelo = 3 aparelhos', () => {
    assert.equal(summarizeSaleItems([item('IPHONE 15 PRO', 2, 9000), item('IPHONE 16 PRO', 1, 6000)]).devices, 3);
  });
  it('acessório pago conta; Apple Watch não é aparelho; quantidade ausente não é inventada', () => {
    assert.deepEqual(summarizeSaleItems([item('APPLE WATCH', 1, 2500), item('PELICULA', 2, 140), item('CAPA', null, 50)]), {
      devices: 0,
      accessories: 3,
      gifts: 0,
      unknown: 1,
    });
  });
});
