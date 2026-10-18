import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FinanceSale, FinanceSeller } from './calc.ts';
import { wallClock } from './dates.ts';
import {
  accessoryLabel,
  buildSellerRows,
  buildDeviceRows,
  buildSeries,
  deviceItemsOf,
  coverageSummary,
  dataRange,
  defaultMode,
  deviceModel,
  goalWindow,
  monthRangeOf,
  pickGranularity,
  presetRange,
  rangeCoverage,
  salesIn,
  sortSellerRows,
  summarizeMoney,
  summarizeUnits,
  topProduct,
  unitGoalProgress,
  weekRangeOf,
} from './dashboard.ts';

const names = new Map([
  ['i15', 'IPHONE 15 128GB - PRETO'],
  ['i15b', 'iPhone 15 256GB AZUL'],
  ['i18', 'IPHONE 18 PRO MAX - 512GB - SLV'],
  ['watch', 'APPLE WATCH SERIES 9'],
  ['pel', 'PELICULA VIDRO - ONE SAFE'],
  ['capa', 'CAPA CASE - . - .'],
  ['brinde', 'CAPA TRANSPARENTE - BND'],
]);

let seq = 0;
function sale(o: Partial<FinanceSale> & Pick<FinanceSale, 'seller_id' | 'product_id' | 'sold_date'>): FinanceSale {
  seq += 1;
  return {
    id: `s${seq}`, quantity: 1, amount: 100, sold_at: `${o.sold_date}T10:00:00+00:00`, external_id: null, mp_order_id: `o${seq}`,
    item_status: 'active', revenue: 90, cost: 40, profit: 50, profit_reported: 50, financial_status: 'ok', financial_note: null, customer_name: null, product_type: null,
    ...o,
  };
}
const sellers: FinanceSeller[] = [
  { id: 'caroline', name: 'CAROLINE', photo_url: null, active: true, show_in_ranking: true },
  { id: 'graciane', name: 'GRACIANE', photo_url: null, active: true, show_in_ranking: true },
  { id: 'oculto', name: 'BRINDES', photo_url: null, active: true, show_in_ranking: false },
];

describe('períodos (datas comerciais, semana de segunda a domingo)', () => {
  const today = '2026-10-18'; // domingo
  it('presets', () => {
    assert.deepEqual(presetRange('today', today), { from: '2026-10-18', to: '2026-10-18' });
    assert.deepEqual(presetRange('yesterday', today), { from: '2026-10-17', to: '2026-10-17' });
    assert.deepEqual(presetRange('week', today), { from: '2026-10-12', to: '2026-10-18' });
    assert.deepEqual(presetRange('lastWeek', today), { from: '2026-10-05', to: '2026-10-11' });
    assert.deepEqual(presetRange('month', today), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(presetRange('lastMonth', today), { from: '2026-09-01', to: '2026-09-30' });
  });
  it('semana que cruza o mês e virada de ano', () => {
    assert.deepEqual(weekRangeOf('2026-10-01'), { from: '2026-09-28', to: '2026-10-04' });
    assert.deepEqual(presetRange('lastMonth', '2027-01-05'), { from: '2026-12-01', to: '2026-12-31' });
  });
  it('personalizado: inverte datas trocadas e completa o que falta', () => {
    assert.deepEqual(presetRange('custom', today, { from: '2026-10-10', to: '2026-10-03' }), { from: '2026-10-03', to: '2026-10-10' });
    assert.deepEqual(presetRange('custom', today, {}), { from: today, to: today });
  });
  it('janela da meta: semana/mês do último dia decorrido; fits avisa quando o período é maior', () => {
    const t = '2026-10-18';
    assert.deepEqual(goalWindow({ from: '2026-10-12', to: '2026-10-18' }, 'week', t), { window: { from: '2026-10-12', to: '2026-10-18' }, fits: true });
    assert.deepEqual(goalWindow({ from: '2026-10-14', to: '2026-10-14' }, 'week', t), { window: { from: '2026-10-12', to: '2026-10-18' }, fits: true });
    assert.deepEqual(goalWindow({ from: '2026-10-10', to: '2026-10-14' }, 'week', t), { window: { from: '2026-10-12', to: '2026-10-18' }, fits: false });
    assert.deepEqual(goalWindow({ from: '2026-09-20', to: '2026-10-05' }, 'month', t), { window: monthRangeOf('2026-10-01'), fits: false });
    assert.deepEqual(goalWindow({ from: '2026-10-01', to: '2026-10-31' }, 'month', t), { window: monthRangeOf('2026-10-15'), fits: true });
  });
  it('"Este mês" compara a semana atual (não a semana futura que contém o dia 31)', () => {
    const t = '2026-10-18';
    assert.deepEqual(goalWindow({ from: '2026-10-01', to: '2026-10-31' }, 'week', t), { window: { from: '2026-10-12', to: '2026-10-18' }, fits: false });
    // mês passado: o último dia do período já passou
    assert.deepEqual(goalWindow({ from: '2026-09-01', to: '2026-09-30' }, 'week', t).window, { from: '2026-09-28', to: '2026-10-04' });
  });
  it('intervalo de busca une período e janelas (uma consulta só)', () => {
    const t = '2026-10-18';
    assert.deepEqual(dataRange({ from: '2026-10-14', to: '2026-10-14' }, t), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(dataRange({ from: '2026-10-01', to: '2026-10-01' }, '2026-10-02'), { from: '2026-09-28', to: '2026-10-31' });
    // "Este mês" no início do mês: a semana atual começa no mês anterior e precisa ser buscada
    assert.deepEqual(dataRange({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-02').from, '2026-09-28');
  });
});

describe('unidades e vendas únicas', () => {
  it('um pedido com vários itens é UMA venda; brinde não é acessório; Apple Watch não é aparelho; cancelada fora', () => {
    const sales = [
      sale({ seller_id: 'caroline', product_id: 'i15', sold_date: '2026-10-05', amount: 4000, mp_order_id: '8393342' }),
      sale({ seller_id: 'graciane', product_id: 'pel', sold_date: '2026-10-05', amount: 70, mp_order_id: '8393342' }),
      sale({ seller_id: 'caroline', product_id: 'brinde', sold_date: '2026-10-05', amount: 0, mp_order_id: '8393342' }),
      sale({ seller_id: 'caroline', product_id: 'watch', sold_date: '2026-10-06', amount: 2500, quantity: 2 }),
      sale({ seller_id: 'caroline', product_id: 'i15', sold_date: '2026-10-07', item_status: 'cancelled', mp_order_id: 'cancelada' }),
      sale({ seller_id: 'caroline', product_id: 'i15', sold_date: '2026-10-07', item_status: 'removed', mp_order_id: 'removida' }),
    ];
    const u = summarizeUnits(sales, names);
    assert.equal(u.devices, 1);
    assert.equal(u.accessories, 3); // película + 2 watches
    assert.equal(u.gifts, 1);
    assert.equal(u.orders, 2);
    assert.equal(u.items, 4);
  });
});

describe('financeiro', () => {
  it('faturamento, custo e lucro só somam itens conciliados; brinde reduz o lucro', () => {
    const m = summarizeMoney([
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', revenue: 3363.52, cost: 1800, profit: 1563.52 }),
      sale({ seller_id: 'a', product_id: 'brinde', sold_date: '2026-10-05', amount: 0, revenue: 0, cost: 2.5, profit: -2.5 }),
      sale({ seller_id: 'a', product_id: 'capa', sold_date: '2026-10-05', financial_status: 'pending', revenue: null, cost: null, profit: null }),
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', item_status: 'cancelled' }),
    ]);
    assert.equal(m.revenue, 3363.52);
    assert.equal(m.cost, 1802.5);
    assert.equal(m.profit, 1561.02);
    assert.equal(m.items, 3);
    assert.equal(m.reconciledItems, 2);
    assert.ok(Math.abs(m.margin! - (1561.02 / 3363.52) * 100) < 1e-9);
  });
  it('margem indisponível com faturamento zero', () => {
    assert.equal(summarizeMoney([sale({ seller_id: 'a', product_id: 'brinde', sold_date: '2026-10-05', amount: 0, revenue: 0, cost: 2, profit: -2 })]).margin, null);
  });
  it('cobertura aponta pendências', () => {
    const c = rangeCoverage(
      [sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05' }), sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', financial_status: 'pending', profit: null })],
      names
    );
    assert.equal(c.complete, false);
    assert.equal(c.pending.pending, 1);
  });
});

describe('ranking por vendedor do item', () => {
  const sales = [
    sale({ seller_id: 'caroline', product_id: 'i15', sold_date: '2026-10-05', amount: 4712, revenue: 4400, cost: 3800, profit: 600, mp_order_id: '8393342' }),
    sale({ seller_id: 'graciane', product_id: 'pel', sold_date: '2026-10-05', amount: 70, revenue: 70, cost: 20, profit: 50, mp_order_id: '8393342' }),
    sale({ seller_id: 'oculto', product_id: 'brinde', sold_date: '2026-10-05', amount: 0, revenue: 0, cost: 5, profit: -5, mp_order_id: '8393342' }),
  ];
  it('cada vendedor recebe só o seu item; faturamento não duplica; ocultos ficam fora da tabela', () => {
    const rows = buildSellerRows(sales, names, sellers);
    const byName = Object.fromEntries(rows.map((r) => [r.seller.name, r]));
    assert.equal(byName.CAROLINE.devices, 1);
    assert.equal(byName.CAROLINE.revenue, 4400);
    assert.equal(byName.GRACIANE.devices, 0);
    assert.equal(byName.GRACIANE.accessories, 1);
    assert.equal(byName.BRINDES, undefined);
    assert.equal(rows.reduce((a, r) => a + r.revenue, 0), 4470);
    assert.equal(buildSellerRows(sales, names, sellers, true).length, 3);
  });
  it('ordenações: lucro, margem (sem faturamento por último) e unidades', () => {
    const rows = buildSellerRows(
      [...sales, sale({ seller_id: 'graciane', product_id: 'watch', sold_date: '2026-10-06', amount: 100, revenue: 100, cost: 10, profit: 90 })],
      names,
      [...sellers, { id: 'zero', name: 'ZERO', photo_url: null, active: true, show_in_ranking: true }]
    );
    assert.deepEqual(sortSellerRows(rows, 'profit').map((r) => r.seller.name), ['CAROLINE', 'GRACIANE', 'ZERO']);
    // margens: caroline 13,6%; graciane 140/170 = 82,4%; zero sem faturamento
    assert.deepEqual(sortSellerRows(rows, 'margin').map((r) => r.seller.name), ['GRACIANE', 'CAROLINE', 'ZERO']);
    assert.deepEqual(sortSellerRows(rows, 'accessories').map((r) => r.seller.name)[0], 'GRACIANE');
  });
});

describe('produto mais vendido', () => {
  it('agrupa modelos de iPhone ignorando capacidade e cor', () => {
    assert.equal(deviceModel('IPHONE 15 128GB - PRETO'), 'iPhone 15');
    assert.equal(deviceModel('iPhone 15 256GB AZUL'), 'iPhone 15');
    assert.equal(deviceModel('IPHONE 18 PRO MAX - 512GB - SLV'), 'iPhone 18 Pro Max');
    assert.equal(deviceModel('IPHONE 14 PRO'), 'iPhone 14 Pro');
    assert.equal(deviceModel('IPHONE XR 64GB'), 'iPhone XR');
    assert.equal(accessoryLabel('CAPA CASE - . - .'), 'CAPA CASE');
  });
  it('aparelho: modelo com mais unidades, participação e faturamento; Apple Watch e brinde ficam fora', () => {
    const t = topProduct(
      [
        sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', revenue: 3000 }),
        sale({ seller_id: 'a', product_id: 'i15b', sold_date: '2026-10-06', revenue: 3500 }),
        sale({ seller_id: 'a', product_id: 'i18', sold_date: '2026-10-06', revenue: 9000 }),
        sale({ seller_id: 'a', product_id: 'watch', sold_date: '2026-10-06', quantity: 5 }),
        sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-07', item_status: 'cancelled' }),
      ],
      names,
      'devices'
    )!;
    assert.equal(t.name, 'iPhone 15');
    assert.equal(t.qty, 2);
    assert.ok(Math.abs(t.share - (2 / 3) * 100) < 1e-9);
    assert.equal(t.revenue, 6500);
    assert.equal(t.rows.length, 2);
  });
  it('acessório: brinde nunca entra, mesmo sendo o mais frequente', () => {
    const t = topProduct(
      [
        sale({ seller_id: 'a', product_id: 'brinde', sold_date: '2026-10-05', amount: 0, quantity: 50 }),
        sale({ seller_id: 'a', product_id: 'pel', sold_date: '2026-10-05', amount: 70 }),
        sale({ seller_id: 'a', product_id: 'capa', sold_date: '2026-10-05', amount: 60, quantity: 2 }),
      ],
      names,
      'accessories'
    )!;
    assert.equal(t.name, 'CAPA CASE');
    assert.equal(t.qty, 2);
  });
  it('sem vendas retorna null', () => assert.equal(topProduct([], names, 'devices'), null));
});

describe('metas de unidades', () => {
  const sales = [
    sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-13', quantity: 3 }),
    sale({ seller_id: 'a', product_id: 'pel', sold_date: '2026-10-14', quantity: 4 }),
    sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-01', quantity: 10 }),
  ];
  const week = { window: { from: '2026-10-12', to: '2026-10-18' }, fits: true };
  it('semana: vendido, %, faltam; acessórios opcionais', () => {
    const g = unitGoalProgress(sales, names, week, { devices: 10, accessories: 0 });
    assert.equal(g.devices.sold, 3);
    assert.equal(g.devices.pct, 30);
    assert.equal(g.devices.remaining, 7);
    assert.equal(g.accessories.target, null);
    assert.equal(g.accessories.sold, 4);
    assert.equal(g.hasGoal, true);
  });
  it('percentual acima de 100 e faltam nunca negativo', () => {
    const g = unitGoalProgress(sales, names, week, { devices: 2, accessories: 0 });
    assert.equal(g.devices.pct, 150);
    assert.equal(g.devices.remaining, 0);
  });
  it('meta zero ou ausente: sem meta configurada (vendidos continuam)', () => {
    const g = unitGoalProgress(sales, names, week, { devices: 0, accessories: 0 });
    assert.equal(g.hasGoal, false);
    assert.equal(g.devices.sold, 3);
  });
  it('período maior que a semana usa a semana do último dia, sem somar metas', () => {
    const ref = goalWindow({ from: '2026-10-01', to: '2026-10-14' }, 'week', '2026-10-18');
    const g = unitGoalProgress(sales, names, ref, { devices: 10, accessories: 0 });
    assert.equal(g.fits, false);
    assert.equal(g.devices.sold, 3, 'só a semana 12–18/10, não o mês inteiro');
    assert.equal(g.devices.target, 10);
  });
});

describe('série de evolução (aparelhos e acessórios)', () => {
  const now = { today: '2026-10-16', hour: 11 };
  it('hoje: 24 horas pelo relógio da loja, sem deslocar 3 horas; horas futuras nulas', () => {
    const sales = [
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-16', sold_at: '2026-10-16T09:00:00+00:00', quantity: 2 }),
      sale({ seller_id: 'a', product_id: 'pel', sold_date: '2026-10-16', sold_at: '2026-10-16T09:30:00+00:00' }),
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-16', sold_at: '2026-10-16T11:00:00+00:00' }),
      sale({ seller_id: 'a', product_id: 'brinde', sold_date: '2026-10-16', sold_at: '2026-10-16T09:00:00+00:00', amount: 0 }),
    ];
    const { granularity, points } = buildSeries(sales, names, { from: '2026-10-16', to: '2026-10-16' }, now);
    assert.equal(granularity, 'hour');
    assert.equal(points.length, 24);
    assert.equal(points[9].devices, 2);
    assert.equal(points[9].accessories, 1);
    assert.equal(points[6].devices, 0, 'nada às 06h');
    assert.equal(points[11].devices, 1);
    assert.equal(points[12].devices, null);
    assert.equal(points[23].devicesCum, null);
    assert.equal(points[11].devicesCum, 3);
    assert.equal(wallClock('2026-10-16T09:00:00+00:00').hour, 9);
  });
  it('mês atual: acumulado nunca cai, dias sem venda mantêm o acumulado, dias futuros nulos', () => {
    const sales = [
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-01', quantity: 5 }),
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-03', quantity: 7 }),
      sale({ seller_id: 'a', product_id: 'pel', sold_date: '2026-10-02', quantity: 2 }),
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-02', item_status: 'cancelled', quantity: 9 }),
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-09-30', quantity: 99 }),
    ];
    const { granularity, points } = buildSeries(sales, names, monthRangeOf('2026-10-16'), now);
    assert.equal(granularity, 'day');
    assert.equal(points.length, 31);
    assert.deepEqual(points.slice(0, 4).map((p) => p.devices), [5, 0, 7, 0]);
    assert.deepEqual(points.slice(0, 4).map((p) => p.devicesCum), [5, 5, 12, 12]);
    assert.deepEqual(points.slice(0, 3).map((p) => p.accessoriesCum), [0, 2, 2]);
    assert.equal(points[15].devicesCum, 12);
    assert.equal(points[16].devicesCum, null);
    assert.equal(points[30].devices, null);
    const cum = points.map((p) => p.devicesCum).filter((v): v is number => v != null);
    assert.ok(cum.every((v, i) => i === 0 || v >= cum[i - 1]));
  });
  it('totais da série batem com os cards do mesmo período', () => {
    const sales = [
      sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', quantity: 3 }),
      sale({ seller_id: 'a', product_id: 'pel', sold_date: '2026-10-06', quantity: 4 }),
      sale({ seller_id: 'a', product_id: 'brinde', sold_date: '2026-10-06', amount: 0, quantity: 9 }),
    ];
    const range = monthRangeOf('2026-10-10');
    const { points } = buildSeries(sales, names, range, now);
    const u = summarizeUnits(salesIn(sales, range), names);
    assert.equal(points.reduce((a, p) => a + (p.devices ?? 0), 0), u.devices);
    assert.equal(points.reduce((a, p) => a + (p.accessories ?? 0), 0), u.accessories);
  });
  it('mês encerrado mostra o mês inteiro; intervalo longo agrupa por mês; período sem vendas fica zerado', () => {
    const past = buildSeries([], names, monthRangeOf('2026-09-10'), now);
    assert.equal(past.points.length, 30);
    assert.ok(past.points.every((p) => p.devices === 0));
    const long = buildSeries([], names, { from: '2026-01-01', to: '2026-10-16' }, now);
    assert.equal(long.granularity, 'month');
    assert.equal(long.points.length, 10);
    assert.equal(long.points[0].label, 'Jan/26');
    assert.equal(pickGranularity({ from: '2026-10-01', to: '2026-10-07' }), 'day');
  });
  it('modo padrão: um dia = por período; demais = acumulado', () => {
    assert.equal(defaultMode({ from: '2026-10-16', to: '2026-10-16' }), 'period');
    assert.equal(defaultMode(monthRangeOf('2026-10-16')), 'cumulative');
  });
  it('apenas aparelhos ou apenas acessórios', () => {
    const only = buildSeries([sale({ seller_id: 'a', product_id: 'pel', sold_date: '2026-10-05' })], names, { from: '2026-10-05', to: '2026-10-06' }, now);
    assert.equal(only.points[0].devices, 0);
    assert.equal(only.points[0].accessories, 1);
  });
});

describe('resumo da conciliação (botão e modal)', () => {
  const sales = [
    ...Array.from({ length: 4 }, () => sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', amount: 1000, revenue: 900 })),
    sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', amount: 800, financial_status: 'pending', revenue: null, cost: null, profit: null }),
    sale({ seller_id: 'a', product_id: 'capa', sold_date: '2026-10-05', amount: 60, financial_status: 'ambiguous', revenue: null, cost: null, profit: null }),
    sale({ seller_id: 'a', product_id: 'i15', sold_date: '2026-10-05', item_status: 'cancelled', financial_status: 'pending', profit: null }),
  ];
  it('pendentes = itens − conciliados, e não conta linhas canceladas', () => {
    const s = coverageSummary(rangeCoverage(sales, names));
    assert.equal(s.total, 6);
    assert.equal(s.reconciled, 4);
    assert.equal(s.pending, 2);
    assert.ok(Math.abs(s.pct! - (4 / 6) * 100) < 1e-9);
    assert.equal(s.revenueKnown, 3600);
    assert.equal(s.amountPending, 860);
    assert.deepEqual(s.reasons, [{ label: 'Aguardando conciliação', count: 1 }, { label: 'Correspondência ambígua', count: 1 }]);
  });
  it('é exatamente a cobertura que alimentava o aviso antigo', () => {
    const c = rangeCoverage(sales, names);
    const s = coverageSummary(c);
    assert.equal(s.total, c.items);
    assert.equal(s.reconciled, c.reconciled);
    assert.equal(s.revenueKnown, c.revenueKnown);
    assert.equal(s.amountPending, c.amountPending);
  });
  it('tudo conciliado: zero pendências, 100%; sem itens: percentual indisponível', () => {
    assert.equal(coverageSummary(rangeCoverage(sales.slice(0, 4), names)).pending, 0);
    assert.equal(coverageSummary(rangeCoverage(sales.slice(0, 4), names)).pct, 100);
    assert.equal(coverageSummary(rangeCoverage([], names)).pct, null);
  });
});

describe('ranking por aparelhos', () => {
  const sales = [
    // pedido 8393342: Caroline vendeu o iPhone, Graciane a película
    sale({ seller_id: 'caroline', product_id: 'i15', sold_date: '2026-10-05', amount: 4712, revenue: 4400, cost: 3800, profit: 600, mp_order_id: '8393342' }),
    sale({ seller_id: 'graciane', product_id: 'pel', sold_date: '2026-10-05', amount: 70, revenue: 70, cost: 20, profit: 50, mp_order_id: '8393342' }),
    sale({ seller_id: 'caroline', product_id: 'i18', sold_date: '2026-10-14', amount: 10000, revenue: 9000, cost: 8000, profit: 1000, quantity: 2 }),
    sale({ seller_id: 'graciane', product_id: 'i15b', sold_date: '2026-10-14', amount: 3000, revenue: 2800, cost: 2500, profit: 300 }),
    sale({ seller_id: 'graciane', product_id: 'watch', sold_date: '2026-10-14', amount: 2500 }),
    sale({ seller_id: 'graciane', product_id: 'i15', sold_date: '2026-10-14', item_status: 'cancelled' }),
    sale({ seller_id: 'oculto', product_id: 'i15', sold_date: '2026-10-14', amount: 3000, revenue: 2900, cost: 2600, profit: 300 }),
  ];
  const month = { window: monthRangeOf('2026-10-15'), fits: true };
  const goals = new Map<string, number | null>([['caroline', 10], ['graciane', 0]]);
  const byName = (rows: ReturnType<typeof buildDeviceRows>) => Object.fromEntries(rows.map((r) => [r.seller.name, r]));

  it('só iPhone, pelo vendedor do item, com unidades e sem canceladas; Apple Watch e película não contam', () => {
    const rows = buildDeviceRows(sales, names, sellers, month.window, month, goals);
    const r = byName(rows);
    assert.equal(r.CAROLINE.sold, 3); // 1 + 2 unidades
    assert.equal(r.GRACIANE.sold, 1); // só o iPhone 15; película, Watch e cancelado ficam de fora
    assert.equal(rows[0].seller.name, 'CAROLINE', 'mais aparelhos primeiro');
  });
  it('faturamento e lucro são só dos aparelhos', () => {
    const r = byName(buildDeviceRows(sales, names, sellers, month.window, month, goals));
    assert.equal(r.CAROLINE.revenue, 13400);
    assert.equal(r.CAROLINE.profit, 1600);
    assert.equal(r.GRACIANE.revenue, 2800);
    assert.equal(r.GRACIANE.profit, 300);
  });
  it('meta: % acima de 100, faltantes nunca negativo; sem meta ou meta zero = null', () => {
    const r = byName(buildDeviceRows(sales, names, sellers, month.window, month, new Map([['caroline', 2], ['graciane', 0]])));
    assert.equal(r.CAROLINE.pct, 150);
    assert.equal(r.CAROLINE.remaining, 0);
    assert.equal(r.GRACIANE.target, null);
    assert.equal(r.GRACIANE.pct, null);
    assert.equal(r.GRACIANE.remaining, null);
    const normal = byName(buildDeviceRows(sales, names, sellers, month.window, month, goals));
    assert.equal(normal.CAROLINE.pct, 30);
    assert.equal(normal.CAROLINE.remaining, 7);
    assert.equal(normal.CAROLINE.basisIsMonth, false, 'mês inteiro: compara o próprio período');
  });
  it('período menor que o mês: compara a meta mensal com o ACUMULADO do mês, não com o dia', () => {
    const day = { from: '2026-10-14', to: '2026-10-14' };
    const r = byName(buildDeviceRows(sales, names, sellers, day, month, goals));
    assert.equal(r.CAROLINE.basisIsMonth, true);
    assert.equal(r.CAROLINE.sold, 2, 'vendido no dia');
    assert.equal(r.CAROLINE.monthSold, 3, 'acumulado do mês');
    assert.equal(r.CAROLINE.basis, 3);
    assert.equal(r.CAROLINE.pct, 30);
    assert.equal(r.CAROLINE.remaining, 7);
  });
  it('total do ranking (todos os vendedores) = aparelhos dos cards; ocultos só aparecem se pedido', () => {
    const all = buildDeviceRows(sales, names, sellers, month.window, month, goals, true);
    assert.equal(all.reduce((a, r) => a + r.sold, 0), summarizeUnits(salesIn(sales, month.window), names).devices);
    const visible = buildDeviceRows(sales, names, sellers, month.window, month, goals);
    assert.equal(visible.some((r) => r.seller.name === 'BRINDES'), false);
    assert.equal(visible.reduce((a, r) => a + r.sold, 0), 4);
  });
  it('detalhe do vendedor lista só os iPhones dele no período, mais recentes primeiro', () => {
    const items = deviceItemsOf(sales, names, 'caroline', month.window);
    assert.equal(items.length, 2);
    assert.equal(items[0].sold_date, '2026-10-14');
    assert.equal(deviceItemsOf(sales, names, 'graciane', { from: '2026-10-05', to: '2026-10-05' }).length, 0);
  });
  it('vendedor sem aparelhos aparece com zero', () => {
    const rows = buildDeviceRows(sales, names, [...sellers, { id: 'zero', name: 'ZERO', photo_url: null, active: true, show_in_ranking: true }], month.window, month, new Map([['zero', 5]]));
    const z = byName(rows).ZERO;
    assert.equal(z.sold, 0);
    assert.equal(z.remaining, 5);
    assert.equal(rows.at(-1)!.seller.name, 'ZERO');
  });
});

describe('top 5 de produtos', () => {
  const nm = new Map([
    ['a', 'IPHONE 17 PRO MAX - 256GB'], ['b', 'IPHONE 18 PRO MAX - 512GB'], ['c', 'iPhone 15 Pro Max 128GB'], ['d', 'IPHONE 15 128GB'],
    ['e', 'IPHONE 16 PRO 256GB'], ['f', 'IPHONE 14 128GB'], ['g', 'IPHONE 13 128GB'],
    ['c1', 'CAPA CASE - . - .'], ['c2', 'Capa Case - . - .'], ['pel', 'PELICULA ZEUS - ZEUS'], ['bnd', 'CAPA TRANSPARENTE - BND'], ['w', 'APPLE WATCH'],
  ]);
  const mk = (product_id: string, qty: number, extra: Partial<FinanceSale> = {}) => sale({ seller_id: 'a', product_id, sold_date: '2026-10-05', quantity: qty, amount: 100, ...extra });
  const devices = [mk('a', 18), mk('b', 12), mk('c', 11), mk('d', 10), mk('e', 9), mk('f', 3), mk('g', 1), mk('w', 40)];

  it('devolve 5 colocados em ordem de unidades; o 1º é o destaque; Apple Watch fora', () => {
    const t = topProduct(devices, nm, 'devices')!;
    assert.deepEqual(t.ranking, [
      { name: 'iPhone 17 Pro Max', qty: 18 }, { name: 'iPhone 18 Pro Max', qty: 12 }, { name: 'iPhone 15 Pro Max', qty: 11 },
      { name: 'iPhone 15', qty: 10 }, { name: 'iPhone 16 Pro', qty: 9 },
    ]);
    assert.equal(t.name, 'iPhone 17 Pro Max');
    assert.equal(t.all.length, 7, 'o detalhe não se limita a 5 produtos');
  });
  it('com menos de 5 produtos mostra só os que existem', () => {
    assert.equal(topProduct([mk('a', 2), mk('b', 1)], nm, 'devices')!.ranking.length, 2);
  });
  it('empate em unidades: nome em ordem alfabética (determinístico)', () => {
    const t = topProduct([mk('b', 5), mk('a', 5), mk('c', 5)], nm, 'devices')!;
    assert.deepEqual(t.ranking.map((r) => r.name), ['iPhone 15 Pro Max', 'iPhone 17 Pro Max', 'iPhone 18 Pro Max']);
    const again = topProduct([mk('c', 5), mk('a', 5), mk('b', 5)], nm, 'devices')!;
    assert.deepEqual(again.ranking, t.ranking, 'independe da ordem de chegada');
  });
  it('acessório: maiúsculas/minúsculas não duplicam; brinde e cancelada ficam fora; soma unidades', () => {
    const t = topProduct(
      [mk('c1', 3), mk('c2', 4), mk('pel', 6), mk('bnd', 90, { amount: 0 }), mk('pel', 50, { item_status: 'cancelled' })],
      nm,
      'accessories'
    )!;
    // um único grupo de 7 unidades, exibido com a grafia mais usada ("Capa Case": 4 un. contra 3 un.)
    assert.deepEqual(t.ranking, [{ name: 'Capa Case', qty: 7 }, { name: 'PELICULA ZEUS', qty: 6 }]);
    assert.equal(t.all.length, 2);
  });
  it('o ranking acompanha o período (só vendas dentro do intervalo entram)', () => {
    const rows = [mk('a', 5), mk('b', 9, { sold_date: '2026-09-20' })];
    const inPeriod = topProduct(salesIn(rows, { from: '2026-10-01', to: '2026-10-31' }), nm, 'devices')!;
    assert.deepEqual(inPeriod.ranking, [{ name: 'iPhone 17 Pro Max', qty: 5 }]);
  });
  it('detalhe completo soma as unidades de todos os produtos da categoria', () => {
    const t = topProduct(devices, nm, 'devices')!;
    assert.equal(t.all.reduce((a, g) => a + g.qty, 0), summarizeUnits(devices, nm).devices);
  });
});

describe('vendas com vários iPhones (venda real 8613940 e variações)', () => {
  const nm = new Map([['i17', 'IPHONE 17 PRO MAX - 256GB - SLV'], ['i18', 'IPHONE 18 PRO - 256GB - SLV'], ['i15p', 'IPHONE 15 PRO'], ['i16p', 'IPHONE 16 PRO'], ['bnd', 'CAPA TRANSPARENTE - BND'], ['pel', 'PELICULA ZEUS']]);
  const it8613940 = (extra: Partial<FinanceSale> = {}) => [
    sale({ seller_id: 'thuane', product_id: 'bnd', sold_date: '2026-10-17', amount: 0, mp_order_id: '8613940', ...extra }),
    sale({ seller_id: 'thuane', product_id: 'bnd', sold_date: '2026-10-17', amount: 0, mp_order_id: '8613940', ...extra }),
    sale({ seller_id: 'thuane', product_id: 'bnd', sold_date: '2026-10-17', amount: 0, mp_order_id: '8613940', ...extra }),
    sale({ seller_id: 'thuane', product_id: 'bnd', sold_date: '2026-10-17', amount: 0, mp_order_id: '8613940', ...extra }),
    sale({ seller_id: 'thuane', product_id: 'i18', sold_date: '2026-10-17', amount: 8500, mp_order_id: '8613940', ...extra }),
    sale({ seller_id: 'thuane', product_id: 'i17', sold_date: '2026-10-17', amount: 7850, mp_order_id: '8613940', ...extra }),
  ];
  const thuane: FinanceSeller[] = [{ id: 'thuane', name: 'THUANE', photo_url: null, active: true, show_in_ranking: true }];

  it('teste 1 — 8613940: 1 venda, 2 aparelhos, 0 acessórios, 4 brindes; Thuane +2; cada modelo +1', () => {
    const u = summarizeUnits(it8613940(), nm);
    assert.deepEqual({ vendas: u.orders, aparelhos: u.devices, acessorios: u.accessories, brindes: u.gifts }, { vendas: 1, aparelhos: 2, acessorios: 0, brindes: 4 });
    const month = { window: monthRangeOf('2026-10-17'), fits: true };
    const r = buildDeviceRows(it8613940(), nm, thuane, month.window, month, new Map());
    assert.equal(r[0].sold, 2);
    const t = topProduct(it8613940(), nm, 'devices')!;
    assert.deepEqual(t.all.map((g) => [g.name, g.qty]), [['iPhone 17 Pro Max', 1], ['iPhone 18 Pro', 1]]);
  });
  it('teste 2 e 3 — 3 iPhones diferentes; 2 unidades do mesmo iPhone', () => {
    const three = [
      sale({ seller_id: 'a', product_id: 'i15p', sold_date: '2026-10-05', mp_order_id: 'B' }),
      sale({ seller_id: 'a', product_id: 'i16p', sold_date: '2026-10-05', mp_order_id: 'B' }),
      sale({ seller_id: 'a', product_id: 'i17', sold_date: '2026-10-05', mp_order_id: 'B' }),
    ];
    assert.deepEqual([summarizeUnits(three, nm).orders, summarizeUnits(three, nm).devices], [1, 3]);
    const two = [sale({ seller_id: 'a', product_id: 'i15p', sold_date: '2026-10-05', mp_order_id: 'C', quantity: 2 })];
    assert.deepEqual([summarizeUnits(two, nm).orders, summarizeUnits(two, nm).devices], [1, 2]);
  });
  it('teste 4 — iPhones de vendedores diferentes na mesma venda', () => {
    const rows = [
      sale({ seller_id: 'a', product_id: 'i17', sold_date: '2026-10-05', mp_order_id: 'D' }),
      sale({ seller_id: 'b', product_id: 'i18', sold_date: '2026-10-05', mp_order_id: 'D', quantity: 2 }),
    ];
    const sellersAB: FinanceSeller[] = [
      { id: 'a', name: 'A', photo_url: null, active: true, show_in_ranking: true },
      { id: 'b', name: 'B', photo_url: null, active: true, show_in_ranking: true },
    ];
    const month = { window: monthRangeOf('2026-10-05'), fits: true };
    const r = Object.fromEntries(buildDeviceRows(rows, nm, sellersAB, month.window, month, new Map()).map((x) => [x.seller.name, x.sold]));
    assert.deepEqual(r, { A: 1, B: 2 });
    assert.equal(summarizeUnits(rows, nm).orders, 1);
  });
  it('teste 5 e 6 — iPhone com brindes; venda cancelada não conta', () => {
    const withGifts = [sale({ seller_id: 'a', product_id: 'i17', sold_date: '2026-10-05', mp_order_id: 'E' }), ...[1, 2, 3, 4].map(() => sale({ seller_id: 'a', product_id: 'bnd', sold_date: '2026-10-05', amount: 0, mp_order_id: 'E' }))];
    const u = summarizeUnits(withGifts, nm);
    assert.deepEqual([u.orders, u.devices, u.accessories, u.gifts], [1, 1, 0, 4]);
    const cancelled = summarizeUnits(it8613940({ item_status: 'cancelled' }), nm);
    assert.deepEqual([cancelled.orders, cancelled.devices], [0, 0]);
  });
  it('o faturamento não duplica: soma das linhas, uma vez cada', () => {
    const m = summarizeMoney(it8613940().map((s) => ({ ...s, revenue: s.amount, cost: 0, profit: s.amount })));
    assert.equal(m.revenue, 16350);
  });
});
