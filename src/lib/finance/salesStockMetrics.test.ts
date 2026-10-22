import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSalesMetrics } from './salesMetrics.ts';
import { classifyStockItem, computeStockMetrics, filterStock, isControlItem, type StockItem } from './stockMetrics.ts';
import { cleanDescription, toStockItem, toStockItems } from '../../../supabase/functions/_shared/stockItems.ts';

// ---------------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------------
const names = new Map([
  ['ip17', 'IPHONE 17 PRO MAX - 256GB - SILVER'],
  ['ip17b', 'IPHONE 17 PRO MAX - 512GB - BLACK'],
  ['pel', 'PELÍCULA ZEUS'],
  ['bnd', 'CAPA TRANSPARENTE - BND'],
]);
const ok = { financial_status: 'ok' as const };
let n = 0;
const sale = (o: Record<string, unknown>) =>
  ({ id: `s${++n}`, seller_id: 'a', quantity: 1, sold_at: '2026-10-05T10:00:00', item_status: 'active', revenue: null, cost: null, profit: null, financial_status: 'pending', ...o }) as never;

describe('Vendas: 5 indicadores sobre as linhas filtradas', () => {
  const rows = [
    // Pedido 1: iPhone + 3 películas numa linha + brinde (custo 3, lucro −3)
    sale({ product_id: 'ip17', mp_order_id: '1', amount: 8000, revenue: 7500, cost: 6000, profit: 1500, ...ok }),
    sale({ product_id: 'pel', mp_order_id: '1', quantity: 3, amount: 300, revenue: 300, cost: 60, profit: 240, ...ok, seller_id: 'b' }),
    sale({ product_id: 'bnd', mp_order_id: '1', amount: 0, revenue: 0, cost: 3, profit: -3, ...ok }),
    // Pedido 2: outro iPhone 17 Pro Max (outra capacidade) ainda não conciliado
    sale({ product_id: 'ip17b', mp_order_id: '2', amount: 9000 }),
    // Cancelada não conta
    sale({ product_id: 'ip17', mp_order_id: '3', amount: 8000, revenue: 7500, cost: 6000, profit: 1500, ...ok, item_status: 'cancelled' }),
  ];
  const m = computeSalesMetrics(rows, names);

  it('quantidade soma unidades de cada item; brinde e cancelada fora', () => {
    assert.equal(m.devices, 2);
    assert.equal(m.accessories, 3);
    assert.equal(m.units, 5);
    assert.equal(m.gifts, 1);
    assert.equal(m.orders, 2);
  });

  it('ranking agrupa iPhones pelo modelo', () => {
    assert.equal(m.ranking[0].name, 'PELÍCULA ZEUS');
    assert.equal(m.ranking[0].units, 3);
    assert.equal(m.ranking[1].name, 'iPhone 17 Pro Max');
    assert.equal(m.ranking[1].units, 2);
    assert.equal(m.ranking[1].pendingItems, 1);
  });

  it('faturamento e lucro só de itens conciliados (brinde entra no lucro), pendente informado', () => {
    assert.equal(m.revenue, 7800);
    assert.equal(m.cost, 6063);
    assert.equal(m.profit, 1737);
    assert.equal(m.pendingItems, 1);
    assert.equal(m.pendingAmount, 9000);
    assert.equal(m.pendingPaidItems, 1);
  });

  it('lucro médio por venda: só vendas com todos os itens conciliados, venda com vários itens conta uma vez', () => {
    assert.equal(m.reconciledOrders.length, 1);
    assert.equal(m.pendingOrders, 1);
    assert.equal(m.avgProfitPerOrder, 1737);
    assert.deepEqual(m.reconciledOrders[0].sellerIds.sort(), ['a', 'b']);
  });

  it('sem vendas: indicadores vazios, média indisponível', () => {
    const e = computeSalesMetrics([], names);
    assert.equal(e.units, 0);
    assert.equal(e.avgProfitPerOrder, null);
    assert.equal(e.ranking.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Estoque
// ---------------------------------------------------------------------------
const api = (o: Record<string, unknown>) => ({ id: ++n, quantidade: 1, valorCusto: 0, valorVenda: 0, disponibilidade: 'Disponível para venda', produtoDisponibilidadeId: 1, snAcessorio: 0, snPeca: 0, snServico: 0, ...o });

describe('Estoque: normalização do Mercado Phone', () => {
  it('descrição sem id, IMEI, SN e estado', () => {
    assert.equal(
      cleanDescription('11677039 - IPHONE XR  - BLUE - 64GB -  Estado: SEMI NOVO UPG A -  IMEI: 357 -  IMEI 2: 358 -  SN: F71', 11677039),
      'IPHONE XR - BLUE - 64GB'
    );
    assert.equal(cleanDescription('328423 - PELÍCULA CERAMICA  - . - . -  Estado: .', 328423), 'PELÍCULA CERAMICA');
  });
  it('serviço e excluído ficam fora; laboratório é indisponível; custo/preço por unidade', () => {
    assert.equal(toStockItem(api({ snServico: 1, descricao: '1 - MAO DE OBRA' }) as never), null);
    assert.equal(toStockItems([api({ quantidade: 0, descricao: '2 - CAPA' }) as never]).length, 0);
    const lab = toStockItem(api({ descricao: '3 - IPHONE 13 - RED - 128GB', aparelhoDescricao: 'IPHONE 13', disponibilidade: 'Laboratório', produtoDisponibilidadeId: 2, valorCusto: 2000, valorVenda: 2800 }) as never)!;
    assert.equal(lab.available, false);
    assert.equal(lab.cost, 2000);
    assert.equal(lab.price, 2800);
    assert.equal(lab.name, 'IPHONE 13');
  });
});

const item = (o: Partial<StockItem>): StockItem => ({
  id: String(++n), name: '', description: '', model: null, color: null, storage: null, condition: null, battery: null, quantity: 1, cost: null, price: null,
  availability: 'Disponível para venda', available: true, mpType: null, isAccessory: false, isPart: false, entryDate: null, updatedAt: null, imei: null, ...o,
});

describe('Estoque: classificação e 5 indicadores', () => {
  const raw = [
    item({ description: 'IPHONE 17 PRO MAX - SILVER - 256GB', model: 'IPHONE 17 PRO MAX', quantity: 2, cost: 7000, price: 9000, mpType: 'PRODUTO APPLE' }),
    item({ description: 'IPHONE 17 PRO MAX - BLACK - 512GB', model: 'IPHONE 17 PRO MAX', quantity: 1, cost: 8000, price: 10500, mpType: 'PRODUTO APPLE' }),
    item({ description: 'MACBOOK AIR M4 - 256 GB - SILVER', model: 'MACBOOK AIR M4', quantity: 1, cost: 5000, price: 7300, mpType: 'PRODUTO APPLE' }),
    item({ description: 'IPHONE 13 - RED - 128GB', model: 'IPHONE 13', quantity: 1, cost: 0, price: 2800, available: false, availability: 'Laboratório' }),
    item({ description: 'CAPA IPAD', quantity: 10, cost: 20, price: 80, mpType: 'ACESSORIOS', isAccessory: true }),
    item({ description: 'PELICULA VIDRO 3D - BND', quantity: 100, cost: 2.5, price: 0, mpType: 'BRINDES', isAccessory: true }),
    item({ description: 'FONTE 1 LINHA', quantity: 5, cost: 10, price: 0, mpType: 'ACESSORIOS', isAccessory: true }),
    item({ description: 'TELA IPHONE 15 PRO', quantity: 2, cost: 300, price: 900, mpType: 'PEÇAS', isPart: true }),
    item({ description: 'PROTEÇÃO/SEGURO ADESAO', quantity: 999661, cost: 0, price: 0 }),
  ];
  const all = raw.filter((i) => !isControlItem(i)).map(classifyStockItem);
  const f = (o: Partial<Parameters<typeof filterStock>[1]>) => computeStockMetrics(filterStock(all, { category: 'all', appleType: 'all', status: 'available', search: '', ...o }));

  it('classifica com as regras do Forecast: capa de iPad é acessório, tela de iPhone é peça', () => {
    const by = new Map(all.map((i) => [i.description, i]));
    assert.equal(by.get('MACBOOK AIR M4 - 256 GB - SILVER')!.appleType, 'MacBook');
    assert.equal(by.get('CAPA IPAD')!.category, 'Acessórios');
    assert.equal(by.get('TELA IPHONE 15 PRO')!.category, 'Peças');
    assert.equal(by.get('PELICULA VIDRO 3D - BND')!.category, 'Brindes');
    assert.equal(all.length, 8); // seguro (quantidade "infinita") não é mercadoria
  });

  it('quantidade e ranking só com disponíveis; iPhones agrupados por modelo', () => {
    const m = f({});
    assert.equal(m.units, 2 + 1 + 1 + 10 + 100 + 5 + 2);
    assert.equal(f({ category: 'Produtos Apple' }).ranking[0].group, 'iPhone 17 Pro Max');
    assert.equal(f({ category: 'Produtos Apple' }).ranking[0].units, 3);
    assert.equal(f({ status: 'unavailable' }).units, 1);
  });

  it('filtro MacBook: os 5 indicadores só do MacBook', () => {
    const m = f({ category: 'Produtos Apple', appleType: 'MacBook' });
    assert.deepEqual([m.units, m.potential, m.cost, m.profit, m.ranking[0].group], [1, 7300, 5000, 2300, 'MACBOOK AIR M4']);
    assert.equal(m.complete, true);
  });

  it('valor potencial = Σ qtd × preço (brinde fora); sem preço sinalizado, nunca inventado', () => {
    const m = f({});
    assert.equal(m.potential, 2 * 9000 + 10500 + 7300 + 10 * 80 + 2 * 900);
    assert.deepEqual(m.missingPrice, { items: 1, units: 5 }); // FONTE 1 LINHA
  });

  it('custo total = Σ qtd × custo (inclui brindes); lucro potencial = valor − custo; parcial com lacunas', () => {
    const m = f({});
    const cost = 2 * 7000 + 8000 + 5000 + 10 * 20 + 100 * 2.5 + 5 * 10 + 2 * 300;
    assert.equal(m.cost, cost);
    assert.equal(m.profit, Math.round((m.potential - cost) * 100) / 100);
    assert.equal(m.complete, false);
    const lab = f({ status: 'unavailable' });
    assert.deepEqual(lab.missingCost, { items: 1, units: 1 }); // iPhone do laboratório sem custo
  });

  it('ranking geral ignora brindes; filtrando só brindes, eles aparecem', () => {
    assert.notEqual(f({}).ranking[0].category, 'Brindes');
    assert.equal(f({ category: 'Brindes' }).ranking[0].group, 'PELICULA VIDRO 3D');
  });

  it('busca por modelo restringe todos os indicadores', () => {
    const m = f({ search: '17 pro max' });
    assert.equal(m.units, 3);
    assert.equal(m.potential, 28500);
  });
});
