import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateFifo,
  compareTurnover,
  exitsBreakdown,
  fastestProducts,
  monthlyEvolution,
  normalizeUnitLines,
  periodTurnover,
  previousRange,
  stockAgeRows,
  summarizeStockAge,
  turnoverCategoryOf,
  turnoverRange,
  type StockMovement,
  type TurnoverLine,
} from './stockTurnover.ts';
import type { StockItem } from './stockMetrics.ts';

let seq = 0;
const line = (p: Partial<TurnoverLine> & Pick<TurnoverLine, 'productId' | 'soldAt'>): TurnoverLine => ({
  key: `k${++seq}`,
  orderId: `o${seq}`,
  name: 'CAPA CASE',
  type: 'ACESSORIOS',
  quantity: 1,
  entryDate: '2024-05-02',
  unit: false,
  paid: true,
  cancelled: false,
  ...p,
});
const mv = (productId: string, detectedAt: string, kind: StockMovement['kind'], quantity: number, entryDate: string | null = null): StockMovement => ({
  productId, detectedAt, kind, quantity, entryDate: kind === 'entry' ? entryDate ?? detectedAt.slice(0, 10) : null, name: 'PELICULA 3D', type: 'ACESSORIOS',
});
const stock = (p: Partial<StockItem> & Pick<StockItem, 'id' | 'quantity'>): StockItem => ({
  name: 'X', description: 'X', model: null, color: null, storage: null, condition: null, battery: null, cost: null, price: 10,
  availability: 'Disponível para venda', available: true, mpType: 'ACESSORIOS', isAccessory: true, isPart: false, entryDate: null, updatedAt: null, imei: null,
  ...p,
});

describe('categorias (uma por produto)', () => {
  it('iPhone pela regra oficial, película pelo nome, acessório pelo tipo oficial, resto em Outros', () => {
    assert.equal(turnoverCategoryOf('IPHONE 15 128GB', 'PRODUTO APPLE'), 'iphones');
    assert.equal(turnoverCategoryOf('15 PLUS - 128 GB - PINK', 'PRODUTO APPLE'), 'iphones');
    assert.equal(turnoverCategoryOf('PELÍCULA CERAMICA', 'ACESSORIOS'), 'peliculas');
    assert.equal(turnoverCategoryOf('PELICULA  VIDRO 3D - BND', 'BRINDES'), 'peliculas');
    assert.equal(turnoverCategoryOf('PELICULA TORTUGA SHILD', 'TORTUGA SHILD'), 'peliculas');
    assert.equal(turnoverCategoryOf('CAPA TRANS TORTUGA SHILD', 'TORTUGA SHILD'), 'acessorios');
    assert.equal(turnoverCategoryOf('CAPA TRANSPARENTE - BND', 'BRINDES'), 'acessorios');
    assert.equal(turnoverCategoryOf('MACBOOK AIR M2', 'PRODUTO APPLE'), 'outros');
    assert.equal(turnoverCategoryOf('TELA IPHONE 17', 'PEÇAS '), 'outros');
    assert.equal(turnoverCategoryOf('POCO X6 PRO', 'ANDROID'), 'outros');
    // Auditoria M4: iPhone só pelo modelo (tipo oficial Apple) e película com erro de digitação.
    assert.equal(turnoverCategoryOf('15 PLUS', 'PRODUTO APPLE'), 'iphones');
    assert.equal(turnoverCategoryOf('15 PLUS', 'ACESSORIOS'), 'acessorios');
    assert.equal(turnoverCategoryOf('PEÍCULA DE CÂMERA ZEUS', 'ACESSORIOS'), 'peliculas');
    assert.equal(turnoverCategoryOf('IPAD 11', 'PRODUTO APPLE'), 'outros');
    assert.equal(turnoverCategoryOf('PELE SINTETICA CAPA', 'ACESSORIOS'), 'acessorios');
  });
});

describe('giro de unidades (IMEI/série)', () => {
  it('data real; venda antes da entrada = encomenda, fora da média; cancelada não conta', () => {
    const lines = [
      line({ productId: 'i1', name: 'IPHONE 15 128GB', type: 'PRODUTO APPLE', unit: true, entryDate: '2026-10-01', soldAt: '2026-10-11 10:00:00' }),
      line({ productId: 'i2', name: 'IPHONE 13 128GB', type: 'PRODUTO APPLE', unit: true, entryDate: '2026-10-05', soldAt: '2026-10-25 10:00:00' }),
      line({ productId: 'i3', name: 'IPHONE 17 LACRADO', type: 'PRODUTO APPLE', unit: true, entryDate: '2026-10-12', soldAt: '2026-10-10 10:00:00' }),
      line({ productId: 'i4', name: 'IPHONE 14', type: 'PRODUTO APPLE', unit: true, entryDate: '2026-10-01', soldAt: '2026-10-11 10:00:00', cancelled: true }),
    ];
    const t = periodTurnover(lines, allocateFifo(lines, []), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual([t.avgDays, t.measured, t.preorder, t.sold], [15, 2, 1, 3]);
    assert.equal(t.byCategory.iphones.avgDays, 15);
  });
});

describe('FIFO dos lotes', () => {
  const movements = [
    mv('p1', '2026-10-21 10:00:00', 'baseline', 3),
    mv('p1', '2026-10-25 09:00:00', 'entry', 10, '2026-10-25'),
    mv('p1', '2026-11-05 09:00:00', 'entry', 20, '2026-11-05'),
  ];
  const lines = [
    // Antes do rastreamento: idade desconhecida.
    line({ productId: 'p1', name: 'PELICULA 3D', soldAt: '2026-10-20 12:00:00', quantity: 2 }),
    // Consome o saldo inicial (2 desconhecidas) + 1 do lote de 25/10.
    line({ productId: 'p1', name: 'PELICULA 3D', soldAt: '2026-10-26 12:00:00', quantity: 3 }),
    // Brinde: consome 1 do lote, mas não entra no giro de vendas.
    line({ productId: 'p1', name: 'PELICULA 3D', soldAt: '2026-10-27 12:00:00', quantity: 1, paid: false }),
    // Venda grande: 8 restantes do lote 25/10 (10 dias) + 4 do lote 05/11 (0 dias).
    line({ productId: 'p1', name: 'PELICULA 3D', soldAt: '2026-11-04 12:00:00', quantity: 8 }),
    line({ productId: 'p1', name: 'PELICULA 3D', soldAt: '2026-11-05 18:00:00', quantity: 4 }),
  ];
  const fifo = allocateFifo(lines, movements, new Map([['p1', 16]]));

  it('aloca por ordem de entrada, separando idade desconhecida', () => {
    assert.deepEqual(fifo.pieces.get(lines[0].key), [{ quantity: 2, days: null, reason: 'before_tracking' }]);
    assert.deepEqual(fifo.pieces.get(lines[1].key), [{ quantity: 3, days: null, reason: 'baseline' }]);
    assert.deepEqual(fifo.pieces.get(lines[3].key), [{ quantity: 8, days: 10 }]);
    assert.deepEqual(fifo.pieces.get(lines[4].key), [{ quantity: 1, days: 11 }, { quantity: 3, days: 0 }]);
  });

  it('giro do período: média ponderada só das unidades com lote datado; brinde à parte', () => {
    const t = periodTurnover(lines, fifo, { from: '2026-10-21', to: '2026-11-30' });
    // 26/10: 3 do saldo inicial (desconhecidas). 04/11: 8 do lote 25/10 = 10 dias. 05/11: 1 do lote 25/10 (11 dias) + 3 do lote 05/11 (0 dias).
    assert.equal(t.measured, 12);
    assert.equal(t.unknown, 3);
    assert.equal(t.brinde, 1);
    assert.equal(t.sold, 15);
    assert.equal(t.avgDays, (8 * 10 + 1 * 11 + 3 * 0) / 12);
  });

  it('saldo restante = lotes mais novos, ajustado ao estoque ao vivo', () => {
    // Entraram 3+10+20 = 33; saíram 3+1+8+4 = 16 → sobram 17; ao vivo 16 → 1 baixa não vista sai do mais antigo.
    assert.deepEqual(fifo.remaining.get('p1'), [{ quantity: 16, entryDate: '2026-11-05' }]);
    const rows = stockAgeRows([stock({ id: 'p1', quantity: 16, description: 'PELICULA 3D' })], fifo, '2026-11-15');
    assert.deepEqual([rows[0].method, rows[0].avgDays, rows[0].knownUnits, rows[0].unknownUnits, rows[0].oldestEntry], ['fifo', 10, 16, 0, '2026-11-05']);
  });

  it('estoque maior que o rastreado: excesso fica com idade desconhecida (não inventa)', () => {
    const f = allocateFifo([], [mv('p2', '2026-10-21 10:00:00', 'entry', 5, '2026-10-21')], new Map([['p2', 8]]));
    assert.deepEqual(f.remaining.get('p2'), [{ quantity: 3, entryDate: null }, { quantity: 5, entryDate: '2026-10-21' }]);
  });

  it('rastreamento mais antigo que a janela: saldo no início vira lote sem data (supervisor #4)', () => {
    const ms: StockMovement[] = [
      { ...mv('p3', '2025-01-10 10:00:00', 'entry', 50, '2025-01-10'), quantityAfter: 50 },
      { ...mv('p3', '2025-06-10 10:00:00', 'exit', 45), quantityAfter: 5 },
      { ...mv('p3', '2026-10-01 10:00:00', 'entry', 20, '2026-10-01'), quantityAfter: 25 },
    ];
    const ls = [line({ productId: 'p3', soldAt: '2026-10-05 10:00:00', quantity: 6 })];
    const f = allocateFifo(ls, ms, new Map([['p3', 19]]), '2025-10-01');
    // Os 5 de antes da janela saem primeiro (idade desconhecida), depois 1 do lote de 01/10 (4 dias).
    assert.deepEqual(f.pieces.get(ls[0].key), [{ quantity: 5, days: null, reason: 'baseline' }, { quantity: 1, days: 4 }]);
    assert.deepEqual(f.remaining.get('p3'), [{ quantity: 19, entryDate: '2026-10-01' }]);
  });

  it('sem rastreamento: tudo desconhecido', () => {
    const l = [line({ productId: 'p9', soldAt: '2026-10-26 10:00:00', quantity: 50 })];
    const t = periodTurnover(l, allocateFifo(l, []), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual([t.avgDays, t.unknown, t.sold], [null, 50, 50]);
  });
});

describe('períodos e comparação', () => {
  it('presets e período anterior', () => {
    assert.deepEqual(turnoverRange('last7', '2026-10-21'), { from: '2026-10-15', to: '2026-10-21' });
    assert.deepEqual(turnoverRange('last30', '2026-10-21'), { from: '2026-09-22', to: '2026-10-21' });
    assert.deepEqual(turnoverRange('month', '2026-10-21'), { from: '2026-10-01', to: '2026-10-21' });
    assert.deepEqual(turnoverRange('lastMonth', '2026-10-21'), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(previousRange('last7', { from: '2026-10-15', to: '2026-10-21' }), { from: '2026-10-08', to: '2026-10-14' });
    assert.deepEqual(previousRange('month', { from: '2026-10-01', to: '2026-10-21' }), { from: '2026-09-01', to: '2026-09-21' });
    assert.deepEqual(previousRange('lastMonth', { from: '2026-09-01', to: '2026-09-30' }), { from: '2026-08-01', to: '2026-08-31' });
    assert.deepEqual(previousRange('month', { from: '2026-03-01', to: '2026-03-31' }), { from: '2026-02-01', to: '2026-02-28' });
  });
  it('tendência: menos dias = giro mais rápido', () => {
    assert.deepEqual(compareTurnover(10, 14), { delta: -4, trend: 'faster' });
    assert.deepEqual(compareTurnover(14, 10), { delta: 4, trend: 'slower' });
    assert.equal(compareTurnover(10.2, 10).trend, 'stable');
    assert.equal(compareTurnover(null, 10).trend, 'n/a');
  });
});

describe('detalhamento', () => {
  const lines = [
    line({ productId: 'a', name: 'IPHONE 15 128GB', unit: true, entryDate: '2026-10-01', soldAt: '2026-10-03 10:00:00' }),
    line({ productId: 'b', name: 'IPHONE 15 128GB', unit: true, entryDate: '2026-10-01', soldAt: '2026-10-05 10:00:00' }),
    line({ productId: 'c', name: 'IPHONE 13 128GB', unit: true, entryDate: '2026-09-01', soldAt: '2026-10-01 10:00:00' }),
  ];
  const fifo = allocateFifo(lines, []);
  it('giro mais rápido respeita o mínimo de vendas', () => {
    const r = fastestProducts(lines, fifo, { from: '2026-10-01', to: '2026-10-31' }, 'all', 2);
    assert.deepEqual(r.map((p) => [p.name, p.units, p.avgDays]), [['IPHONE 15 128GB', 2, 3]]);
    assert.equal(fastestProducts(lines, fifo, { from: '2026-10-01', to: '2026-10-31' }, 'all', 1).length, 2);
  });
  it('evolução mensal por categoria', () => {
    const ev = monthlyEvolution(lines, fifo, '2026-09', '2026-10-21');
    assert.deepEqual(ev.map((p) => [p.month, p.values.iphones ?? null, p.units.iphones]), [['2026-09', null, 0], ['2026-10', (2 + 4 + 30) / 3, 3]]);
  });
  it('idade do estoque atual não mistura com vendidos; unidade usa a data real', () => {
    const rows = stockAgeRows(
      [stock({ id: 'u1', quantity: 1, unitTracked: true, entryDate: '2026-10-01', description: 'IPHONE 15', model: 'IPHONE 15', mpType: 'PRODUTO APPLE' }), stock({ id: 'z', quantity: 40, description: 'CAPA CASE' })],
      fifo,
      '2026-10-21'
    );
    const s = summarizeStockAge(rows);
    assert.deepEqual([s.avgDays, s.knownUnits, s.unknownUnits], [20, 1, 40]);
    assert.equal(s.byCategory.iphones.avgDays, 20);
  });
  it('saídas: venda, brinde e outras (baixas além do histórico, só com rastreamento cobrindo o período)', () => {
    const ls = [line({ productId: 'p', soldAt: '2026-10-22 10:00:00', quantity: 2 }), line({ productId: 'p', soldAt: '2026-10-22 11:00:00', quantity: 1, paid: false })];
    const ms = [mv('p', '2026-10-21 08:00:00', 'baseline', 10), mv('p', '2026-10-22 12:00:00', 'exit', 5)];
    assert.deepEqual(exitsBreakdown(ls, ms, { from: '2026-10-21', to: '2026-10-31' }), { sale: 2, brinde: 1, other: 2 });
    assert.deepEqual(exitsBreakdown(ls, ms, { from: '2026-10-01', to: '2026-10-31' }), { sale: 2, brinde: 1, other: null });
  });
});

describe('normalizeUnitLines', () => {
  it('cadastro "unidade" vendido mais de uma vez vira lote', () => {
    const ls = normalizeUnitLines([
      line({ productId: 'w', name: 'SMART WATCH PREMIUM ULTRA', unit: true, soldAt: '2026-10-01 10:00:00' }),
      line({ productId: 'w', name: 'SMART WATCH PREMIUM ULTRA', unit: true, soldAt: '2026-10-02 10:00:00' }),
      line({ productId: 'i', name: 'IPHONE 15', unit: true, soldAt: '2026-10-02 10:00:00' }),
    ]);
    assert.deepEqual(ls.map((l) => l.unit), [false, false, true]);
  });
});
