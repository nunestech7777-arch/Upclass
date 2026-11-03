// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardLinks, readSalesLinkFilters } from './cardLinks.ts';

test('Vendas: filtros do card viram parâmetros que a tela Vendas lê de volta', () => {
  const url = cardLinks.sales({ categoria: 'Aparelhos', vendedor: 'v1' });
  assert.equal(url, '/vendas?categoria=Aparelhos&vendedor=v1');
  const back = readSalesLinkFilters(url.slice(url.indexOf('?')));
  assert.deepEqual(back, { categoria: 'Aparelhos', produto: undefined, busca: undefined, vendedor: 'v1' });
});

test('Vendas: produto, busca com acento/espaço e período do card (dia escolhido) vão juntos', () => {
  const url = cardLinks.sales({ busca: 'PELÍCULA CERAMICA', categoria: 'Acessórios', period: { from: '2026-10-20', to: '2026-10-20' } });
  const p = new URLSearchParams(url.slice(url.indexOf('?')));
  assert.equal(p.get('busca'), 'PELÍCULA CERAMICA');
  assert.equal(p.get('periodo'), 'custom');
  assert.equal(p.get('de'), '2026-10-20');
  assert.equal(p.get('ate'), '2026-10-20');
  assert.equal(readSalesLinkFilters(url.slice(url.indexOf('?'))).busca, 'PELÍCULA CERAMICA');
});

test('Vendas: sem filtros a URL fica limpa; categoria desconhecida é ignorada', () => {
  assert.equal(cardLinks.sales(), '/vendas');
  assert.equal(readSalesLinkFilters('?categoria=Brindes').categoria, undefined);
  assert.deepEqual(readSalesLinkFilters(''), { categoria: undefined, produto: undefined, busca: undefined, vendedor: undefined });
});

test('Metas: cada card leva à seção correspondente', () => {
  assert.equal(cardLinks.goals('meta-semanal'), '/metas#meta-semanal');
  assert.equal(cardLinks.goals('meta-mensal'), '/metas#meta-mensal');
  assert.equal(cardLinks.goals('metas-lucro'), '/metas#metas-lucro');
});

test('Meu Supervisor: mantém os filtros atuais (vendedor, canal) e acrescenta o status', () => {
  assert.equal(cardLinks.supervisor('conversas', 'vendedor=abc&canal=whatsapp'), '/supervisor/conversas?vendedor=abc&canal=whatsapp');
  assert.equal(cardLinks.supervisor('conversas', '', { status: 'nao_atendida' }), '/supervisor/conversas?status=nao_atendida');
  assert.equal(cardLinks.supervisor('conversas', 'canal=whatsapp', { pendente: 'nunca_atendida' }), '/supervisor/conversas?canal=whatsapp&pendente=nunca_atendida');
  assert.equal(cardLinks.supervisor('analise-ia'), '/supervisor/analise-ia');
  assert.equal(cardLinks.supervisor('conversas', 'canal=whatsapp&pendente=automatica&status=atendida'), '/supervisor/conversas?canal=whatsapp', 'filtros da lista não vazam');
});

test('Outros destinos: relatório do vendedor, ranking de conversão e resultado diário', () => {
  assert.equal(cardLinks.seller('s1'), '/vendedores/s1');
  assert.equal(cardLinks.conversionRanking(), '/#ranking-conversao');
  assert.equal(cardLinks.daily(), '/resultados-diarios');
  assert.equal(cardLinks.daily('2026-10-20'), '/resultados-diarios?dia=2026-10-20');
});
