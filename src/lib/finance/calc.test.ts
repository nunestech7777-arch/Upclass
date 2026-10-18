import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, buildMonthFinance, computeIphoneBaseline, goalProgress, type FinanceSale, type FinanceSeller } from './calc.ts';

const sellers: FinanceSeller[] = [
  { id: 'ana', name: 'Ana', photo_url: null, active: true, show_in_ranking: true },
  { id: 'bia', name: 'Bia', photo_url: null, active: true, show_in_ranking: false },
  { id: 'brindes', name: 'BRINDES', photo_url: null, active: true, show_in_ranking: false },
];
const productNames = new Map([
  ['iphone', 'IPHONE 15 128GB'],
  ['capa', 'CAPA CASE'],
  ['brinde', 'CAPA TRANSPARENTE - BND'],
]);

let seq = 0;
function sale(o: Partial<FinanceSale> & Pick<FinanceSale, 'seller_id' | 'product_id' | 'sold_date'>): FinanceSale {
  seq += 1;
  return {
    id: `s${seq}`,
    quantity: 1,
    amount: 0,
    sold_at: `${o.sold_date}T12:00:00Z`,
    external_id: null,
    mp_order_id: `o${seq}`,
    item_status: 'active',
    revenue: 0,
    cost: 0,
    profit: 0,
    profit_reported: 0,
    financial_status: 'ok',
    financial_note: null,
    customer_name: null,
    product_type: null,
    ...o,
  };
}

describe('buildContext (corte por dias completos, fuso da loja)', () => {
  it('mês atual: E = dias até ontem e R inclui hoje', () => {
    const ctx = buildContext('2026-10', '2026-10-14');
    assert.equal(ctx.daysInMonth, 31);
    assert.equal(ctx.elapsedDays, 13);
    assert.equal(ctx.remainingDays, 18);
    assert.equal(ctx.cutoffDate, '2026-10-13');
  });
  it('primeiro dia do mês: nenhum dia completo', () => {
    const ctx = buildContext('2026-11', '2026-11-01');
    assert.equal(ctx.elapsedDays, 0);
    assert.equal(ctx.cutoffDate, null);
  });
  it('virada de ano e meses encerrados/futuros', () => {
    assert.equal(buildContext('2026-12', '2027-01-01').phase, 'past');
    assert.equal(buildContext('2027-01', '2026-12-31').phase, 'future');
    assert.equal(buildContext('2028-02', '2028-03-01').daysInMonth, 29);
  });
});

describe('goalProgress', () => {
  const ctx = buildContext('2026-10', '2026-10-14');
  it('aplica as fórmulas de projeção, necessidade e meta-base de hoje', () => {
    const p = goalProgress({ profit: 150_000, profitUntilCutoff: 143_000, profitToday: 7_000 }, 310_000, 250_000, ctx);
    assert.equal(p.projection, (143_000 / 13) * 31);
    assert.equal(p.neededPerDay, (310_000 - 143_000) / 18);
    assert.equal(p.todayGap, (310_000 - 143_000) / 18 - 7_000);
    assert.equal(p.gap, 160_000);
    assert.ok(Math.abs(p.pctTarget! - 48.387) < 0.01);
  });
  it('meta zero ou ausente não gera percentual nem "meta batida"', () => {
    for (const target of [0, null]) {
      const p = goalProgress({ profit: 1_000, profitUntilCutoff: 1_000, profitToday: 0 }, target, null, ctx);
      assert.equal(p.pctTarget, null);
      assert.equal(p.gap, null);
      assert.equal(p.goalReached, false);
      assert.equal(p.neededPerDay, null);
    }
  });
  it('percentual mostra valores acima de 100% e negativos', () => {
    assert.equal(goalProgress({ profit: 300, profitUntilCutoff: 300, profitToday: 0 }, 200, null, ctx).pctTarget, 150);
    assert.equal(goalProgress({ profit: -50, profitUntilCutoff: -50, profitToday: 0 }, 200, null, ctx).pctTarget, -25);
  });
});

describe('buildMonthFinance', () => {
  const today = '2026-10-03';
  const base = () => [
    sale({ seller_id: 'ana', product_id: 'iphone', sold_date: '2026-10-01', amount: 3656, revenue: 3363.52, cost: 1800, profit: 1563.52, mp_order_id: 'A' }),
    sale({ seller_id: 'brindes', product_id: 'brinde', sold_date: '2026-10-01', amount: 0, revenue: 0, cost: 2.5, profit: -2.5, mp_order_id: 'A' }),
    sale({ seller_id: 'bia', product_id: 'capa', sold_date: '2026-10-02', quantity: 2, amount: 50, revenue: 50, cost: 9.58, profit: 40.42, mp_order_id: 'B' }),
    sale({ seller_id: 'ana', product_id: 'iphone', sold_date: '2026-10-02', amount: 3042, revenue: 2967.48, cost: 2500, profit: 467.48, item_status: 'removed', mp_order_id: 'C' }),
    sale({ seller_id: 'ana', product_id: 'capa', sold_date: '2026-10-03', amount: 100, revenue: 100, cost: 40, profit: 60, mp_order_id: 'D' }),
  ];
  const goals = [
    { seller_id: 'ana', month: '2026-10', profit_target: 31_000, worst_case_target: 20_000 },
    { seller_id: 'bia', month: '2026-10', profit_target: 0, worst_case_target: null },
  ];

  it('brinde reduz o lucro mas não conta como acessório; linha removida não entra', () => {
    const m = buildMonthFinance({ month: '2026-10', today, sellers, productNames, sales: base(), goals });
    assert.equal(m.totals.profit, 1563.52 - 2.5 + 40.42 + 60);
    assert.equal(m.totals.devices, 1);
    assert.equal(m.totals.accessories, 3);
    assert.equal(m.totals.gifts, 1);
    assert.equal(m.totals.orders, 3);
    assert.equal(m.coverage.items, 4);
    assert.equal(m.coverage.complete, true);
  });

  it('vendedor oculto continua no consolidado e pedidos por participação podem somar mais que o total', () => {
    const m = buildMonthFinance({ month: '2026-10', today, sellers, productNames, sales: base(), goals });
    const ids = m.sellers.map((s) => s.seller.id).sort();
    assert.deepEqual(ids, ['ana', 'bia', 'brindes']);
    const sumOrders = m.sellers.reduce((a, s) => a + s.orders, 0);
    assert.equal(sumOrders, 4); // pedido A tem itens de ana e de brindes
    assert.equal(m.totals.orders, 3);
  });

  it('meta consolidada é a soma das metas individuais; corte exclui hoje', () => {
    const m = buildMonthFinance({ month: '2026-10', today, sellers, productNames, sales: base(), goals });
    assert.equal(m.totals.target, 31_000);
    assert.equal(m.plan.realizedUntilCutoff, 1563.52 - 2.5 + 40.42);
    assert.equal(m.plan.realizedToday, 60);
    assert.equal(m.dailyGoal, 1000);
    assert.equal(m.days[0].status, 'hit');
    assert.equal(m.days[1].status, 'below');
    assert.equal(m.days[2].status, 'today');
    assert.equal(m.days[3].status, 'future');
    assert.equal(m.days[3].cumulative, null, 'realizado futuro é nulo');
    assert.equal(m.days[0].pace, 'on_pace');
    assert.equal(m.days[1].pace, 'below_pace');
    assert.equal(m.daysHit, 1);
  });

  it('cobertura parcial bloqueia a estimativa de aparelhos e é sinalizada', () => {
    const sales = base();
    sales[2] = { ...sales[2], financial_status: 'pending', revenue: null, cost: null, profit: null };
    const baseline = { from: '2026-07-01', to: '2026-09-30', profit: 100_000, units: 100, complete: true };
    const m = buildMonthFinance({ month: '2026-10', today, sellers, productNames, sales, goals, iphoneBaseline: baseline });
    assert.equal(m.coverage.complete, false);
    assert.equal(m.coverage.completeUntilCutoff, false);
    assert.equal(m.coverage.pending.pending, 1);
    assert.equal(m.days[1].status, 'partial');
    assert.equal(m.plan.devicesEquivalent, null);
    assert.match(m.plan.devicesReason!, /sem custo conciliado/);
  });

  it('equivalência em aparelhos = teto(falta de hoje ÷ lucro médio por iPhone)', () => {
    const baseline = { from: '2026-07-01', to: '2026-09-30', profit: 100_000, units: 100, complete: true };
    const m = buildMonthFinance({ month: '2026-10', today, sellers, productNames, sales: base(), goals, iphoneBaseline: baseline });
    const L = 1563.52 - 2.5 + 40.42;
    const expectedGap = (31_000 - L) / 29 - 60;
    assert.ok(Math.abs(m.plan.todayGap! - expectedGap) < 1e-9);
    assert.equal(m.plan.devicesEquivalent, Math.ceil(expectedGap / 1000));
  });

  it('sem metas: resultado aparece, percentuais e ritmo ficam indisponíveis', () => {
    const m = buildMonthFinance({ month: '2026-10', today, sellers, productNames, sales: base(), goals: [] });
    assert.equal(m.totals.target, null);
    assert.equal(m.totals.pctTarget, null);
    assert.equal(m.dailyGoal, null);
    assert.equal(m.days[0].status, 'no_goal');
    assert.ok(m.totals.profit > 0);
  });

  it('mês encerrado usa o resultado final como fechamento', () => {
    const m = buildMonthFinance({ month: '2026-10', today: '2026-11-05', sellers, productNames, sales: base(), goals });
    assert.equal(m.totals.projection, m.totals.profit);
    assert.equal(m.totals.neededPerDay, null);
    assert.equal(m.plan.projection, null);
  });
});

describe('computeIphoneBaseline', () => {
  it('só considera iPhones ativos e marca a base como incompleta se houver pendência', () => {
    const rows = [
      sale({ seller_id: 'ana', product_id: 'iphone', sold_date: '2026-09-10', profit: 800 }),
      sale({ seller_id: 'ana', product_id: 'iphone', sold_date: '2026-09-11', profit: 600, item_status: 'cancelled' }),
      sale({ seller_id: 'ana', product_id: 'capa', sold_date: '2026-09-11', profit: 50 }),
    ];
    assert.deepEqual(computeIphoneBaseline(rows, productNames, 'a', 'b'), { from: 'a', to: 'b', profit: 800, units: 1, complete: true });
    rows.push(sale({ seller_id: 'ana', product_id: 'iphone', sold_date: '2026-09-12', financial_status: 'pending', profit: null }));
    assert.equal(computeIphoneBaseline(rows, productNames, 'a', 'b').complete, false);
  });
});
