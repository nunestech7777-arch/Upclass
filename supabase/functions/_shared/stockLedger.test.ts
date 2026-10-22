import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLedgerItem, isUnitTracked, planStockMovements, type LevelRow } from './stockLedger.ts';

const item = (id: number, quantidade: number, extra: Record<string, unknown> = {}) => ({
  id,
  quantidade,
  aparelhoDescricao: `PRODUTO ${id}`,
  tipoProdutoDescricao: 'ACESSORIOS',
  dataEntrada: '2024-05-02',
  ...extra,
});
const level = (id: number, quantity: number, last_seen_date = '2026-10-21'): LevelRow => ({ product_external_id: String(id), quantity, last_seen_date });

describe('planStockMovements', () => {
  it('primeira leitura: saldo vira baseline sem data (nunca inventa a idade)', () => {
    const p = planStockMovements([], [item(1, 10), item(2, 0)], '2026-10-21');
    assert.deepEqual(p.movements.map((m) => [m.product_external_id, m.kind, m.quantity, m.entry_date]), [['1', 'baseline', 10, null]]);
    assert.equal(p.levels.length, 2);
  });

  it('aumento = entrada na data da detecção; redução = saída', () => {
    const p = planStockMovements([level(1, 10), level(2, 5)], [item(1, 25), item(2, 3)], '2026-10-22');
    assert.deepEqual(p.movements.map((m) => [m.product_external_id, m.kind, m.quantity, m.quantity_after, m.entry_date]), [
      ['1', 'entry', 15, 25, '2026-10-22'],
      ['2', 'exit', 2, 3, null],
    ]);
  });

  it('dataEntrada do MercadoPhone posterior à leitura anterior é usada (data real informada)', () => {
    const p = planStockMovements([level(1, 0, '2026-10-20')], [item(1, 30, { dataEntrada: '2026-10-21' })], '2026-10-22');
    assert.equal(p.movements[0].entry_date, '2026-10-21');
  });

  it('produto novo após a 1ª leitura: cadastro recente usa dataEntrada; reposição de cadastro antigo usa a detecção', () => {
    const levels = [level(1, 5, '2026-10-21')];
    const p = planStockMovements(levels, [item(1, 5), item(2, 12, { dataEntrada: '2026-10-21' }), item(3, 8, { dataEntrada: '2024-01-22' })], '2026-10-21');
    assert.deepEqual(p.movements.map((m) => [m.product_external_id, m.kind, m.quantity, m.entry_date]), [
      ['2', 'entry', 12, '2026-10-21'],
      ['3', 'entry', 8, '2026-10-21'],
    ]);
  });

  it('produto que sumiu da lista completa saiu inteiro; zerado não gera nada de novo', () => {
    const p = planStockMovements([level(1, 4), level(2, 0)], [], '2026-10-22');
    assert.deepEqual(p.movements.map((m) => [m.product_external_id, m.kind, m.quantity, m.quantity_after]), [['1', 'exit', 4, 0]]);
    assert.deepEqual(p.zeroed, ['1']);
  });

  it('reposição e venda na mesma janela não se anulam (auditoria M1)', () => {
    const interval = { sold: new Map([['1', 10]]), returned: new Map<string, number>() };
    const p = planStockMovements([level(1, 10)], [item(1, 10)], '2026-10-22', interval);
    assert.deepEqual(p.movements.map((m) => [m.kind, m.quantity, m.quantity_after]), [['entry', 10, 10], ['exit', 10, 10]]);
  });

  it('volta de venda cancelada = devolução sem data, não reposição (auditoria M2)', () => {
    const interval = { sold: new Map<string, number>(), returned: new Map([['1', 1]]) };
    const p = planStockMovements([level(1, 5)], [item(1, 6)], '2026-10-22', interval);
    assert.deepEqual(p.movements.map((m) => [m.kind, m.quantity, m.entry_date]), [['return', 1, null]]);
    // Aumento maior que a devolução: o excedente é reposição.
    const p2 = planStockMovements([level(1, 5)], [item(1, 16)], '2026-10-22', interval);
    assert.deepEqual(p2.movements.map((m) => [m.kind, m.quantity]), [['return', 1], ['entry', 10]]);
  });

  it('item que só deixou de ser rastreável não gera saída falsa (auditoria L1)', () => {
    const p = planStockMovements([level(1, 4)], [item(1, 4, { serialNumber: 'S1', tipoProdutoDescricao: 'PRODUTO APPLE' })], '2026-10-22');
    assert.deepEqual(p.movements, []);
    // Nível zerado sem saída (não fica valor velho).
    assert.deepEqual(p.zeroed, ['1']);
  });

  it('produto novo vendido na mesma janela: entrada inclui o vendido', () => {
    const interval = { sold: new Map([['2', 3]]), returned: new Map<string, number>() };
    const p = planStockMovements([level(1, 5)], [item(1, 5), item(2, 7, { dataEntrada: '2026-10-22' })], '2026-10-22', interval);
    assert.deepEqual(p.movements.map((m) => [m.product_external_id, m.kind, m.quantity, m.quantity_after]), [['2', 'entry', 10, 7], ['2', 'exit', 3, 7]]);
  });

  it('sem mudança: nada a registrar', () => {
    assert.deepEqual(planStockMovements([level(1, 4)], [item(1, 4)], '2026-10-22').movements, []);
  });
});

describe('isLedgerItem', () => {
  it('unidade com IMEI/série, serviço e itens de controle ficam fora', () => {
    assert.equal(isLedgerItem(item(1, 1, { imei: '3551', tipoProdutoDescricao: 'PRODUTO APPLE' })), false);
    assert.equal(isLedgerItem(item(1, 1, { serialNumber: 'G4RC', tipoProdutoDescricao: 'PRODUTO APPLE' })), false);
    assert.equal(isLedgerItem(item(1, 999999)), false);
    assert.equal(isLedgerItem(item(1, 3, { aparelhoDescricao: 'SEGURO ROUBO' })), false);
    assert.equal(isLedgerItem(item(1, 3, { snServico: 1 })), false);
    assert.equal(isLedgerItem(item(1, 3)), true);
  });
});

describe('isUnitTracked', () => {
  it('IMEI/série só vale como unidade fora dos tipos vendidos em lote', () => {
    assert.equal(isUnitTracked({ imei: '3551', tipoProdutoDescricao: 'PRODUTO APPLE' }), true);
    assert.equal(isUnitTracked({ imei1: '3551', tipoProdutoDescricao: 'ANDROID' }), true);
    assert.equal(isUnitTracked({ serialNumber: 'X1', tipoProdutoDescricao: 'ACESSORIOS' }), false);
    assert.equal(isUnitTracked({ serialNumber: 'X1', tipoProdutoDescricao: 'BRINDES' }), false);
    assert.equal(isUnitTracked({ tipoProdutoDescricao: 'PRODUTO APPLE' }), false);
    // Acessório com série digitada entra no rastreamento por lote.
    assert.equal(isLedgerItem(item(1, 3, { serialNumber: 'X1' })), true);
  });
});
