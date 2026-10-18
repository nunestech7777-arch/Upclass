import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planFinancialReconcile,
  financialFieldsFromHistory,
  type HistoricoFinanceItem,
  type SaleFinanceRow,
} from './financialReconcile.ts';

// Formatos reais do histórico (out/2026), com valores reduzidos ao necessário.
const hist = (o: Partial<HistoricoFinanceItem> & Pick<HistoricoFinanceItem, 'vendaId' | 'produtoId'>): HistoricoFinanceItem => ({
  quantidade: 1,
  valorTotal: 0,
  valorCliente: 0,
  valorCusto: 0,
  desconto: 0,
  lucro: 0,
  statusVenda: 'concluido',
  tipoProdutoDescricao: 'ACESSORIOS',
  clienteNome: 'CLIENTE TESTE',
  ...o,
});

let seq = 0;
const row = (externalId: string, o: Partial<SaleFinanceRow> = {}): SaleFinanceRow => ({
  id: `row-${++seq}`,
  external_id: externalId,
  quantity: 1,
  amount: 0,
  created_at: '2026-10-02T12:00:00Z',
  ...o,
});

const apply = (sales: SaleFinanceRow[], plan: ReturnType<typeof planFinancialReconcile>) =>
  sales.map((s) => ({ ...s, ...(plan.updates.find((u) => u.id === s.id)?.patch ?? {}) }));

describe('financialFieldsFromHistory', () => {
  it('usa valorTotal e valorCusto como totais da linha, sem multiplicar pela quantidade', () => {
    // 8564367: 2 películas, valorTotal 300 e custo 44,30 para a linha.
    const f = financialFieldsFromHistory(hist({ vendaId: 8564367, produtoId: 10672119, quantidade: 2, valorTotal: 300, valorCliente: 300, valorCusto: 44.3, lucro: 255.7 }));
    assert.equal(f.revenue, 300);
    assert.equal(f.cost, 44.3);
    assert.equal(f.profit, 255.7);
    assert.equal(f.financial_status, 'ok');
  });

  it('brinde com receita zero e custo positivo gera prejuízo', () => {
    const f = financialFieldsFromHistory(hist({ vendaId: 1, produtoId: 149566, valorCusto: 2.5, lucro: -2.5, tipoProdutoDescricao: 'BRINDES' }));
    assert.equal(f.profit, -2.5);
    assert.equal(f.financial_status, 'ok');
  });

  it('distingue custo zero informado de custo desconhecido', () => {
    const zero = financialFieldsFromHistory(hist({ vendaId: 1, produtoId: 2, valorTotal: 2350, valorCliente: 2350, valorCusto: 0, lucro: 2350 }));
    assert.equal(zero.cost, 0);
    assert.equal(zero.financial_status, 'ok');
    assert.match(zero.financial_note ?? '', /Custo zero/);

    const unknown = financialFieldsFromHistory(hist({ vendaId: 1, produtoId: 2, valorTotal: 2350, valorCusto: null, lucro: null }));
    assert.equal(unknown.cost, null);
    assert.equal(unknown.profit, null);
    assert.equal(unknown.financial_status, 'pending');
  });

  it('subtrai antes de arredondar (receita com muitas casas) e sinaliza divergência real', () => {
    const rounded = financialFieldsFromHistory(hist({ vendaId: 1, produtoId: 2, valorTotal: 1638.745, valorCusto: 1027.2, lucro: 611.54 }));
    assert.equal(rounded.financial_status, 'ok');

    const divergent = financialFieldsFromHistory(hist({ vendaId: 1, produtoId: 2, valorTotal: 100, valorCusto: 40, lucro: 50 }));
    assert.equal(divergent.financial_status, 'mismatch');
    assert.equal(divergent.profit, 60);
    assert.equal(divergent.profit_reported, 50);
  });
});

describe('planFinancialReconcile', () => {
  it('concilia quantidade > 1, prejuízo de brinde e é idempotente', () => {
    const history = [
      hist({ vendaId: 8176618, produtoId: 328416, quantidade: 2, valorTotal: 50, valorCliente: 50, valorCusto: 9.58, lucro: 40.42 }),
      hist({ vendaId: 8176618, produtoId: 149566, valorCusto: 2.5, lucro: -2.5, tipoProdutoDescricao: 'BRINDES' }),
    ];
    const sales = [row('8176618-328416-0', { quantity: 2, amount: 50 }), row('8176618-149566-1')];
    const plan = planFinancialReconcile(history, sales);
    assert.equal(plan.counts.rows_ok, 2);
    const after = apply(sales, plan);
    assert.equal(after[0].profit, 40.42);
    assert.equal(after[1].profit, -2.5);
    assert.equal(planFinancialReconcile(history, after).updates.length, 0, 'segunda execução não escreve nada');
  });

  it('marca como removida a duplicata criada por edição do pedido (caso real 8276018)', () => {
    const history = [hist({ vendaId: 8276018, produtoId: 11345536, valorTotal: 8760.4, valorCliente: 9680, valorCusto: 7900, lucro: 860.4, tipoProdutoDescricao: 'PRODUTO APPLE' })];
    const older = row('8276018-11345536-4', { amount: 9680, created_at: '2026-10-05T13:23:11Z' });
    const newer = row('8276018-11345536-3', { amount: 9680, created_at: '2026-10-07T13:54:23Z' });
    const plan = planFinancialReconcile(history, [older, newer]);
    const after = apply([older, newer], plan);
    assert.equal(after[0].item_status, 'removed');
    assert.equal(after[1].item_status, 'active');
    assert.equal(after[1].revenue, 8760.4);
    assert.equal(plan.counts.rows_removed, 1);
  });

  it('remove produto trocado no pedido somente quando o pedido está no histórico', () => {
    const history = [hist({ vendaId: 8275896, produtoId: 11375516, valorTotal: 2967.48, valorCliente: 3042, valorCusto: 2500, lucro: 467.48 })];
    const swapped = row('8275896-11107236-4', { amount: 3042 });
    const current = row('8275896-11375516-4', { amount: 3042 });
    const after = apply([swapped, current], planFinancialReconcile(history, [swapped, current]));
    assert.equal(after[0].item_status, 'removed');
    assert.equal(after[1].item_status, 'active');
  });

  it('pedido ausente do histórico não é removido nem cancelado — só sinalizado', () => {
    const sales = [row('999-1-0', { amount: 100 })];
    const plan = planFinancialReconcile([], sales);
    assert.deepEqual(plan.updates[0].patch, {
      financial_status: 'not_found',
      financial_note: 'Pedido não encontrado no histórico do MercadoPhone no período',
    });
    assert.equal(plan.counts.rows_removed, 0);
  });

  it('venda cancelada na origem cancela as linhas já importadas', () => {
    const history = [hist({ vendaId: 6632287, produtoId: 199369, valorTotal: 2750, valorCliente: 2750, valorCusto: 2000, lucro: 750, statusVenda: 'cancelada' })];
    const sales = [row('6632287-199369-0', { amount: 2750 })];
    const after = apply(sales, planFinancialReconcile(history, sales));
    assert.equal(after[0].item_status, 'cancelled');
    assert.equal(after[0].status_reason, 'Venda cancelada no MercadoPhone');
  });

  it('itens repetidos com valores diferentes e sem correspondência única ficam ambíguos', () => {
    const history = [
      hist({ vendaId: 1, produtoId: 5, valorTotal: 90, valorCliente: 100, valorCusto: 40, lucro: 50 }),
      hist({ vendaId: 1, produtoId: 5, valorTotal: 95, valorCliente: 100, valorCusto: 45, lucro: 50 }),
    ];
    const sales = [row('1-5-0', { amount: 100 }), row('1-5-1', { amount: 100 })];
    const plan = planFinancialReconcile(history, sales);
    assert.equal(plan.counts.rows_ambiguous, 2);
    assert.ok(plan.updates.every((u) => u.patch.revenue === undefined));
  });

  it('itens repetidos casam pelo valor pago quando ele os diferencia', () => {
    const history = [
      hist({ vendaId: 1, produtoId: 5, valorTotal: 90, valorCliente: 100, valorCusto: 40, lucro: 50 }),
      hist({ vendaId: 1, produtoId: 5, valorTotal: 180, valorCliente: 200, valorCusto: 80, lucro: 100 }),
    ];
    const sales = [row('1-5-0', { amount: 200 }), row('1-5-1', { amount: 100 })];
    const after = apply(sales, planFinancialReconcile(history, sales));
    assert.equal(after[0].profit, 100);
    assert.equal(after[1].profit, 50);
  });

  it('conta itens do histórico sem linha no painel, exceto vendas canceladas', () => {
    const history = [
      hist({ vendaId: 2, produtoId: 7, valorTotal: 10, valorCusto: 5, lucro: 5 }),
      hist({ vendaId: 3, produtoId: 8, valorTotal: 10, valorCusto: 5, lucro: 5, statusVenda: 'cancelada' }),
    ];
    const plan = planFinancialReconcile(history, []);
    assert.equal(plan.counts.history_orders_without_rows, 1);
  });
});
