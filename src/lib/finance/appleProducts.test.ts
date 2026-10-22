import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appleTypeFromName, classifyAppleLine, isOtherBrandPhone } from './appleProducts.ts';
import { buildContext } from './calc.ts';
import { appleReviewItems, measureAppleBySeller, measureBySeller, accessoryAttendancesBySeller, type UnitSale } from './forecast.ts';

// Nomes reais vendidos (Mercado Phone, jul–out/2026).
const paid = (amount: number, product_type: string | null = null) => ({ quantity: 1, amount, product_type });
const cls = (name: string, amount = 5000, type: string | null = null) => classifyAppleLine(name, paid(amount, type));

describe('classificação automática de produtos Apple', () => {
  it('iPhones (regra oficial: nome começa com iPhone)', () => {
    assert.equal(appleTypeFromName('IPHONE 15 - 128GB - BLACK'), 'iPhone');
    assert.equal(appleTypeFromName('iPhone 17 Pro Max'), 'iPhone');
    assert.equal(appleTypeFromName('  IPHONE 13'), 'iPhone');
  });

  it('MacBooks (Air, Pro, Neo; "MAC BOOK" com espaço)', () => {
    for (const n of ['MACBOOK AIR M5 - 512GB - SILVER - APPLE', 'MAC BOOK AIR M1 - BRANCO', 'MACBOOK NEO - 256 GB - CÍTRICO', 'MacBook Pro M4 14']) {
      assert.deepEqual(cls(n), { kind: 'apple', type: 'MacBook' }, n);
    }
  });

  it('iPads (iPad, iPad Air, iPad Pro)', () => {
    for (const n of ['IPAD 11 - 128 GB - SILVER', 'IPAD AIR M3 - 128 GB - ROXO', 'iPad Pro M4 11']) assert.deepEqual(cls(n, 3500), { kind: 'apple', type: 'iPad' }, n);
  });

  it('Apple Watch (com e sem "Apple" no início)', () => {
    for (const n of ['APPLE WATCH SE 3 GPS - 40MM - MIDNIGHT', 'WATCH S11 APPLE - 42Mm - BLACK', 'WATCH ULTRA 3 - 49MM - PRETO', 'APPLE WATCH ULTRA 2 - PRETO']) {
      assert.deepEqual(cls(n, 3000), { kind: 'apple', type: 'Apple Watch' }, n);
    }
  });

  it('AirPods originais', () => {
    assert.deepEqual(cls('AIRPODS PRO 3  - . - BRANCO', 2316), { kind: 'apple', type: 'AirPods' });
  });

  it('iMac, Mac mini e outros Apple identificados com segurança', () => {
    assert.deepEqual(cls('MAC MINI M4 - 256 GB - BRANCO', 4600), { kind: 'apple', type: 'Mac mini' });
    assert.deepEqual(cls('IMAC 24 M4', 12000), { kind: 'apple', type: 'iMac' });
    assert.deepEqual(cls('APPLE PENCIL PRO - . - BRANCO', 1350), { kind: 'apple', type: 'Outros Apple' });
    assert.deepEqual(cls('AIRTAG', 250), { kind: 'apple', type: 'Outros Apple' });
  });

  it('nomes semelhantes: "Apple" sozinho não classifica; relógios genéricos não são Apple Watch', () => {
    assert.deepEqual(cls('CABO ORIGINAL APPLE', 250), { kind: 'other' });
    assert.deepEqual(cls('FONTE USB-C APPLE 20W', 160), { kind: 'other' });
    assert.deepEqual(cls('SMART WATCH PREMIUM ULTRA', 200), { kind: 'other' });
    assert.deepEqual(cls('RELOGIO ULTRA SMART WATCH', 350), { kind: 'other' });
    assert.deepEqual(cls('SMARTWATCH PRIMEIRA LINHA', 300), { kind: 'other' });
    assert.deepEqual(cls('WATCH D20 PRETO', 150), { kind: 'other' });
  });

  it('acessórios compatíveis com Apple não são produtos Apple', () => {
    for (const n of ['CAPA IPAD', 'PELICULA IPAD', 'PELÍCULA IPAD 10 2022 - . - .', 'CAPA VOCE DE IPHONE', 'CAIXA DE IPHONE', 'PULSEIRA APPLE WATCH 45MM', 'AIRPODS CASE SILICONE', 'IPAD CAPA COM TECLADO']) {
      assert.equal(appleTypeFromName(n), null, n);
    }
  });

  it('réplicas e valores incompatíveis vão para revisão, sem classificar', () => {
    assert.deepEqual(cls('AIRPODS PRO 1 LINHA', 250), { kind: 'review', reason: 'replica', type: 'AirPods' });
    assert.deepEqual(cls('AIRPODS MAX VOLTS', 250), { kind: 'review', reason: 'replica', type: 'AirPods' });
    assert.deepEqual(cls('MACBOOK AIR M2', 900), { kind: 'review', reason: 'replica', type: 'MacBook' });
  });

  it('tipo do Mercado Phone: confirma, conflita ou sinaliza nome não reconhecido', () => {
    assert.deepEqual(cls('MACBOOK AIR M5 - 512GB - MIDNIGHT', 10885.56, 'PRODUTO APPLE'), { kind: 'apple', type: 'MacBook' });
    assert.deepEqual(cls('APPLE WATCH SE 40MM', 2500, 'ACESSORIOS'), { kind: 'review', reason: 'type_conflict', type: 'Apple Watch' });
    assert.deepEqual(cls('VISAO PRO HEADSET', 20000, 'PRODUTO APPLE'), { kind: 'review', reason: 'unrecognized_apple', type: null });
  });

  it('produto Apple com palavra de acessório vai para revisão (não some nem é contado)', () => {
    assert.deepEqual(cls('APPLE WATCH SERIES 10 CAIXA ALUMINIO 46MM', 3500), { kind: 'apple', type: 'Apple Watch' }); // nome oficial
    assert.deepEqual(cls('APPLE WATCH S10 46MM CASE DE TITANIO', 6000), { kind: 'apple', type: 'Apple Watch' });
    assert.deepEqual(cls('APPLE WATCH CAIXA ORGANIZADORA', 90), { kind: 'review', reason: 'accessory_word', type: 'Apple Watch' });
    assert.deepEqual(cls('AIRPODS 4 COM ESTOJO DE RECARGA', 1200), { kind: 'review', reason: 'accessory_word', type: 'AirPods' });
    assert.deepEqual(cls('IPAD CAPA COM TECLADO', 300), { kind: 'review', reason: 'accessory_word', type: 'iPad' });
    // Acessório que não começa como produto Apple continua acessório.
    assert.deepEqual(cls('CAPA IPAD', 80), { kind: 'other' });
  });

  it('grafias e prefixos extras; réplicas PREMIUM/VOLTS; Outros Apple com valor mínimo', () => {
    assert.deepEqual(cls('MCBOOCK AIR M2 - 256 GB - PRETO', 5500), { kind: 'apple', type: 'MacBook' });
    assert.deepEqual(cls('APPLE AIRTAG', 300), { kind: 'apple', type: 'Outros Apple' });
    assert.deepEqual(cls('AIR PODS MAX PREMIUM', 400), { kind: 'review', reason: 'replica', type: 'AirPods' });
    assert.deepEqual(cls('AIRPODS PRO 2 VOLTS', 700), { kind: 'review', reason: 'replica', type: 'AirPods' });
    assert.deepEqual(cls('APPLE PENCIL 2', 150), { kind: 'review', reason: 'replica', type: 'Outros Apple' });
  });

  it('celulares de outras marcas são identificados (e não viram acessório no Forecast)', () => {
    assert.equal(isOtherBrandPhone('POCO X7 PRO - 256 GB - PRETO'), true);
    assert.equal(isOtherBrandPhone('REALMI C61 - 256 GB - CINZA'), true);
    assert.equal(isOtherBrandPhone('CAPA GALAXY A15'), false);
    assert.equal(isOtherBrandPhone('FONTE TURBO VOLTS 30W'), false);
    const names = new Map([['poco', 'POCO X7 - 256 GB - VERDE'], ['pel', 'PELICULA ZEUS']]);
    const ctx = buildContext('2026-10', '2026-10-14');
    const rows: UnitSale[] = [
      { seller_id: 'a', product_id: 'poco', sold_date: '2026-10-02', quantity: 1, amount: 1900 },
      { seller_id: 'a', product_id: 'pel', sold_date: '2026-10-02', quantity: 1, amount: 100 },
    ];
    assert.equal(measureBySeller(rows, names, ctx, 'accessories', 'units').get('a')!.sold, 1);
  });

  it('marcas não Apple com GB/TB não poluem a revisão', () => {
    assert.deepEqual(cls('CARTAO DE MEMORIA 64GB', 60), { kind: 'other' });
    assert.deepEqual(cls('GALAXY A15 128GB', 1200), { kind: 'other' });
    assert.deepEqual(cls('POCO X7 - 256 GB - VERDE', 1900), { kind: 'other' });
  });

  it('iPhones sem a palavra "iPhone" no nome são iPhone (modelo + capacidade)', () => {
    assert.deepEqual(cls('15 PLUS - 128 GB - BLACK', 4180), { kind: 'apple', type: 'iPhone' });
    assert.deepEqual(cls('CASE MAGSAFE 15 PRO MAX - 256 GB - NATURAL', 5980), { kind: 'apple', type: 'iPhone' });
  });

  it('aparelho com capacidade e sem tipo reconhecido vai para revisão', () => {
    assert.deepEqual(cls('APARELHO SEMINOVO - 128 GB', 2000), { kind: 'review', reason: 'unrecognized_device', type: null });
    assert.deepEqual(cls('PELICULA ZEUS', 100), { kind: 'other' });
  });
});

describe('Forecast: contagem de produtos Apple por vendedor e tipo', () => {
  const names = new Map([
    ['iphone', 'IPHONE 15 128GB'],
    ['macbook', 'MACBOOK AIR M4 - 256 GB - SILVER'],
    ['ipad', 'IPAD 11 - 128 GB - AZUL'],
    ['watch', 'APPLE WATCH SE 40MM - SILVER'],
    ['pelicula', 'PELICULA ZEUS'],
    ['airpods-replica', 'AIRPODS PRO 1 LINHA'],
    ['brinde-airpods', 'AIRPODS SEM FIO'],
  ]);
  const ctx = buildContext('2026-10', '2026-10-14');
  const ok = { financial_status: 'ok', profit: 0 } as const;
  const line = (seller: string, order: string, product: string, amount: number, extra: Partial<UnitSale> = {}): UnitSale => ({
    seller_id: seller,
    product_id: product,
    sold_date: '2026-10-05',
    quantity: 1,
    amount,
    revenue: amount,
    mp_order_id: order,
    ...ok,
    ...extra,
  });
  const sales: UnitSale[] = [
    // Venda 1: iPhone + MacBook + iPad da Caroline → 3 produtos Apple.
    line('caroline', '1', 'iphone', 4700),
    line('caroline', '1', 'macbook', 7300),
    line('caroline', '1', 'ipad', 3500),
    // Venda 2: vendedores diferentes — Graciane o Apple Watch, July a película.
    line('graciane', '2', 'watch', 2640),
    line('july', '2', 'pelicula', 100),
    // Réplica paga: revisão, continua em Acessórios.
    line('july', '3', 'airpods-replica', 250),
    // Cancelada e brinde não contam.
    line('caroline', '4', 'macbook', 7000, { item_status: 'cancelled' }),
    line('graciane', '5', 'brinde-airpods', 0),
  ];

  it('venda com iPhone + MacBook + iPad conta 1 em cada tipo (total 3)', () => {
    const m = measureAppleBySeller(sales, names, ctx, 'units').get('caroline')!;
    assert.deepEqual([...m.byType.entries()].map(([t, c]) => [t, c.sold]), [['iPhone', 1], ['MacBook', 1], ['iPad', 1]]);
    assert.equal(m.total.sold, 3);
  });

  it('faturamento por tipo e total, sem duplicar (cancelada fora)', () => {
    const m = measureAppleBySeller(sales, names, ctx, 'revenue');
    assert.equal(m.get('caroline')!.total.sold, 15500);
    assert.equal(m.get('graciane')!.total.sold, 2640);
    const all = [...m.values()].reduce((a, x) => a + x.total.sold, 0);
    assert.equal(all, 4700 + 7300 + 3500 + 2640);
  });

  it('vendedores diferentes na mesma venda: cada item no seu vendedor', () => {
    const m = measureAppleBySeller(sales, names, ctx, 'units');
    assert.equal(m.get('graciane')!.byType.get('Apple Watch')!.sold, 1);
    assert.equal(m.get('july'), undefined);
  });

  it('produto Apple reconhecido não conta em Acessórios; réplica (revisão) continua', () => {
    const acc = measureBySeller(sales, names, ctx, 'accessories', 'units');
    assert.equal(acc.get('caroline'), undefined); // MacBook e iPad saíram de Acessórios
    assert.equal(acc.get('graciane'), undefined); // Apple Watch saiu; brinde nunca contou
    assert.equal(acc.get('july')!.sold, 2); // película + réplica de AirPods
    // Atendimentos de acessórios (ticket/PA) seguem a mesma regra.
    assert.equal(accessoryAttendancesBySeller(sales, names).get('graciane'), undefined);
  });

  it('nenhum item em dois lugares: Apple + Acessórios + Aparelhos(iPhone) = linhas válidas', () => {
    const apple = [...measureAppleBySeller(sales, names, ctx, 'units').values()].reduce((a, m) => a + m.total.sold, 0);
    const acc = [...measureBySeller(sales, names, ctx, 'accessories', 'units').values()].reduce((a, c) => a + c.sold, 0);
    const iphones = [...measureBySeller(sales, names, ctx, 'devices', 'units').values()].reduce((a, c) => a + c.sold, 0);
    // 6 linhas pagas ativas; iPhone aparece em Aparelhos e também em Produtos Apple (é um tipo Apple).
    assert.equal(apple + acc - iphones, 6 - iphones);
    assert.equal(apple, 4);
    assert.equal(acc, 2);
  });

  it('lista de revisão: só itens pagos e ativos, agrupados por nome', () => {
    const items = appleReviewItems(sales, names);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'AIRPODS PRO 1 LINHA');
    assert.equal(items[0].reason, 'replica');
    assert.deepEqual(items[0].sellerIds, ['july']);
  });
});
