import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from './calc.ts';
import {
  buildCategoryForecast,
  formatPace,
  teamPace,
  parseDeviceTarget,
  buildSellerRow,
  countByCategory,
  countDevicesBySeller,
  countUnitsBySeller,
  forecastSortLabels,
  UNIT_COPY,
  projectUnits,
  sortUnitRows,
  summarizeTeam,
  type UnitSale,
} from './forecast.ts';

const names = new Map([
  ['iphone', 'IPHONE 15 128GB'],
  ['pelicula', 'PELICULA VIDRO'],
  ['capa', 'CAPA CASE'],
  ['brinde', 'CAPA TRANSPARENTE - BND'],
  ['watch', 'APPLE WATCH SERIES 9'],
]);
const sale = (o: Partial<UnitSale> & Pick<UnitSale, 'seller_id' | 'product_id' | 'sold_date'>): UnitSale => ({ quantity: 1, amount: 100, ...o });
// 14/10: dias completos = 13 (01..13), hoje = 14, restam 18 (inclui hoje)
const ctx = buildContext('2026-10', '2026-10-14');

describe('countDevicesBySeller', () => {
  it('conta só iPhone, do vendedor do item (pedido 8393342: Caroline iPhone, Graciane película)', () => {
    const counts = countDevicesBySeller(
      [
        sale({ seller_id: 'caroline', product_id: 'iphone', sold_date: '2026-10-05', amount: 4000 }),
        sale({ seller_id: 'graciane', product_id: 'pelicula', sold_date: '2026-10-05' }),
        sale({ seller_id: 'caroline', product_id: 'brinde', sold_date: '2026-10-05', amount: 0 }),
        sale({ seller_id: 'caroline', product_id: 'watch', sold_date: '2026-10-05', amount: 2500 }),
      ],
      names,
      ctx
    );
    assert.equal(counts.get('caroline')?.sold, 1);
    assert.equal(counts.has('graciane'), false);
  });

  it('ignora canceladas e removidas e soma quantidade; separa hoje do corte', () => {
    const counts = countDevicesBySeller(
      [
        sale({ seller_id: 'a', product_id: 'iphone', sold_date: '2026-10-13', quantity: 2 }),
        sale({ seller_id: 'a', product_id: 'iphone', sold_date: '2026-10-14' }),
        sale({ seller_id: 'a', product_id: 'iphone', sold_date: '2026-10-10', item_status: 'cancelled' }),
        sale({ seller_id: 'a', product_id: 'iphone', sold_date: '2026-10-10', item_status: 'removed' }),
      ],
      names,
      ctx
    );
    assert.deepEqual(counts.get('a'), { sold: 3, untilCutoff: 2, today: 1 });
  });
});

describe('projectUnits', () => {
  it('mês atual: vendidos até ontem ÷ dias completos × dias do mês', () => {
    assert.equal(projectUnits(13, 13, ctx), 31);
    assert.ok(Math.abs(projectUnits(10, 10, ctx)! - (10 / 13) * 31) < 1e-9);
  });
  it('nunca fica abaixo do que já foi vendido (hoje incluso)', () => {
    assert.equal(projectUnits(30, 2, ctx), 30);
  });
  it('mês encerrado mostra o realizado; futuro e 1º dia do mês ficam indisponíveis', () => {
    assert.equal(projectUnits(40, 40, buildContext('2026-09', '2026-10-14')), 40);
    assert.equal(projectUnits(0, 0, buildContext('2026-11', '2026-10-14')), null);
    assert.equal(projectUnits(3, 0, buildContext('2026-11', '2026-11-01')), null);
  });
  it('sem vendas no mês atual projeta zero, não valor artificial', () => {
    assert.equal(projectUnits(0, 0, ctx), 0);
  });
});

describe('buildSellerRow', () => {
  it('meta 50, 32 vendidos: faltam 18, 64%, ritmo = 18 ÷ 18 dias restantes', () => {
    const r = buildSellerRow('a', { sold: 32, untilCutoff: 30, today: 2 }, 50, ctx);
    assert.equal(r.remaining, 18);
    assert.equal(r.pct, 64);
    assert.equal(r.neededPerDay, 1);
    assert.equal(r.goalReached, false);
  });
  it('meta batida: não mostra negativo nem ritmo; percentual passa de 100', () => {
    const r = buildSellerRow('a', { sold: 60, untilCutoff: 60, today: 0 }, 50, ctx);
    assert.equal(r.remaining, 0);
    assert.equal(r.goalReached, true);
    assert.equal(r.pct, 120);
    assert.equal(r.neededPerDay, null);
  });
  it('sem meta (ausente ou zero): tudo indisponível, vendidos continuam', () => {
    for (const target of [null, 0]) {
      const r = buildSellerRow('a', { sold: 5, untilCutoff: 5, today: 0 }, target, ctx);
      assert.equal(r.target, null);
      assert.equal(r.remaining, null);
      assert.equal(r.pct, null);
      assert.equal(r.neededPerDay, null);
      assert.equal(r.sold, 5);
    }
  });
  it('mês encerrado não calcula ritmo futuro', () => {
    const past = buildContext('2026-09', '2026-10-14');
    assert.equal(buildSellerRow('a', { sold: 10, untilCutoff: 10, today: 0 }, 50, past).neededPerDay, null);
  });
  it('vendedor sem vendas aparece com zero', () => {
    const r = buildSellerRow('a', undefined, 20, ctx);
    assert.equal(r.sold, 0);
    assert.equal(r.remaining, 20);
    assert.equal(r.projection, 0);
  });
});

describe('summarizeTeam', () => {
  const rows = [
    buildSellerRow('a', { sold: 32, untilCutoff: 32, today: 0 }, 50, ctx),
    buildSellerRow('b', { sold: 45, untilCutoff: 45, today: 0 }, 40, ctx),
    buildSellerRow('c', { sold: 4, untilCutoff: 4, today: 0 }, null, ctx),
  ];
  it('meta = soma das metas; faltam = meta − vendido por quem tem meta (excedente compensa)', () => {
    const t = summarizeTeam(rows);
    assert.equal(t.target, 90);
    assert.equal(t.sold, 81);
    assert.equal(t.remaining, 13);
    assert.ok(Math.abs(t.pct! - (77 / 90) * 100) < 1e-9);
    assert.equal(t.sellersWithGoal, 2);
  });
  it('projeção da equipe é a soma exata das individuais (arredonda só uma vez)', () => {
    const t = summarizeTeam(rows);
    const exact = rows.reduce((a, r) => a + r.projection!, 0);
    assert.equal(t.projection, exact);
  });
  it('sem nenhuma meta, meta e faltam ficam indisponíveis', () => {
    const t = summarizeTeam([rows[2]]);
    assert.equal(t.target, null);
    assert.equal(t.remaining, null);
  });
});

describe('sortUnitRows', () => {
  const mk = (id: string, sold: number, target: number | null) => ({ ...buildSellerRow(id, { sold, untilCutoff: sold, today: 0 }, target, ctx), name: id });
  const rows = [mk('a', 10, 50), mk('b', 30, 40), mk('c', 20, null), mk('d', 25, 30)];
  it('mais vendidos', () => assert.deepEqual(sortUnitRows(rows, 'sold').map((r) => r.name), ['b', 'd', 'c', 'a']));
  it('menor faltante: sem meta vai para o fim', () => assert.deepEqual(sortUnitRows(rows, 'remainingAsc').map((r) => r.name), ['d', 'b', 'a', 'c']));
  it('maior faltante', () => assert.deepEqual(sortUnitRows(rows, 'remainingDesc').map((r) => r.name), ['a', 'b', 'd', 'c']));
  it('maior percentual', () => assert.deepEqual(sortUnitRows(rows, 'pct').map((r) => r.name), ['d', 'b', 'a', 'c']));
});

describe('categoria e gráfico usam a mesma regra de tempo', () => {
  it('acessório só conta pago; brinde fora; aparelho separado', () => {
    const c = countByCategory(
      [
        sale({ seller_id: 'a', product_id: 'iphone', sold_date: '2026-10-02' }),
        sale({ seller_id: 'a', product_id: 'capa', sold_date: '2026-10-02', quantity: 2 }),
        sale({ seller_id: 'a', product_id: 'brinde', sold_date: '2026-10-02', amount: 0 }),
      ],
      names,
      ctx
    );
    assert.equal(c.devices.sold, 1);
    assert.equal(c.accessories.sold, 2);
  });
  it('projeção do gráfico = projeção da tabela para o mesmo conjunto de vendas', () => {
    const count = { sold: 20, untilCutoff: 18, today: 2 };
    const cat = buildCategoryForecast('Aparelhos', count, 40, ctx);
    assert.equal(cat.projection, projectUnits(20, 18, ctx));
    assert.equal(cat.chartData.at(-1)!.produtos, Math.round(cat.projection!));
    assert.equal(cat.dailyNeeded, 20 / 18);
  });
});

describe('parseDeviceTarget', () => {
  it('aceita inteiros, vazio vira sem meta, o resto é inválido', () => {
    assert.equal(parseDeviceTarget('50'), 50);
    assert.equal(parseDeviceTarget(' 0 '), 0);
    assert.equal(parseDeviceTarget(''), null);
    for (const bad of ['-1', '1,5', '2.5', 'abc']) assert.ok(Number.isNaN(parseDeviceTarget(bad)), bad);
  });
});

describe('formatPace (padrão "N ap/dia" e "1 ap/X dias")', () => {
  it('casos obrigatórios com 10 dias restantes', () => {
    assert.equal(formatPace(1, 10), '1 ap/10 dias');
    assert.equal(formatPace(2, 10), '1 ap/5 dias');
    assert.equal(formatPace(5, 10), '1 ap/2 dias');
    assert.equal(formatPace(10, 10), '1 ap/dia');
    assert.equal(formatPace(15, 10), '2 ap/dia');
    assert.equal(formatPace(25, 10), '3 ap/dia');
  });
  it('1 ou mais por dia arredonda para cima', () => {
    assert.equal(formatPace(21, 14), '2 ap/dia'); // 1,5
    assert.equal(formatPace(12, 10), '2 ap/dia'); // 1,2
    assert.equal(formatPace(19, 10), '2 ap/dia'); // 1,9
    assert.equal(formatPace(21, 10), '3 ap/dia'); // 2,1
    assert.equal(formatPace(28, 10), '3 ap/dia'); // 2,8
    assert.equal(formatPace(32, 10), '4 ap/dia'); // 3,2
    assert.equal(formatPace(30, 10), '3 ap/dia'); // exato, sem subir para 4
  });
  it('menos de 1 por dia arredonda os dias para baixo (nunca promete menos que o necessário)', () => {
    assert.equal(formatPace(4, 10), '1 ap/2 dias'); // 2,5 dias por aparelho
    assert.equal(formatPace(3, 10), '1 ap/3 dias'); // 3,33
    assert.equal(formatPace(13, 50), '1 ap/3 dias'); // 3,85
    assert.equal(formatPace(5, 26), '1 ap/5 dias'); // 5,2
    assert.equal(formatPace(9, 10), '1 ap/dia'); // 1,11 dia por aparelho nunca vira "1 ap/1 dias"
  });
  it('sem decimais, espaços ao redor da barra ou "Ap" maiúsculo; "dia" no singular só quando cabe', () => {
    for (const [r, d] of [[1, 10], [2, 10], [7, 31], [21, 14], [100, 3], [1, 2]]) {
      assert.match(formatPace(r, d), /^(\d+ ap\/dia|1 ap\/\d+ dias)$/);
    }
    assert.equal(formatPace(1, 2), '1 ap/2 dias');
  });
  it('nunca devolve NaN ou Infinity', () => {
    for (const [r, d] of [[0, 10], [5, 0], [-1, 5], [5, -2], [Number.NaN, 3], [3, Number.NaN]]) {
      const out = formatPace(r, d);
      assert.equal(out, '—');
      assert.doesNotMatch(out, /NaN|Infinity/);
    }
  });
});

describe('teamPace (card "Ritmo necessário")', () => {
  const day = (month: string, today: string) => buildContext(month, today);
  // 17 dias completos em outubro: restam 14 (hoje incluso)
  const oct = day('2026-10', '2026-10-18');
  const team = (target: number | null, sold: number) => {
    const rows = target == null ? [] : [buildSellerRow('a', { sold, untilCutoff: sold, today: 0 }, target, oct)];
    return summarizeTeam(rows);
  };

  it('exemplo do pedido: meta 120, vendidos 99, faltam 21, 14 dias restantes → "2 ap/dia"', () => {
    const t = team(120, 99);
    assert.equal(t.remaining, 21);
    const p = teamPace(t, oct);
    assert.equal(p.state, 'pace');
    assert.equal(p.value, '2 ap/dia');
    assert.equal(p.caption, 'Faltam 21 aparelhos · 14 dias restantes');
  });
  it('é consistente com o card "Faltam para a meta" (mesmo valor de faltantes)', () => {
    const t = team(120, 99);
    assert.equal(teamPace(t, oct).caption.includes(`${t.remaining} aparelhos`), true);
  });
  it('singulares: falta 1 aparelho · 1 dia restante (último dia do mês)', () => {
    const last = day('2026-10', '2026-10-31');
    const t = summarizeTeam([buildSellerRow('a', { sold: 9, untilCutoff: 9, today: 0 }, 10, last)]);
    assert.equal(last.remainingDays, 1);
    const p = teamPace(t, last);
    assert.equal(p.value, '1 ap/dia');
    assert.equal(p.caption, 'Falta 1 aparelho · 1 dia restante');
  });
  it('último dia com vários faltantes: tudo em um dia', () => {
    const last = day('2026-10', '2026-10-31');
    const t = summarizeTeam([buildSellerRow('a', { sold: 5, untilCutoff: 5, today: 0 }, 12, last)]);
    assert.equal(teamPace(t, last).value, '7 ap/dia');
  });
  it('meta atingida e ultrapassada', () => {
    assert.equal(teamPace(team(120, 120), oct).value, 'Meta atingida');
    assert.equal(teamPace(team(120, 140), oct).value, 'Meta atingida');
    assert.equal(teamPace(team(120, 140), oct).state, 'reached');
  });
  it('sem meta (ausente ou zero)', () => {
    assert.equal(teamPace(team(null, 50), oct).value, 'Sem meta');
    assert.equal(teamPace(summarizeTeam([buildSellerRow('a', undefined, 0, oct)]), oct).value, 'Sem meta');
  });
  it('mês encerrado: resultado histórico, sem ritmo futuro', () => {
    const past = day('2026-09', '2026-10-18');
    const missed = summarizeTeam([buildSellerRow('a', { sold: 80, untilCutoff: 80, today: 0 }, 100, past)]);
    const p = teamPace(missed, past);
    assert.equal(p.value, 'Meta não atingida');
    assert.equal(p.caption, 'Faltaram 20 aparelhos · mês encerrado');
    const ok = summarizeTeam([buildSellerRow('a', { sold: 100, untilCutoff: 100, today: 0 }, 100, past)]);
    assert.equal(teamPace(ok, past).value, 'Meta atingida');
  });
  it('mês futuro: estado informativo, sem vendas nem ritmo', () => {
    const future = day('2026-12', '2026-10-18');
    const t = summarizeTeam([buildSellerRow('a', undefined, 30, future)]);
    const p = teamPace(t, future);
    assert.equal(p.state, 'future');
    assert.equal(p.value, '—');
  });
  it('sem dias restantes: estado próprio, sem divisão por zero', () => {
    const noDays = { ...oct, remainingDays: 0 };
    const p = teamPace(team(120, 99), noDays);
    assert.equal(p.state, 'no_days');
    assert.doesNotMatch(`${p.value} ${p.caption}`, /NaN|Infinity/);
  });
  it('primeiro dia do mês: dias restantes = dias do mês', () => {
    const first = day('2026-11', '2026-11-01');
    assert.equal(first.remainingDays, 30);
    const t = summarizeTeam([buildSellerRow('a', undefined, 30, first)]);
    assert.equal(teamPace(t, first).value, '1 ap/dia');
  });
  it('mudança de mês: no dia 1 do mês novo o mês anterior já é histórico', () => {
    const oct31 = day('2026-10', '2026-11-01');
    assert.equal(oct31.phase, 'past');
    const t = summarizeTeam([buildSellerRow('a', { sold: 1, untilCutoff: 1, today: 0 }, 5, oct31)]);
    assert.equal(teamPace(t, oct31).state, 'missed');
  });
  it('fevereiro com 28 e 29 dias', () => {
    const f28 = day('2026-02', '2026-02-27');
    const f29 = day('2028-02', '2028-02-27');
    assert.equal(f28.daysInMonth, 28);
    assert.equal(f29.daysInMonth, 29);
    assert.equal(f28.remainingDays, 2);
    assert.equal(f29.remainingDays, 3);
    const t28 = summarizeTeam([buildSellerRow('a', { sold: 0, untilCutoff: 0, today: 0 }, 5, f28)]);
    const t29 = summarizeTeam([buildSellerRow('a', { sold: 0, untilCutoff: 0, today: 0 }, 5, f29)]);
    assert.equal(teamPace(t28, f28).value, '3 ap/dia'); // 5 ÷ 2 = 2,5
    assert.equal(teamPace(t29, f29).value, '2 ap/dia'); // 5 ÷ 3 = 1,67
  });
  it('o ritmo da equipe vem dos totais, não da soma de ritmos individuais arredondados', () => {
    // 3 vendedores faltando 1 cada em 10 dias: individual "1 ap/10 dias" ×3, mas a equipe precisa de 3 em 10 dias
    const t = summarizeTeam(
      ['a', 'b', 'c'].map((id) => buildSellerRow(id, { sold: 9, untilCutoff: 9, today: 0 }, 10, oct))
    );
    assert.equal(t.remaining, 3);
    assert.equal(teamPace(t, { ...oct, remainingDays: 10 }).value, '1 ap/3 dias');
    assert.equal(formatPace(1, 10), '1 ap/10 dias');
  });
});

describe('categoria acessórios (mesmo componente, regras próprias)', () => {
  const oct = buildContext('2026-10', '2026-10-18');
  const nm = new Map([
    ['iphone', 'IPHONE 15 128GB'], ['pel', 'PELICULA ZEUS - ZEUS'], ['capa', 'CAPA CASE - . - .'],
    ['watch', 'APPLE WATCH SERIES 9'], ['airpods', 'AIRPODS PRO 2'], ['bnd', 'CAPA TRANSPARENTE - BND'],
  ]);
  const mk = (seller: string, product: string, o: Partial<UnitSale> = {}): UnitSale => ({ seller_id: seller, product_id: product, quantity: 1, amount: 100, sold_date: '2026-10-05', ...o });

  it('conta películas, capas, Apple Watch e AirPods pagos; iPhone não; brinde (R$ 0) não', () => {
    const c = countUnitsBySeller(
      [mk('a', 'pel', { amount: 70 }), mk('a', 'capa', { quantity: 2, amount: 120 }), mk('a', 'watch', { amount: 2500 }), mk('a', 'airpods', { amount: 1500 }), mk('a', 'iphone', { amount: 4000 }), mk('a', 'bnd', { amount: 0, quantity: 5 })],
      nm, oct, 'accessories'
    );
    assert.equal(c.get('a')?.sold, 5); // 1 + 2 + 1 + 1
  });
  it('película paga conta 1; a mesma película como brinde não conta', () => {
    assert.equal(countUnitsBySeller([mk('a', 'pel', { amount: 70 })], nm, oct, 'accessories').get('a')?.sold, 1);
    assert.equal(countUnitsBySeller([mk('a', 'pel', { amount: 0 })], nm, oct, 'accessories').has('a'), false);
  });
  it('vendas canceladas ou obsoletas não contam, em nenhuma categoria', () => {
    const rows = [mk('a', 'pel', { item_status: 'cancelled' }), mk('a', 'pel', { item_status: 'removed' }), mk('a', 'iphone', { item_status: 'cancelled' })];
    assert.equal(countUnitsBySeller(rows, nm, oct, 'accessories').size, 0);
    assert.equal(countUnitsBySeller(rows, nm, oct, 'devices').size, 0);
  });
  it('pedido 8393342: Caroline recebe o iPhone, Graciane recebe a película (vendedor do item)', () => {
    const order = [mk('caroline', 'iphone', { amount: 4712 }), mk('graciane', 'pel', { amount: 70 })];
    const dev = countUnitsBySeller(order, nm, oct, 'devices');
    const acc = countUnitsBySeller(order, nm, oct, 'accessories');
    assert.equal(dev.get('caroline')?.sold, 1);
    assert.equal(dev.has('graciane'), false);
    assert.equal(acc.get('graciane')?.sold, 1);
    assert.equal(acc.has('caroline'), false);
  });
  it('as categorias não se misturam: cada unidade conta em uma só', () => {
    const rows = [mk('a', 'iphone', { amount: 4000 }), mk('a', 'pel', { amount: 70 }), mk('a', 'bnd', { amount: 0 })];
    const dev = [...countUnitsBySeller(rows, nm, oct, 'devices').values()].reduce((a, c) => a + c.sold, 0);
    const acc = [...countUnitsBySeller(rows, nm, oct, 'accessories').values()].reduce((a, c) => a + c.sold, 0);
    assert.equal(dev + acc, 2, 'o brinde fica fora das duas');
  });
  it('metas independentes: a meta de aparelhos não vira meta de acessórios', () => {
    const rows = [mk('a', 'iphone', { amount: 4000, quantity: 10 }), mk('a', 'pel', { amount: 70, quantity: 20 })];
    const dev = buildSellerRow('a', countUnitsBySeller(rows, nm, oct, 'devices').get('a'), 20, oct);
    const accNoGoal = buildSellerRow('a', countUnitsBySeller(rows, nm, oct, 'accessories').get('a'), null, oct);
    const accGoal = buildSellerRow('a', countUnitsBySeller(rows, nm, oct, 'accessories').get('a'), 30, oct);
    assert.equal(dev.remaining, 10);
    assert.equal(accNoGoal.target, null, 'sem meta de acessórios = Sem meta, nunca 20');
    assert.equal(accNoGoal.remaining, null);
    assert.equal(accGoal.remaining, 10);
    assert.ok(Math.abs(accGoal.pct! - (20 / 30) * 100) < 1e-9);
  });
  it('projeção de acessórios usa a mesma metodologia (vendidos até ontem ÷ dias completos × dias do mês)', () => {
    const rows = [mk('a', 'pel', { amount: 70, quantity: 17, sold_date: '2026-10-10' })];
    const row = buildSellerRow('a', countUnitsBySeller(rows, nm, oct, 'accessories').get('a'), 40, oct);
    assert.equal(row.projection, (17 / 17) * 31);
  });
  it('ritmo em "ac": 21 faltam em 14 dias → "2 ac/dia"; abaixo de 1 por dia → "1 ac/X dias"', () => {
    assert.equal(formatPace(21, 14, 'ac'), '2 ac/dia');
    assert.equal(formatPace(3, 10, 'ac'), '1 ac/3 dias');
    assert.equal(formatPace(10, 10, 'ac'), '1 ac/dia');
    assert.equal(formatPace(1, 10), '1 ap/10 dias', 'aparelhos continuam com "ap"');
    const t = summarizeTeam([buildSellerRow('a', { sold: 9, untilCutoff: 9, today: 0 }, 30, oct)]);
    const p = teamPace(t, oct, 'accessories');
    assert.equal(p.value, '2 ac/dia'); // 21 ÷ 14 = 1,5
    assert.equal(p.caption, 'Faltam 21 acessórios · 14 dias restantes');
    assert.equal(teamPace({ target: null, remaining: null }, oct, 'accessories').caption, 'Cadastre as metas de acessórios');
  });
  it('rótulos de ordenação acompanham a categoria', () => {
    assert.equal(forecastSortLabels('devices').sold, 'Mais aparelhos vendidos');
    assert.equal(forecastSortLabels('accessories').sold, 'Mais acessórios vendidos');
    assert.equal(forecastSortLabels('accessories').projection, 'Maior projeção');
    assert.equal(UNIT_COPY.accessories.abbr, 'ac');
  });
  it('ranking de acessórios ordena por acessórios (não pelos aparelhos)', () => {
    const rows = [
      mk('x', 'iphone', { amount: 4000, quantity: 30 }), mk('x', 'pel', { amount: 70, quantity: 2 }),
      mk('y', 'iphone', { amount: 4000, quantity: 1 }), mk('y', 'pel', { amount: 70, quantity: 9 }),
    ];
    const acc = countUnitsBySeller(rows, nm, oct, 'accessories');
    const list = ['x', 'y'].map((id) => ({ ...buildSellerRow(id, acc.get(id), null, oct), name: id }));
    assert.deepEqual(sortUnitRows(list, 'sold').map((r) => r.name), ['y', 'x']);
    const dev = countUnitsBySeller(rows, nm, oct, 'devices');
    const listDev = ['x', 'y'].map((id) => ({ ...buildSellerRow(id, dev.get(id), null, oct), name: id }));
    assert.deepEqual(sortUnitRows(listDev, 'sold').map((r) => r.name), ['x', 'y']);
  });
  it('aparelhos continuam idênticos ao comportamento anterior', () => {
    const rows = [mk('a', 'iphone', { amount: 4000, quantity: 3 }), mk('a', 'watch', { amount: 2500 })];
    assert.deepEqual(countDevicesBySeller(rows, nm, oct), countUnitsBySeller(rows, nm, oct, 'devices'));
    assert.equal(countDevicesBySeller(rows, nm, oct).get('a')?.sold, 3);
  });
});
