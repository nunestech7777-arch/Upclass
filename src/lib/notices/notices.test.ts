import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmptyDaysNotice,
  buildMissingCostNotice,
  buildPartialResultNotice,
  currentNoticeMonth,
  noticeCount,
  pendingItemsOf,
  sortNotices,
  type MissingCostNotice,
  type MissingCostRow,
} from './notices.ts';
import { emptyPendingCounts, type Coverage, type FinanceSale } from '../finance/calc.ts';

let seq = 0;
function row(o: Partial<MissingCostRow> = {}): MissingCostRow {
  seq += 1;
  return {
    id: `s${seq}`,
    mp_order_id: `o${seq}`,
    sold_at: '2026-10-31T18:00:00+00:00',
    sold_date: '2026-10-31',
    amount: 1300,
    cost: 0,
    profit: 1300,
    financial_status: 'ok',
    financial_note: 'Custo zero informado pela origem',
    product_type: 'PRODUTO APPLE',
    item_status: 'active',
    product_name: 'IPHONE 11',
    ...o,
  };
}

describe('aviso de itens sem custo no Mercado Phone', () => {
  it('produto Apple com custo 0 e custo vazio entram, com a situação de cada um', () => {
    const n = buildMissingCostNotice([
      row({ id: 'zero', mp_order_id: '8881664' }),
      row({ id: 'vazio', mp_order_id: '8800001', cost: null, profit: null, financial_status: 'pending', financial_note: 'Custo não informado pela origem', sold_at: '2026-10-30T12:00:00+00:00', sold_date: '2026-10-30' }),
    ])!;
    assert.equal(n.count, 2);
    assert.deepEqual(n.orders, ['8881664', '8800001']);
    assert.deepEqual(
      n.items.map((i) => [i.saleId, i.situation]),
      [
        ['zero', 'cost_zero'],
        ['vazio', 'cost_missing'],
      ]
    );
    assert.equal(n.latestAt, '2026-10-31T18:00:00+00:00');
  });

  it('custo zero legítimo (serviço, brinde) e itens conciliados não entram', () => {
    const n = buildMissingCostNotice([
      row({ product_type: 'ACESSORIOS', product_name: 'PROTEÇÃO/SEGURO ADESAO', amount: 100 }),
      row({ amount: 0, profit: 0, product_name: 'CAPA - BND' }),
      row({ cost: 2800, profit: 747.6, financial_note: null }),
    ]);
    assert.equal(n, null);
  });

  it('linha cancelada/removida ou repetida não conta (sem duplicar)', () => {
    const a = row({ id: 'x' });
    const n = buildMissingCostNotice([a, { ...a }, row({ item_status: 'removed' })])!;
    assert.equal(n.count, 1);
  });

  it('nota antiga de custo vazio numa linha já conciliada não conta (mesmo critério do banner)', () => {
    assert.equal(buildMissingCostNotice([row({ cost: 900, profit: 400, financial_note: 'Custo não informado pela origem' })]), null);
  });

  it('venda anterior ao início da rotina com custo 0 entra (o banner também a classifica como sem custo)', () => {
    assert.equal(buildMissingCostNotice([row({ sold_date: '2026-08-20', sold_at: '2026-08-20T12:00:00+00:00' })])!.count, 1);
  });

  it('custo corrigido na origem e conciliado: o aviso some', () => {
    assert.equal(buildMissingCostNotice([row({ cost: 950, profit: 350, financial_note: null })]), null);
  });

  it('pedido com vários itens sem custo aparece uma vez na lista de pedidos', () => {
    const n = buildMissingCostNotice([row({ mp_order_id: '9' }), row({ mp_order_id: '9' })])!;
    assert.equal(n.count, 2);
    assert.deepEqual(n.orders, ['9']);
  });
});

describe('ordenação e contador', () => {
  const notice = (id: string, severity: MissingCostNotice['severity'], latestAt: string, count = 1): MissingCostNotice => ({
    id,
    kind: 'missing_cost',
    severity,
    title: id,
    count,
    latestAt,
    orders: [],
    items: [],
  });
  it('gravidade primeiro, depois o mais recente', () => {
    const sorted = sortNotices([
      notice('info', 'info', '2026-11-02'),
      notice('warn-old', 'warning', '2026-10-01'),
      notice('crit', 'critical', '2026-09-01'),
      notice('warn-new', 'warning', '2026-10-31'),
    ]);
    assert.deepEqual(
      sorted.map((n) => n.id),
      ['crit', 'warn-new', 'warn-old', 'info']
    );
  });
  it('contador do sino soma as pendências', () => {
    assert.equal(noticeCount([notice('a', 'warning', 'x', 9), notice('b', 'info', 'y', 2)]), 11);
    assert.equal(noticeCount([]), 0);
  });
});

describe('avisos da página (resultado parcial e dias sem vendas)', () => {
  const now = Date.parse('2026-11-02T17:00:00Z');
  const sale = (o: Partial<FinanceSale>): FinanceSale => ({
    id: o.id ?? 's',
    seller_id: 'a',
    product_id: 'i11',
    quantity: 1,
    amount: 1000,
    sold_at: '2026-10-30T12:00:00+00:00',
    sold_date: '2026-10-30',
    external_id: null,
    mp_order_id: 'o',
    item_status: 'active',
    revenue: 900,
    cost: 600,
    profit: 300,
    profit_reported: 300,
    financial_status: 'ok',
    financial_note: null,
    customer_name: null,
    product_type: 'PRODUTO APPLE',
    ...o,
  });
  const names = new Map([['i11', 'IPHONE 11']]);
  const coverage = (items: number, reconciled: number): Coverage => ({
    items,
    reconciled,
    pending: emptyPendingCounts(),
    revenueKnown: 0,
    amountPending: 2300,
    complete: items === reconciled,
    completeUntilCutoff: items === reconciled,
    missingCostOrders: [],
  });

  it('pendentes do período com motivo; conciliados e removidos ficam fora', () => {
    const items = pendingItemsOf(
      [
        sale({ id: 'ok' }),
        sale({ id: 'zero', cost: 0, profit: 1000, revenue: 1000, mp_order_id: '8881664' }),
        sale({ id: 'novo', financial_status: 'pending', revenue: null, cost: null, profit: null, created_at: '2026-11-02T16:50:00Z' }),
        sale({ id: 'velho', financial_status: 'pending', revenue: null, cost: null, profit: null, created_at: '2026-11-01T10:00:00Z' }),
        sale({ id: 'fora', item_status: 'removed', cost: 0, profit: 1000 }),
      ],
      names,
      now
    );
    assert.deepEqual(
      items.map((i) => [i.saleId, i.reason]).sort(),
      [
        ['novo', 'awaiting_source'],
        ['velho', 'sync_failure'],
        ['zero', 'missing_cost'],
      ]
    );
  });

  it('resultado parcial: motivos vêm dos itens; "sem custo" não soma de novo no sino', () => {
    const items = pendingItemsOf(
      [
        sale({ id: 'zero', cost: 0, profit: 1000, revenue: 1000 }),
        sale({ id: 'velho', financial_status: 'pending', revenue: null, cost: null, profit: null, created_at: '2026-11-01T10:00:00Z' }),
      ],
      names,
      now
    );
    const n = buildPartialResultNotice({ key: '2026-10', scope: 'outubro de 2026', coverage: coverage(10, 8), items, at: '2026-11-02T17:00:00Z' })!;
    assert.equal(n.id, 'partial_result:2026-10');
    assert.equal(n.title, 'Resultado parcial · outubro de 2026');
    assert.deepEqual(n.reasons, [
      { reason: 'missing_cost', count: 1 },
      { reason: 'sync_failure', count: 1 },
    ]);
    assert.equal(n.count, 1, 'só a falha de sincronização soma; o item sem custo já está no aviso global');
    assert.equal(n.severity, 'warning');
  });

  it('só sem custo: aviso informativo e sem somar no sino; tudo conciliado: sem aviso', () => {
    const items = pendingItemsOf([sale({ id: 'zero', cost: 0, profit: 1000, revenue: 1000 })], names, now);
    const n = buildPartialResultNotice({ key: '2026-10', scope: 'outubro de 2026', coverage: coverage(5, 4), items, at: 'x' })!;
    assert.equal(n.severity, 'info');
    assert.equal(n.count, 0);
    assert.equal(buildPartialResultNotice({ key: '2026-10', scope: 'x', coverage: coverage(5, 5), items: [], at: 'x' }), null);
  });

  it('dias sem vendas: um aviso por período, dias em ordem; sem dias, sem aviso', () => {
    const n = buildEmptyDaysNotice({ key: '2026-10', scope: 'outubro de 2026', days: ['2026-10-25', '2026-10-04'], lastSaleAt: '31/10/2026 22:25' })!;
    assert.equal(n.id, 'empty_days:2026-10');
    assert.deepEqual(n.days, ['2026-10-04', '2026-10-25']);
    assert.equal(n.count, 2);
    assert.equal(buildEmptyDaysNotice({ key: '2026-10', scope: 'x', days: [], lastSaleAt: null }), null);
  });
});

describe('aviso de custo só do mês atual (fuso de Brasília)', () => {
  const nov = (o: Partial<MissingCostRow> = {}) => row({ sold_at: '2026-11-03T15:00:00+00:00', sold_date: '2026-11-03', ...o });
  const old = (date: string, o: Partial<MissingCostRow> = {}) => row({ sold_at: `${date}T15:00:00+00:00`, sold_date: date, ...o });

  it('setembro e outubro não entram em lista, contador, pedidos nem valor total', () => {
    const rows = [old('2026-09-19'), old('2026-10-31', { amount: 2000 }), old('2026-10-02'), nov({ amount: 4000 })];
    const n = buildMissingCostNotice(rows, '2026-11')!;
    assert.equal(n.count, 1);
    assert.equal(n.items.length, 1);
    assert.equal(n.items[0].amount, 4000);
    assert.equal(n.orders.length, 1);
    assert.equal(noticeCount([n]), 1);
  });

  it('novembro totalmente conciliado: nenhum aviso, mesmo com pendências antigas no banco', () => {
    assert.equal(buildMissingCostNotice([old('2026-09-19'), old('2026-10-20')], '2026-11'), null);
  });

  it('sem escopo informado o comportamento anterior é mantido (todos os meses)', () => {
    assert.equal(buildMissingCostNotice([old('2026-09-19'), nov()])!.count, 2);
  });

  it('virada do mês: o aviso de novembro deixa de aparecer em dezembro, sozinho', () => {
    const rows = [nov(), old('2026-12-02')];
    assert.equal(buildMissingCostNotice(rows, '2026-11')!.count, 1);
    assert.equal(buildMissingCostNotice(rows, '2026-12')!.count, 1);
    assert.equal(buildMissingCostNotice(rows, '2026-12')!.items[0].soldDate, '2026-12-02');
    assert.equal(buildMissingCostNotice([nov()], '2026-12'), null);
  });

  it('mês atual segue o horário de Brasília, não o UTC', () => {
    // 01/12 01:30 UTC ainda é 30/11 22:30 em Brasília.
    assert.equal(currentNoticeMonth(new Date('2026-12-01T01:30:00Z')), '2026-11');
    assert.equal(currentNoticeMonth(new Date('2026-12-01T03:00:00Z')), '2026-12');
    assert.equal(currentNoticeMonth(new Date('2027-01-01T02:59:00Z')), '2026-12');
    assert.equal(currentNoticeMonth(new Date('2027-01-01T03:00:00Z')), '2027-01');
  });
});
