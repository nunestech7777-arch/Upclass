import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lineName, toTurnoverLines } from './turnoverLines.ts';

describe('toTurnoverLines', () => {
  it('normaliza e não repassa dados sensíveis', () => {
    const [a, b] = toTurnoverLines([
      { vendaId: 8650086, produtoId: 149442, quantidade: 1, dataVenda: '2026-10-20 19:15:00', dataEntrada: '2026-10-07', statusVenda: 'concluido', valorCliente: 0, aparelhoDescricao: 'CAPA TRANSPARENTE - BND', tipoProdutoDescricao: 'BRINDES', ...({ clienteNome: 'X', valorCusto: 3.5 } as object) },
      { vendaId: 8650086, produtoId: 149442, quantidade: 2, dataVenda: '2026-10-20 19:15:00', dataEntrada: '2026-10-07', statusVenda: 'cancelada', valorCliente: 30, imei1: '35510', aparelhoDescricao: 'IPHONE 15' },
    ]);
    assert.deepEqual(a, {
      key: '8650086-149442-0', orderId: '8650086', productId: '149442', name: 'CAPA TRANSPARENTE - BND', type: 'BRINDES', quantity: 1,
      soldAt: '2026-10-20 19:15:00', entryDate: '2026-10-07', unit: false, paid: false, cancelled: false,
    });
    assert.equal(b.key, '8650086-149442-1');
    assert.deepEqual([b.unit, b.paid, b.cancelled, b.quantity], [true, true, true, 2]);
    assert.ok(!JSON.stringify([a, b]).includes('Secreto'));
    assert.ok(!('clienteNome' in a) && !('valorCusto' in a));
  });
  it('nome de fallback sem IMEI/série (auditoria L2)', () => {
    assert.equal(lineName({ produtoId: 1, produtoDescricao: 'IPHONE 13 - AZUL - IMEI: 352552197859972 - SN: GD76X30NMV - Id: 1' }), 'IPHONE 13 - AZUL');
  });
  it('nome sem prefixo de tipo nem Id quando não há modelo', () => {
    assert.equal(lineName({ produtoId: 1, produtoDescricao: 'BRINDES - CAPA TRANSPARENTE - BND - . - . - . - Id: 149442' }), 'BRINDES - CAPA TRANSPARENTE - BND');
  });
});
