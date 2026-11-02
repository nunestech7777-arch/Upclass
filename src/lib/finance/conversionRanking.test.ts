// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FinanceSale, FinanceSeller } from './calc.ts';
import { salesIn } from './dashboard.ts';
import { rangeToInstants } from '../supervisor/filters.ts';
import {
  attendanceCacheKey,
  buildConversionRanking,
  conversionLeader,
  conversionText,
  isMissingFunctionError,
  MIN_ATTENDANCES,
  ordersBySeller,
  salesStillArriving,
  sortByConversion,
} from './conversionRanking.ts';

const names = new Map([
  ['iphone', 'IPHONE 15 128GB'],
  ['capa', 'CAPA SILICONE'],
  ['pelicula', 'PELÍCULA 3D'],
]);

function seller(id: string, name: string, kommo: string | null, extra: Partial<FinanceSeller> = {}): FinanceSeller {
  return { id, name, photo_url: null, active: true, show_in_ranking: true, kommo_user_id: kommo, ...extra };
}

let seq = 0;
function sale(sellerId: string, order: string | null, extra: Partial<FinanceSale> = {}): FinanceSale {
  seq += 1;
  return {
    id: `s${seq}`,
    seller_id: sellerId,
    product_id: 'iphone',
    quantity: 1,
    amount: 5000,
    sold_at: '2026-10-10T15:00:00Z',
    sold_date: '2026-10-10',
    external_id: null,
    mp_order_id: order,
    item_status: 'active',
    revenue: null,
    cost: null,
    profit: null,
    profit_reported: null,
    financial_status: 'pending',
    financial_note: null,
    customer_name: null,
    product_type: null,
    ...extra,
  };
}

/** n pedidos distintos de um vendedor, um item cada. */
const orders = (sellerId: string, n: number, prefix = sellerId) => Array.from({ length: n }, (_, i) => sale(sellerId, `${prefix}-${i}`));

test('poucos atendimentos e muitas vendas fica acima de muitos atendimentos e poucas vendas (exemplo Yasmin × Tony)', () => {
  const sellers = [seller('tony', 'TONY', 'k-tony'), seller('yas', 'YASMIN', 'k-yas')];
  const sales = [...orders('tony', 100), ...orders('yas', 19)];
  const rows = buildConversionRanking(sales, names, sellers, new Map([['k-tony', 1000], ['k-yas', 20]]), 20);
  assert.deepEqual(rows.map((r) => [r.seller.id, r.position, r.index]), [
    ['yas', 1, 95],
    ['tony', 2, 10],
  ]);
});

test('volume absoluto não vence: mais vendas com índice menor fica atrás', () => {
  const sellers = [seller('a', 'A', 'ka'), seller('b', 'B', 'kb')];
  const rows = buildConversionRanking([...orders('a', 60), ...orders('b', 10)], names, sellers, new Map([['ka', 600], ['kb', 50]]));
  assert.equal(rows[0].seller.id, 'b');
  assert.equal(rows[0].index, 20);
  assert.equal(rows[1].index, 10);
});

test('vendedor sem atendimentos: sem índice e sem posição (nunca divide por zero)', () => {
  const rows = buildConversionRanking(orders('a', 5), names, [seller('a', 'A', 'ka')], new Map());
  assert.equal(rows[0].status, 'no_attendance');
  assert.equal(rows[0].attendances, 0);
  assert.equal(rows[0].index, null);
  assert.equal(rows[0].position, null);
  assert.equal(rows[0].orders, 5);
});

test('vendedor sem vendas: índice 0% e classificado se tiver atendimentos suficientes', () => {
  const rows = buildConversionRanking([], names, [seller('a', 'A', 'ka')], new Map([['ka', 40]]));
  assert.equal(rows[0].status, 'ranked');
  assert.equal(rows[0].index, 0);
  assert.equal(rows[0].position, 1);
});

test('vendedor sem vínculo Kommo: atendimentos ausentes (null), não zero, e fora da classificação', () => {
  const rows = buildConversionRanking(orders('g', 54), names, [seller('g', 'GRACIANE', null)], new Map([['qualquer', 500]]));
  assert.equal(rows[0].status, 'no_kommo_link');
  assert.equal(rows[0].attendances, null);
  assert.equal(rows[0].index, null);
  assert.equal(rows[0].orders, 54);
});

test('sem vendas no MercadoPhone no período: vendas 0 (o vínculo MercadoPhone é o próprio vendedor do item)', () => {
  const rows = buildConversionRanking(orders('outro', 3), names, [seller('a', 'A', 'ka')], new Map([['ka', 30]]));
  assert.equal(rows[0].orders, 0);
  assert.equal(rows[0].index, 0);
});

test('abaixo do mínimo de atendimentos: aparece, mas sem posição; classificados vêm antes', () => {
  const sellers = [seller('poucos', 'POUCOS', 'kp'), seller('muitos', 'MUITOS', 'km')];
  const rows = buildConversionRanking([...orders('poucos', 10), ...orders('muitos', 3)], names, sellers, new Map([['kp', MIN_ATTENDANCES - 1], ['km', 100]]));
  assert.deepEqual(rows.map((r) => [r.seller.id, r.status, r.position]), [
    ['muitos', 'ranked', 1],
    ['poucos', 'insufficient', null],
  ]);
  assert.ok((rows[1].index ?? 0) > (rows[0].index ?? 0), 'índice maior não fura o mínimo');
});

test('mínimo exato: 30 atendimentos classifica, 29 não', () => {
  const sellers = [seller('a', 'A', 'ka'), seller('b', 'B', 'kb')];
  const rows = buildConversionRanking([], names, sellers, new Map([['ka', 30], ['kb', 29]]));
  assert.deepEqual(rows.map((r) => [r.seller.id, r.status]), [
    ['a', 'ranked'],
    ['b', 'insufficient'],
  ]);
});

test('venda de vendedor do MercadoPhone fora da lista (inativo/oculto/desconhecido) não entra nem vaza para outro', () => {
  const sellers = [seller('a', 'A', 'ka'), seller('off', 'INATIVO', 'ko', { active: false })];
  const rows = buildConversionRanking([...orders('desconhecido', 7), ...orders('off', 4), ...orders('a', 3)], names, sellers, new Map([['ka', 30], ['ko', 30]]));
  assert.deepEqual(rows.map((r) => [r.seller.id, r.orders]), [['a', 3]]);
});

test('o mesmo usuário do Kommo não empresta atendimentos a quem não está vinculado a ele', () => {
  const sellers = [seller('a', 'A', 'ka'), seller('b', 'B', 'kb')];
  const rows = buildConversionRanking([], names, sellers, new Map([['ka', 40]]));
  assert.deepEqual(rows.map((r) => [r.seller.id, r.attendances, r.status]), [
    ['a', 40, 'ranked'],
    ['b', 0, 'no_attendance'],
  ]);
});

test('pedido com vários produtos conta uma venda; pedido com itens de dois vendedores conta para os dois', () => {
  const sales = [
    sale('a', 'P1'),
    sale('a', 'P1', { product_id: 'capa', amount: 80 }),
    sale('a', 'P1', { product_id: 'pelicula', amount: 50 }),
    sale('b', 'P1', { product_id: 'capa', amount: 80 }),
  ];
  const map = ordersBySeller(sales, names);
  assert.equal(map.get('a'), 1, 'três itens, um pedido');
  assert.equal(map.get('b'), 1);
});

test('linha repetida do mesmo pedido não duplica a venda', () => {
  assert.equal(ordersBySeller([sale('a', 'P9'), sale('a', 'P9')], names).get('a'), 1);
});

test('itens cancelados e brindes sozinhos não contam como venda', () => {
  const sales = [
    sale('a', 'C1', { item_status: 'cancelled' }),
    sale('a', 'B1', { product_id: 'capa', amount: 0 }),
    sale('a', 'OK'),
    sale('a', 'OK', { product_id: 'capa', amount: 0 }),
  ];
  assert.equal(ordersBySeller(sales, names).get('a'), 1);
});

test('período: só vendas com data da venda dentro do filtro (lançamento posterior não muda o dia)', () => {
  const sales = [
    sale('a', 'D1', { sold_date: '2026-10-09', created_at: '2026-10-12T12:00:00Z' }),
    sale('a', 'D2', { sold_date: '2026-10-10', created_at: '2026-10-15T12:00:00Z' }),
    sale('a', 'D3', { sold_date: '2026-10-11' }),
  ];
  const inRange = salesIn(sales, { from: '2026-10-10', to: '2026-10-11' });
  assert.equal(ordersBySeller(inRange, names).get('a'), 2);
});

test('mesmo dia civil nas duas fontes: período 10/10 → mensagens de 10/10 00:00 a 11/10 00:00 (UTC−3) e sold_date 10/10', () => {
  const day = { from: '2026-10-10', to: '2026-10-10' };
  assert.deepEqual(rangeToInstants(day), { fromIso: '2026-10-10T03:00:00.000Z', toIso: '2026-10-11T03:00:00.000Z' });
  // Venda lançada dia 13 com data retroativa de 10/10 é do dia 10; a de 09/10 às 23h não.
  const sales = [sale('a', 'R1', { sold_date: '2026-10-10', created_at: '2026-10-13T15:00:00Z' }), sale('a', 'R2', { sold_date: '2026-10-09', sold_at: '2026-10-10T02:30:00Z' })];
  assert.equal(ordersBySeller(salesIn(sales, day), names).get('a'), 1);
});

test('cache por conta e período; a virada do dia troca a chave; erro de função ausente é reconhecido', () => {
  const range = { from: '2026-11-01', to: '2026-11-02' };
  assert.notEqual(attendanceCacheKey('contaA', range, '2026-11-02'), attendanceCacheKey('contaB', range, '2026-11-02'));
  assert.notEqual(attendanceCacheKey('contaA', range, '2026-11-02'), attendanceCacheKey('contaA', { ...range, to: '2026-11-03' }, '2026-11-02'));
  assert.notEqual(attendanceCacheKey('contaA', range, '2026-11-02'), attendanceCacheKey('contaA', range, '2026-11-03'), 'live → past');
  assert.equal(isMissingFunctionError({ code: 'PGRST202', message: 'x' }), true);
  assert.equal(isMissingFunctionError({ message: 'Could not find the function public.kommo_attended_conversations' }), true);
  assert.equal(isMissingFunctionError({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
});

test('aviso de vendas em lançamento só quando o período chega aos últimos 6 dias', () => {
  assert.equal(salesStillArriving('2026-11-02', '2026-11-02'), true);
  assert.equal(salesStillArriving('2026-10-27', '2026-11-02'), true);
  assert.equal(salesStillArriving('2026-10-26', '2026-11-02'), false);
  assert.equal(salesStillArriving('2026-10-31', '2026-11-02'), true);
});

test('só vendedores ativos e visíveis no ranking; desempate por pedidos, atendimentos e nome', () => {
  const sellers = [
    seller('off', 'INATIVO', 'k0', { active: false }),
    seller('hid', 'OCULTO', 'k1', { show_in_ranking: false }),
    seller('c', 'CARLA', 'kc'),
    seller('b', 'BRUNA', 'kb'),
    seller('a', 'ANA', 'ka'),
  ];
  const sales = [...orders('c', 10), ...orders('b', 5), ...orders('a', 5)];
  // Todos com 10%: c = 10/100, a = 5/50, b = 5/50.
  const rows = buildConversionRanking(sales, names, sellers, new Map([['k0', 999], ['k1', 999], ['kc', 100], ['kb', 50], ['ka', 50]]));
  assert.deepEqual(rows.map((r) => r.seller.id), ['c', 'a', 'b'], 'mesmo índice: mais pedidos; depois nome');
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 3]);
});

test('índice pode passar de 100% (vendas de balcão sem conversa) e não é limitado', () => {
  const rows = buildConversionRanking(orders('a', 45), names, [seller('a', 'A', 'ka')], new Map([['ka', 30]]));
  assert.equal(rows[0].index, 150);
});

// ---------------------------------------------------------------------------
// Unificação: cards da tela Vendedores, "Por Conversão", "Maior Conversão" e relatório
// ---------------------------------------------------------------------------

const fmt = (v: number) => `${v.toFixed(1).replace('.', ',')}%`;

function unifiedFixture() {
  const sellers = [
    seller('tony', 'TONY', 'k-tony'),
    seller('yas', 'YASMIN', 'k-yas'),
    seller('gra', 'GRACIANE', null),
    seller('jul', 'JULY', 'k-jul'),
    seller('pou', 'POUCOS', 'k-pou'),
  ];
  const sales = [...orders('tony', 100), ...orders('yas', 19), ...orders('gra', 54), ...orders('jul', 43), ...orders('pou', 5)];
  const rows = buildConversionRanking(sales, names, sellers, new Map([['k-tony', 1000], ['k-yas', 20], ['k-pou', 10]]), 20);
  // Cards da tela Vendedores (volume de produtos, outra fonte): Tony vende mais.
  const cards = [
    { seller: { id: 'tony' }, sold: 300 },
    { seller: { id: 'gra' }, sold: 91 },
    { seller: { id: 'jul' }, sold: 88 },
    { seller: { id: 'yas' }, sold: 62 },
    { seller: { id: 'oculto' }, sold: 500 },
    { seller: { id: 'pou' }, sold: 7 },
  ];
  return { rows, cards };
}

test('"Por Conversão" ordena os cards pela taxa (não pelo volume) com as mesmas posições do ranking', () => {
  const { rows, cards } = unifiedFixture();
  const sorted = sortByConversion(cards, rows, (a, b) => b.sold - a.sold);
  assert.deepEqual(sorted.map((s) => [s.item.seller.id, s.position]), [
    ['yas', 1],
    ['tony', 2],
    ['pou', null],
    ['jul', null],
    ['gra', null],
    ['oculto', null],
  ]);
  // Cada card mostra a mesma taxa do ranking.
  for (const s of sorted) assert.equal(s.row, rows.find((r) => r.seller.id === s.item.seller.id));
});

test('"Maior Conversão" é o 1º do ranking e mostra o mesmo número dos cards', () => {
  const { rows } = unifiedFixture();
  const leader = conversionLeader(rows);
  assert.equal(leader?.seller.id, 'yas');
  assert.equal(conversionText(leader!, fmt), '95,0%');
  assert.equal(conversionText(rows.find((r) => r.seller.id === 'yas'), fmt), conversionText(leader!, fmt));
});

test('sem classificados não há líder; ausência de dado nunca aparece como 0%', () => {
  const rows = buildConversionRanking(orders('a', 3), names, [seller('a', 'A', 'ka'), seller('b', 'B', null)], new Map([['ka', 5]]));
  assert.equal(conversionLeader(rows), null);
  assert.equal(conversionLeader(null), null);
  assert.equal(conversionText(rows.find((r) => r.seller.id === 'b'), fmt), 'Sem vínculo Kommo');
  assert.equal(conversionText(undefined, fmt), 'Sem dados');
  const noAtt = buildConversionRanking([], names, [seller('c', 'C', 'kc')], new Map());
  assert.equal(conversionText(noAtt[0], fmt), 'Sem atendimentos');
  // Abaixo do mínimo: o número é o mesmo do ranking (o card indica "poucos atendimentos").
  assert.equal(conversionText(rows.find((r) => r.seller.id === 'a'), fmt), '60,0%');
});

test('mudança de período e atualização de dados: nova contagem gera novo ranking, sem resto do anterior', () => {
  const sellers = [seller('a', 'A', 'ka'), seller('b', 'B', 'kb')];
  const week1 = buildConversionRanking(orders('a', 10, 'w1a'), names, sellers, new Map([['ka', 40], ['kb', 40]]));
  const week2 = buildConversionRanking(orders('b', 12, 'w2b'), names, sellers, new Map([['ka', 40], ['kb', 40]]));
  assert.equal(conversionLeader(week1)?.seller.id, 'a');
  assert.equal(conversionLeader(week2)?.seller.id, 'b');
  // Novo vínculo do Kommo: o vendedor passa de "sem vínculo" a classificado.
  const before = buildConversionRanking(orders('a', 5), names, [seller('a', 'A', null)], new Map([['ka', 50]]));
  const after = buildConversionRanking(orders('a', 5), names, [seller('a', 'A', 'ka')], new Map([['ka', 50]]));
  assert.equal(before[0].status, 'no_kommo_link');
  assert.equal(after[0].status, 'ranked');
  assert.equal(after[0].index, 10);
});
