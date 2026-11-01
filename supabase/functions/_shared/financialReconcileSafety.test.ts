/**
 * Proteções da conciliação (auditoria de 31/10/2026): valores já conciliados, troca de modelo,
 * correspondência insegura, duplicatas, pedidos ausentes e orçamentos. Casos baseados em pedidos
 * reais (valores reduzidos ao necessário).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planFinancialReconcile, type HistoricoFinanceItem, type SaleFinanceRow } from './financialReconcile.ts';

const NOW = new Date('2026-10-31T18:00:00Z');
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
  created_at: '2026-10-07T15:00:00Z',
  item_status: 'active',
  financial_status: 'pending',
  ...o,
});
const apply = (sales: SaleFinanceRow[], plan: ReturnType<typeof planFinancialReconcile>) =>
  sales.map((s) => ({ ...s, ...(plan.updates.find((u) => u.id === s.id)?.patch ?? {}) }));
const plan = (h: HistoricoFinanceItem[], s: SaleFinanceRow[]) => planFinancialReconcile(h, s, { now: NOW });

describe('valores já conciliados (brindes FONE/CARREGADOR BND)', () => {
  const brinde = (cost: number) =>
    hist({ vendaId: 8389868, produtoId: 149456, tipoProdutoDescricao: 'BRINDES', valorCusto: cost, lucro: -cost, produtoDescricao: 'BRINDES - CARREGADOR COMPLETO - BND' });

  it('custo mudou na origem 24 dias depois: mantém o gravado e gera alerta SEM evidência (conciliado 11 dias após a venda)', () => {
    const r = row('8389868-149456-1', { revenue: 0, cost: 10, profit: -10, financial_status: 'ok', financial_synced_at: '2026-10-18T16:04:10Z' });
    const p = plan([brinde(13)], [r]);
    const after = apply([r], p)[0];
    assert.equal(after.cost, 10);
    assert.equal(after.profit, -10);
    assert.equal(p.counts.rows_protected, 1);
    assert.equal(p.alerts.length, 1);
    assert.equal(p.alerts[0].kind, 'retroactive_change');
    assert.equal(p.alerts[0].hasEvidence, false);
    assert.equal((p.alerts[0].proposed as { cost: number }).cost, 13);
  });

  it('com evidência (conciliado no dia da venda): mantém o custo da época e registra como mantido', () => {
    const r = row('8389868-149456-1', { revenue: 0, cost: 10, profit: -10, financial_status: 'ok', financial_synced_at: '2026-10-07T18:00:00Z' });
    const p = plan([brinde(13)], [r]);
    assert.equal(apply([r], p)[0].cost, 10);
    assert.equal(p.alerts[0].hasEvidence, true);
    assert.match(p.alerts[0].detail, /mantido o valor registrado logo após a venda/);
  });

  it('dentro do prazo (venda lançada há menos de 3 dias) a origem ainda corrige o custo sozinha', () => {
    const r = row('8389868-149456-1', { created_at: '2026-10-30T12:00:00Z', revenue: 0, cost: 10, profit: -10, financial_status: 'ok' });
    const p = plan([brinde(13)], [r]);
    assert.equal(apply([r], p)[0].cost, 13);
    assert.equal(p.alerts.length, 0);
  });

  it('custo zero ou desconhecido pode ser preenchido mesmo depois do prazo (iPhone com custo 0)', () => {
    const r = row('7643517-1-0', { amount: 2500, revenue: 2500, cost: 0, profit: 2500, financial_status: 'ok' });
    const p = plan([hist({ vendaId: 7643517, produtoId: 1, valorTotal: 2500, valorCliente: 2500, valorCusto: 1800, lucro: 700 })], [r]);
    const after = apply([r], p)[0];
    assert.equal(after.cost, 1800);
    assert.equal(after.profit, 700);
    assert.equal(p.alerts.length, 0);
  });

  it('não rebaixa linha conciliada quando a origem passa a não informar custo', () => {
    const r = row('8389868-149456-1', { revenue: 0, cost: 10, profit: -10, financial_status: 'ok' });
    const p = plan([{ ...brinde(13), valorCusto: null, lucro: null }], [r]);
    const after = apply([r], p)[0];
    assert.equal(after.financial_status, 'ok');
    assert.equal(after.cost, 10);
    assert.equal(p.alerts[0].kind, 'retroactive_change');
  });

  it('cancelamento na origem ainda vale para linha conciliada (situação do item, não valor)', () => {
    const r = row('6632287-199369-0', { amount: 2750, revenue: 2750, cost: 2000, profit: 750, financial_status: 'ok' });
    const p = plan([hist({ vendaId: 6632287, produtoId: 199369, valorTotal: 2750, valorCliente: 2750, valorCusto: 2000, lucro: 750, statusVenda: 'cancelada' })], [r]);
    assert.equal(apply([r], p)[0].item_status, 'cancelled');
  });
});

describe('pedido ausente na consulta', () => {
  it('linha conciliada não vira not_found; pendente sim', () => {
    const ok = row('999-1-0', { revenue: 100, cost: 60, profit: 40, financial_status: 'ok' });
    const pending = row('998-1-0');
    const p = plan([], [ok, pending]);
    const [a, b] = apply([ok, pending], p);
    assert.equal(a.financial_status, 'ok');
    assert.equal(b.financial_status, 'not_found');
  });
});

describe('troca de unidade e de modelo', () => {
  const pm = (produtoId: number, o: Partial<HistoricoFinanceItem> = {}) =>
    hist({ vendaId: 8560417, produtoId, tipoProdutoDescricao: 'PRODUTO APPLE', valorTotal: 8800, valorCliente: 8800, valorCusto: 8150, lucro: 650, produtoDescricao: 'PRODUTO APPLE - IPHONE 17 PRO MAX - IMEI: 1 - 512GB', ...o });

  it('caso 8560417: Pro Max trocado por 17 Pro (outro modelo) — linha segue ativa com os valores atuais, alerta, sem duplicar nem apagar receita', () => {
    const history = [pm(11626753), pm(11626843), pm(11765762, { produtoDescricao: 'PRODUTO APPLE - IPHONE 17 PRO - IMEI: 3 - 256GB', valorCusto: 8400, lucro: 400 })];
    const sales = [
      row('8560417-11626753-4', { amount: 8800, revenue: 8800, cost: 8150, profit: 650, financial_status: 'ok', product_name: 'IPHONE 17 PRO MAX - 512GB - AZUL' }),
      row('8560417-11626804-5', { amount: 8800, revenue: 8800, cost: 8150, profit: 650, financial_status: 'ok', product_name: 'IPHONE 17 PRO MAX' }),
      row('8560417-11626843-6', { amount: 8800, revenue: 8800, cost: 8150, profit: 650, financial_status: 'ok', product_name: 'IPHONE 17 PRO MAX - 512GB - AZUL' }),
    ];
    const p = plan(history, sales);
    const after = apply(sales, p);
    assert.equal(after.filter((r) => r.item_status === 'active').length, 3, 'nenhuma linha removida');
    assert.equal(after.reduce((a, r) => a + Number(r.revenue), 0), 26400, 'receita intacta');
    assert.equal(p.counts.rows_removed, 0);
    const swap = p.alerts.filter((a) => a.kind === 'model_swap');
    assert.equal(swap.length, 1);
    assert.equal(swap[0].externalId, '8560417-11626804-5');
    assert.equal((swap[0].proposed as { cost: number }).cost, 8400);
    assert.equal(p.alerts.filter((a) => a.kind === 'history_without_row').length, 0, 'o item novo não gera alerta em dobro');
  });

  it('mesmo modelo continua trocado automaticamente com os valores da unidade nova', () => {
    const history = [hist({ vendaId: 7967659, produtoId: 11464075, tipoProdutoDescricao: 'PRODUTO APPLE', valorTotal: 3700, valorCliente: 3700, valorCusto: 1209.1, lucro: 2490.9, produtoDescricao: 'PRODUTO APPLE - IPHONE 14 PRO MAX - IMEI: 9' })];
    const r = row('7967659-11000689-3', { amount: 3700, product_name: 'IPHONE 14 PRO MAX - 128GB - ROXO' });
    const p = plan(history, [r]);
    const after = apply([r], p)[0];
    assert.equal(after.item_status, 'active');
    assert.equal(after.cost, 1209.1);
    assert.equal(p.counts.rows_swapped, 1);
    assert.equal(p.alerts.length, 0);
  });

  it('sem par único (2 linhas saíram, 2 itens novos de outro modelo): nada é apagado nem trocado, tudo vira alerta', () => {
    const history = [
      hist({ vendaId: 1, produtoId: 30, produtoDescricao: 'PRODUTO APPLE - IPHONE 15', valorTotal: 4000, valorCliente: 4000, valorCusto: 3000 }),
      hist({ vendaId: 1, produtoId: 31, produtoDescricao: 'PRODUTO APPLE - IPHONE 16', valorTotal: 5000, valorCliente: 5000, valorCusto: 4000 }),
    ];
    const sales = [
      row('1-10-0', { amount: 4000, revenue: 4000, cost: 2900, financial_status: 'ok', product_name: 'IPHONE 13' }),
      row('1-11-1', { amount: 5000, revenue: 5000, cost: 3900, financial_status: 'ok', product_name: 'IPHONE 14' }),
    ];
    const p = plan(history, sales);
    const after = apply(sales, p);
    assert.deepEqual(after.map((r) => [r.item_status, r.cost]), [['active', 2900], ['active', 3900]]);
    assert.equal(p.alerts.filter((a) => a.kind === 'unsafe_match').length, 2);
  });

  it('produto retirado do pedido sem substituto continua sendo removido', () => {
    const history = [hist({ vendaId: 2, produtoId: 20, valorTotal: 50, valorCliente: 50, valorCusto: 20 })];
    const sales = [row('2-20-0', { amount: 50 }), row('2-21-1', { amount: 30, product_name: 'CAPA' })];
    const after = apply(sales, plan(history, sales));
    assert.equal(after[1].item_status, 'removed');
    assert.equal(after[0].item_status, 'active');
  });

  it('duplicata por edição do pedido (mesmo produto, índice novo) continua colapsando: uma ativa, uma removida', () => {
    const history = [hist({ vendaId: 8729204, produtoId: 5, valorTotal: 120, valorCliente: 120, valorCusto: 50, lucro: 70 })];
    const sales = [
      row('8729204-5-0', { amount: 120, created_at: '2026-10-20T10:00:00Z' }),
      row('8729204-5-3', { amount: 120, created_at: '2026-10-21T10:00:00Z' }),
    ];
    const after = apply(sales, plan(history, sales));
    assert.deepEqual(after.map((r) => r.item_status).sort(), ['active', 'removed']);
    assert.equal(after.filter((r) => r.item_status === 'active').reduce((a, r) => a + Number(r.revenue), 0), 120, 'receita não dobra');
  });
});

describe('pedidos e itens do MercadoPhone sem linha no painel', () => {
  it('orçamento não é lacuna; venda concluída sem linhas vira alerta order_missing', () => {
    const history = [
      hist({ vendaId: 8778897, produtoId: 1, statusVenda: 'orcamento', valorTotal: 7460 }),
      hist({ vendaId: 8800000, produtoId: 2, valorTotal: 300, dataVenda: '2026-10-30 10:00:00' } as HistoricoFinanceItem),
    ];
    const p = plan(history, []);
    assert.equal(p.counts.history_orders_without_rows, 1);
    assert.equal(p.alerts.length, 1);
    assert.equal(p.alerts[0].kind, 'order_missing');
    assert.equal(p.alerts[0].orderId, '8800000');
  });

  it('item a mais no histórico sem linha sobrando vira alerta history_without_row', () => {
    const history = [hist({ vendaId: 3, produtoId: 7, valorTotal: 40, valorCliente: 40 }), hist({ vendaId: 3, produtoId: 8, valorTotal: 60, valorCliente: 60 })];
    const sales = [row('3-7-0', { amount: 40 })];
    const p = plan(history, sales);
    assert.equal(p.alerts.length, 1);
    assert.equal(p.alerts[0].kind, 'history_without_row');
  });
});

describe('idempotência', () => {
  it('segunda conferência não grava nada e repete as mesmas chaves de alerta', () => {
    const history = [
      hist({ vendaId: 8389868, produtoId: 149456, tipoProdutoDescricao: 'BRINDES', valorCusto: 13, lucro: -13 }),
      hist({ vendaId: 5, produtoId: 50, valorTotal: 100, valorCliente: 100, valorCusto: 60, lucro: 40 }),
    ];
    const sales = [
      row('8389868-149456-1', { revenue: 0, cost: 10, profit: -10, financial_status: 'ok', financial_synced_at: '2026-10-18T16:04:10Z' }),
      row('5-50-0', { amount: 100 }),
    ];
    const first = plan(history, sales);
    const after = apply(sales, first);
    const second = plan(history, after);
    assert.equal(second.updates.length, 0);
    assert.deepEqual(second.alerts.map((a) => a.dedupeKey), first.alerts.map((a) => a.dedupeKey));
  });
});

describe('regressões da auditoria (agente auditor, 31/10)', () => {
  it('D1: linhas já removidas nunca são reativadas por item novo sem linha (receita não multiplica)', () => {
    const history = [hist({ vendaId: 7, produtoId: 1, valorTotal: 100, valorCliente: 100, valorCusto: 50 }), hist({ vendaId: 7, produtoId: 9, valorTotal: 300, valorCliente: 300, valorCusto: 200, produtoDescricao: 'ACESSORIOS - CAIXA DE SOM' })];
    const sales = [
      row('7-1-0', { amount: 100, revenue: 100, cost: 50, financial_status: 'ok' }),
      row('7-2-1', { amount: 100, revenue: 100, cost: 50, financial_status: 'ok', item_status: 'removed', product_name: 'FONE' }),
      row('7-3-2', { amount: 100, revenue: 100, cost: 50, financial_status: 'ok', item_status: 'removed', product_name: 'CAPA' }),
      row('7-4-3', { amount: 100, revenue: 100, cost: 50, financial_status: 'ok', item_status: 'removed', product_name: 'PELICULA' }),
    ];
    const p = plan(history, sales);
    const after = apply(sales, p);
    assert.deepEqual(after.map((r) => r.item_status), ['active', 'removed', 'removed', 'removed']);
    assert.equal(after.filter((r) => r.item_status === 'active').reduce((a, r) => a + Number(r.revenue), 0), 100);
    assert.equal(p.alerts.filter((a) => a.kind === 'unsafe_match' || a.kind === 'model_swap').length, 0);
    assert.equal(p.alerts.filter((a) => a.kind === 'history_without_row').length, 1, 'o item novo vira alerta de item faltando');
  });

  it('D1: uma linha removida + item novo de OUTRO modelo continua removida', () => {
    const history = [hist({ vendaId: 8, produtoId: 9, valorTotal: 300, valorCliente: 300, produtoDescricao: 'PRODUTO APPLE - IPHONE 16' })];
    const r = row('8-2-1', { amount: 300, revenue: 300, cost: 200, financial_status: 'ok', item_status: 'removed', product_name: 'IPHONE 13' });
    const p = plan(history, [r]);
    assert.equal(apply([r], p)[0].item_status, 'removed');
  });

  it('D3: receita/custo gravados também ficam protegidos em linha divergente (mismatch) ou pendente', () => {
    const mis = row('9-1-0', { amount: 100, revenue: 100, cost: 60, profit: 40, profit_reported: 30, financial_status: 'mismatch' });
    const pen = row('9-2-1', { amount: 100, revenue: null, cost: 60, financial_status: 'pending' });
    const history = [hist({ vendaId: 9, produtoId: 1, valorTotal: 100, valorCliente: 100, valorCusto: 90, lucro: 10 }), hist({ vendaId: 9, produtoId: 2, valorTotal: 100, valorCliente: 100, valorCusto: 95, lucro: 5 })];
    const p = plan(history, [mis, pen]);
    const [a, b] = apply([mis, pen], p);
    assert.equal(a.cost, 60);
    assert.equal(b.cost, 60);
    assert.equal(p.alerts.filter((x) => x.kind === 'retroactive_change').length, 2);
  });

  it('D6: cancelamento com valores zerados na origem cancela sem alerta', () => {
    const r = row('10-1-0', { amount: 2750, revenue: 2750, cost: 2000, profit: 750, financial_status: 'ok' });
    const p = plan([hist({ vendaId: 10, produtoId: 1, valorTotal: 0, valorCliente: 0, valorCusto: 0, lucro: 0, statusVenda: 'cancelada' })], [r]);
    assert.equal(apply([r], p)[0].item_status, 'cancelled');
    assert.equal(p.alerts.length, 0);
  });

  it('D7: custo zero só é preenchido se a receita gravada não mudar; senão vira alerta', () => {
    const r = row('11-1-0', { amount: 2500, revenue: 2500, cost: 0, profit: 2500, financial_status: 'ok' });
    const p = plan([hist({ vendaId: 11, produtoId: 1, valorTotal: 2300, valorCliente: 2500, valorCusto: 1800, lucro: 500 })], [r]);
    const after = apply([r], p)[0];
    assert.equal(after.revenue, 2500);
    assert.equal(after.cost, 0);
    assert.equal(p.alerts[0].kind, 'retroactive_change');
  });
});
