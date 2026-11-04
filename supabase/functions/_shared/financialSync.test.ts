/**
 * Rotina de conciliação contra um Supabase falso em memória: escolha dos dias (vendas lançadas com
 * atraso e data retroativa, pendências desde 01/09), falha isolada por dia, tentativas, alertas e a
 * consulta ao MercadoPhone (nova tentativa, resposta incompleta).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTEMPT_LOG_EVERY,
  PENDING_ALERT_ATTEMPTS,
  PENDING_REFRESH_COOLDOWN_MS,
  pickPendingDays,
  pickReconcileDays,
  reconcilePendingRange,
  refreshGate,
  runFinancialSync,
  withSyncStamp,
  type FetchHistory,
} from './financialSync.ts';
import type { HistoricoFinanceItem } from './financialReconcile.ts';
import { fetchHistoricoVendas, retryPolicy } from './mercadophone.ts';
import { fakeLockDb } from './financialLock.fake.ts';

type Row = Record<string, unknown>;

/** Supabase falso: só os operadores usados pela rotina. */
function fakeDb(sales: Row[]) {
  const writes: string[] = [];
  const tables: Record<string, Row[]> = { sales, financial_sync_runs: [], financial_reconcile_alerts: [], financial_reconcile_attempts: [] };
  let seq = 0;
  const query = (rows: () => Row[]) => {
    const filters: ((r: Row) => boolean)[] = [];
    const sorts: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
    let limit = Infinity;
    const run = (from = 0, to = Infinity) => {
      let out = rows().filter((r) => filters.every((f) => f(r)));
      for (const s of [...sorts].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[s.col] as string | null, y = b[s.col] as string | null;
          if (x == null || y == null) return x == null && y == null ? 0 : (x == null) === s.nullsFirst ? -1 : 1;
          return (x < y ? -1 : x > y ? 1 : 0) * (s.asc ? 1 : -1);
        });
      }
      return { data: out.slice(from, Math.min(to + 1, limit)).map((r) => ({ ...r, products: { name: (r.product_name as string) ?? null } })), error: null };
    };
    const q = {
      gte: (c: string, v: string) => (filters.push((r) => (r[c] as string) >= v), q),
      lte: (c: string, v: string) => (filters.push((r) => (r[c] as string) <= v), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      order: (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => (sorts.push({ col, asc: o.ascending ?? true, nullsFirst: o.nullsFirst ?? false }), q),
      limit: (n: number) => ((limit = n), q),
      range: async (a: number, b: number) => run(a, b),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  };
  return {
    tables,
    writes,
    from(table: string) {
      const rows = (tables[table] ??= []);
      return {
        select: () => query(() => rows),
        insert(input: Row | Row[]) {
          const list = (Array.isArray(input) ? input : [input]).map((r) => ({ id: `${table}-${++seq}`, ...r }));
          rows.push(...list);
          const res = { error: null, data: list };
          return Object.assign(Promise.resolve(res), { select: () => ({ single: async () => ({ data: list[0], error: null }) }) });
        },
        async upsert(input: Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) {
          for (const r of input) if (!rows.some((x) => x[opts.onConflict] === r[opts.onConflict])) rows.push({ id: `${table}-${++seq}`, ...r });
          return { error: null };
        },
        update(patch: Row) {
          writes.push(table);
          return {
            eq: async (c: string, v: unknown) => { for (const r of rows) if (r[c] === v) Object.assign(r, patch); return { error: null }; },
            in: async (c: string, v: unknown[]) => { for (const r of rows) if (v.includes(r[c])) Object.assign(r, patch); return { error: null }; },
          };
        },
      };
    },
  };
}

const item = (o: Partial<HistoricoFinanceItem> & { vendaId: number; produtoId: number; dataVenda: string }): HistoricoFinanceItem & { dataVenda: string } => ({
  quantidade: 1, valorTotal: 70, valorCliente: 70, valorCusto: 64.9, desconto: 0, lucro: 5.1, statusVenda: 'concluido', tipoProdutoDescricao: 'ACESSORIOS', ...o,
});
const history = (items: (HistoricoFinanceItem & { dataVenda: string })[], failOn: string[] = []): FetchHistory =>
  async (a, b) => {
    // Falha que não é da API (ex.: banco lento): o dia falha e os outros seguem.
    if (failOn.some((d) => a.startsWith(d))) throw new Error('listar vendas 2026-10-20..2026-10-20: Gateway Timeout');
    return items.filter((i) => i.dataVenda >= a && i.dataVenda <= b);
  };
let n = 0;
const sale = (externalId: string, o: Row = {}): Row => ({
  id: `s${++n}`, external_id: externalId, quantity: 1, amount: 70, item_status: 'active', financial_status: 'pending',
  financial_check_attempts: 0, financial_checked_at: null, created_at: '2026-10-26T22:25:10Z', ...o,
});

describe('pickReconcileDays — lançamentos retroativos e pendências', () => {
  it('inclui a data informada de uma venda lançada há poucos dias com data retroativa (caso 8734927)', async () => {
    const db = fakeDb([sale('8734927-7936124-0', { sold_date: '2026-10-20', created_at: '2026-10-26T22:25:10Z' })]);
    const days = await pickReconcileDays(db, { now: new Date('2026-10-27T12:00:00Z') });
    assert.ok(days.includes('2026-10-20'));
    assert.deepEqual(days.slice(0, 4), ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('pendência antiga (desde 01/09) entra mesmo depois que a venda deixou de ser recente', async () => {
    const db = fakeDb([sale('8734927-7936124-0', { sold_date: '2026-10-20', created_at: '2026-10-26T22:25:10Z' })]);
    const days = await pickReconcileDays(db, { now: new Date('2026-10-31T18:00:00Z') });
    assert.ok(days.includes('2026-10-20'));
  });

  it('nunca inclui dias anteriores a 01/09/2026 (meses antigos só com aprovação)', async () => {
    const db = fakeDb([sale('7513250-1-0', { sold_date: '2026-08-31', created_at: '2026-09-01T02:11:57Z' })]);
    const days = await pickReconcileDays(db, { now: new Date('2026-10-31T18:00:00Z') });
    assert.ok(!days.includes('2026-08-31'));
  });

  it('limita o número de dias por execução e prioriza os nunca conferidos', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      sale(`${9000 + i}-1-0`, { sold_date: `2026-09-${String(i + 1).padStart(2, '0')}`, created_at: '2026-09-30T00:00:00Z', financial_checked_at: i < 10 ? '2026-10-30T00:00:00Z' : null })
    );
    const days = await pickReconcileDays(fakeDb(rows), { now: new Date('2026-10-31T18:00:00Z'), maxDays: 8 });
    assert.equal(days.length, 8);
    assert.deepEqual(days.slice(4), ['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
  });
});

describe('runFinancialSync com lista de dias (rotina de 30 min)', () => {
  it('concilia a venda retroativa, zera tentativas e registra a tentativa como reconciled', async () => {
    const db = fakeDb([sale('8734927-7936124-0', { sold_date: '2026-10-20' })]);
    const res = await runFinancialSync(db, history([item({ vendaId: 8734927, produtoId: 7936124, dataVenda: '2026-10-20 19:21:00' })]), {
      start: '2026-10-20', end: '2026-10-31', days: ['2026-10-31', '2026-10-20'], mode: 'apply', trigger: 'cron', now: new Date('2026-10-31T18:00:00Z'),
    });
    const s = db.tables.sales[0];
    assert.equal(s.financial_status, 'ok');
    assert.equal(s.cost, 64.9);
    assert.equal(s.financial_check_attempts, 0);
    assert.ok(s.financial_checked_at);
    assert.deepEqual(db.tables.financial_reconcile_attempts.map((a) => [a.mp_order_id, a.outcome, a.source]), [['8734927', 'reconciled', 'cron']]);
    assert.deepEqual(res.days_failed, []);
  });

  it('falha num dia (fora a queda da API) não impede os outros e fica registrada para os pedidos pendentes daquele dia', async () => {
    const db = fakeDb([
      sale('1-1-0', { sold_date: '2026-10-20' }),
      sale('2-2-0', { sold_date: '2026-10-21' }),
    ]);
    const res = await runFinancialSync(
      db,
      history([item({ vendaId: 1, produtoId: 1, dataVenda: '2026-10-20 10:00:00' }), item({ vendaId: 2, produtoId: 2, dataVenda: '2026-10-21 10:00:00' })], ['2026-10-20']),
      { start: '2026-10-20', end: '2026-10-21', days: ['2026-10-20', '2026-10-21'], mode: 'apply', trigger: 'cron', now: new Date('2026-10-31T18:00:00Z') }
    );
    assert.equal(db.tables.sales[0].financial_status, 'pending');
    assert.equal(db.tables.sales[1].financial_status, 'ok');
    assert.deepEqual(res.days_processed, ['2026-10-21']);
    assert.equal(res.days_failed[0].day, '2026-10-20');
    const run = db.tables.financial_sync_runs[0];
    assert.equal(run.status, 'ok');
    assert.match(String(run.error), /2026-10-20/);
    assert.deepEqual(
      db.tables.financial_reconcile_attempts.map((a) => [a.mp_order_id, a.outcome]).sort(),
      [['1', 'api_error'], ['2', 'reconciled']]
    );
  });

  it('pedido ainda ausente do histórico soma conferências e vira alerta pending_too_long no limite', async () => {
    const db = fakeDb([sale('5-1-0', { sold_date: '2026-10-20', financial_check_attempts: PENDING_ALERT_ATTEMPTS - 1 })]);
    await runFinancialSync(db, history([item({ vendaId: 6, produtoId: 9, dataVenda: '2026-10-20 09:00:00' })]), {
      start: '2026-10-20', end: '2026-10-20', days: ['2026-10-20'], mode: 'apply', trigger: 'cron', now: new Date('2026-10-31T18:00:00Z'),
    });
    const s = db.tables.sales[0];
    assert.equal(s.financial_status, 'not_found');
    assert.equal(s.financial_check_attempts, PENDING_ALERT_ATTEMPTS);
    assert.deepEqual(db.tables.financial_reconcile_attempts.map((a) => a.outcome), ['order_not_in_history']);
    assert.ok(db.tables.financial_reconcile_alerts.some((a) => a.kind === 'pending_too_long'));
  });

  it('alertas não se repetem entre execuções (mesma chave)', async () => {
    const db = fakeDb([
      sale('8389868-149456-1', { sold_date: '2026-10-07', created_at: '2026-10-07T15:00:00Z', revenue: 0, cost: 10, profit: -10, financial_status: 'ok', financial_synced_at: '2026-10-18T16:04:10Z' }),
    ]);
    const fetch = history([item({ vendaId: 8389868, produtoId: 149456, dataVenda: '2026-10-07 12:00:00', valorTotal: 0, valorCliente: 0, valorCusto: 13, lucro: -13, tipoProdutoDescricao: 'BRINDES' })]);
    const opts = { start: '2026-10-07', end: '2026-10-07', days: ['2026-10-07'], mode: 'apply' as const, trigger: 'cron', now: new Date('2026-10-31T18:00:00Z') };
    await runFinancialSync(db, fetch, opts);
    await runFinancialSync(db, fetch, opts);
    assert.equal(db.tables.sales[0].cost, 10, 'custo da época mantido');
    assert.equal(db.tables.financial_reconcile_alerts.length, 1);
    assert.equal(db.tables.financial_reconcile_alerts[0].kind, 'retroactive_change');
  });

  it('prévia não grava vendas, alertas nem tentativas', async () => {
    const db = fakeDb([sale('8734927-7936124-0', { sold_date: '2026-10-20' })]);
    const res = await runFinancialSync(db, history([item({ vendaId: 8734927, produtoId: 7936124, dataVenda: '2026-10-20 19:21:00' })]), {
      start: '2026-10-20', end: '2026-10-20', mode: 'preview', trigger: 'manual',
    });
    assert.equal(db.tables.sales[0].financial_status, 'pending');
    assert.equal(db.tables.financial_reconcile_attempts.length, 0);
    assert.equal(db.tables.financial_reconcile_alerts.length, 0);
    assert.equal(res.counts.rows_ok, 1);
  });
});

describe('consulta ao histórico do MercadoPhone', () => {
  const realFetch = globalThis.fetch;
  const realDelays = retryPolicy.delaysMs;
  beforeEach(() => {
    retryPolicy.delaysMs = [0, 0];
    (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => 'token-de-teste' } };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    retryPolicy.delaysMs = realDelays;
  });
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('repete após 503 e devolve os itens', async () => {
    let calls = 0;
    globalThis.fetch = (async () => (++calls === 1 ? respond(503, {}) : respond(200, { data: { itens: [{ vendaId: 1 }] } }))) as typeof fetch;
    const items = await fetchHistoricoVendas('2026-10-20 00:00:00', '2026-10-20 23:59:59');
    assert.equal(items.length, 1);
    assert.equal(calls, 2);
  });

  it('não repete erro 401 (token) e lança', async () => {
    let calls = 0;
    globalThis.fetch = (async () => (++calls, respond(401, { erro: 'token' }))) as typeof fetch;
    await assert.rejects(fetchHistoricoVendas('2026-10-20 00:00:00', '2026-10-20 23:59:59'), /401/);
    assert.equal(calls, 1);
  });

  it('resposta 200 sem data.itens é erro (nunca "dia sem vendas")', async () => {
    globalThis.fetch = (async () => respond(200, { erro: 'limite excedido' })) as typeof fetch;
    await assert.rejects(fetchHistoricoVendas('2026-10-20 00:00:00', '2026-10-20 23:59:59'), /sem data.itens/);
  });

  it('dia sem vendas (itens: []) é resposta válida', async () => {
    globalThis.fetch = (async () => respond(200, { data: { totalItens: 0, itens: [] } })) as typeof fetch;
    assert.deepEqual(await fetchHistoricoVendas('2026-11-20 00:00:00', '2026-11-20 23:59:59'), []);
  });

  it('falha de rede persistente desiste após as tentativas e informa quantas foram', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new TypeError('fetch failed'); }) as typeof fetch;
    await assert.rejects(fetchHistoricoVendas('2026-10-20 00:00:00', '2026-10-20 23:59:59'), /após 3 tentativa/);
    assert.equal(calls, 3);
  });
});

describe('regressões da auditoria na rotina', () => {
  it('D2: data de conciliação só muda quando receita/custo/lucro mudam (preserva a evidência)', () => {
    assert.deepEqual(withSyncStamp({ customer_name: 'X' }, 'agora'), { customer_name: 'X' });
    assert.equal(withSyncStamp({ cost: 10 }, 'agora').financial_synced_at, 'agora');
  });

  it('D4: vendas lançadas ontem em 6 datas retroativas diferentes entram todas, das mais recentes para as mais antigas', async () => {
    const rows = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].map((d, i) => sale(`${100 + i}-1-0`, { sold_date: d, created_at: '2026-10-30T15:00:00Z' }));
    const days = await pickReconcileDays(fakeDb(rows), { now: new Date('2026-10-31T18:00:00Z') });
    for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']) assert.ok(days.includes(d), d);
  });

  it('D4: mesmo com muitos lançamentos retroativos, pendências antigas têm vagas reservadas', async () => {
    const arrived = Array.from({ length: 15 }, (_, i) => sale(`${200 + i}-1-0`, { sold_date: `2026-10-${String(5 + i).padStart(2, '0')}`, created_at: '2026-10-30T15:00:00Z', financial_status: 'ok' }));
    const old = sale('300-1-0', { sold_date: '2026-09-03', created_at: '2026-09-05T00:00:00Z' });
    const days = await pickReconcileDays(fakeDb([...arrived, old]), { now: new Date('2026-10-31T18:00:00Z') });
    assert.ok(days.includes('2026-09-03'));
    assert.ok(days.length <= 12);
  });

  it('D5: dia com item divergente (mismatch) continua sendo conferido', async () => {
    const days = await pickReconcileDays(fakeDb([sale('400-1-0', { sold_date: '2026-09-10', created_at: '2026-09-10T12:00:00Z', financial_status: 'mismatch' })]), { now: new Date('2026-10-31T18:00:00Z') });
    assert.ok(days.includes('2026-09-10'));
  });

  it('R3/R4: 300 pendências geram poucas escritas e o registro de tentativas não explode', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => sale(`${5000 + i}-1-0`, { sold_date: '2026-10-20', financial_check_attempts: 2 }));
    const db = fakeDb(rows);
    await runFinancialSync(db, history([]), { start: '2026-10-20', end: '2026-10-20', days: ['2026-10-20'], mode: 'apply', trigger: 'cron', now: new Date('2026-10-31T18:00:00Z') });
    assert.ok(db.writes.filter((t) => t === 'sales').length <= 10, `escritas em sales: ${db.writes.filter((t) => t === 'sales').length}`);
    assert.equal(db.tables.financial_reconcile_attempts.length, 0, 'tentativa 3 de pendência repetida não é registrada');
    assert.ok(rows.every((r) => r.financial_check_attempts === 3));
    rows.forEach((r) => (r.financial_check_attempts = ATTEMPT_LOG_EVERY - 1));
    await runFinancialSync(db, history([]), { start: '2026-10-20', end: '2026-10-20', days: ['2026-10-20'], mode: 'apply', trigger: 'cron', now: new Date('2026-10-31T18:00:00Z') });
    assert.equal(db.tables.financial_reconcile_attempts.length, 300, 'a cada N conferências registra de novo');
  });

  it('R1: MercadoPhone fora do ar interrompe a execução (não insiste nos outros dias)', async () => {
    const db = fakeDb([sale('1-1-0', { sold_date: '2026-10-20' }), sale('2-2-0', { sold_date: '2026-10-21' }), sale('3-3-0', { sold_date: '2026-10-22' })]);
    let calls = 0;
    const down: FetchHistory = async () => { calls++; throw new Error('MercadoPhone API HistoricoVendaApiController.index: falha de rede — após 2 tentativa(s)'); };
    const res = await runFinancialSync(db, down, { start: '2026-10-20', end: '2026-10-22', days: ['2026-10-20', '2026-10-21', '2026-10-22'], mode: 'apply', trigger: 'cron', now: new Date('2026-10-31T18:00:00Z') });
    assert.equal(calls, 1);
    assert.equal(res.next_start, '2026-10-21');
    assert.equal(db.tables.financial_sync_runs[0].status, 'error');
  });
});

it('dia que sempre falha vai para o fim da fila (conferência e tentativa registradas mesmo na falha)', async () => {
  const db = fakeDb([sale('1-1-0', { sold_date: '2026-09-02', created_at: '2026-09-02T12:00:00Z' })]);
  const down: FetchHistory = async () => { throw new Error('MercadoPhone API HistoricoVendaApiController.index failed: 503 — após 2 tentativa(s)'); };
  await runFinancialSync(db, down, { start: '2026-09-02', end: '2026-09-02', days: ['2026-09-02'], mode: 'apply', trigger: 'cron', now: new Date('2026-10-31T18:00:00Z') });
  assert.ok(db.tables.sales[0].financial_checked_at);
  assert.equal(db.tables.sales[0].financial_check_attempts, 1);
});

describe('botão "Atualizar dados" — conciliação só das pendências', () => {
  const NOW = new Date('2026-11-04T14:50:00Z');
  // Pedido 8913080 (04/11/2026): 8 itens chegaram às 14:36 UTC sem custo; o histórico trouxe os custos minutos depois.
  const order = () => [
    sale('8913080-12012586-0', { sold_date: '2026-11-04', amount: 3460, product_name: 'IPHONE 15 PRO MAX', created_at: '2026-11-04T14:36:13Z' }),
    sale('8913080-12021477-5', { sold_date: '2026-11-04', amount: 3460, product_name: 'IPHONE 15 PRO MAX', created_at: '2026-11-04T14:36:14Z' }),
    sale('8913080-328423-6', { sold_date: '2026-11-04', amount: 100, product_name: 'PELÍCULA CERAMICA ', created_at: '2026-11-04T14:36:14Z' }),
    sale('8913080-149456-3', { sold_date: '2026-11-04', amount: 0, product_name: 'CARREGADOR  COMPLETO  - BND', created_at: '2026-11-04T14:36:13Z' }),
  ];
  const at = '2026-11-04 10:56:00';
  const costs = [
    item({ vendaId: 8913080, produtoId: 12012586, dataVenda: at, valorTotal: 4500, valorCliente: 3460, valorCusto: 3700, lucro: 800, tipoProdutoDescricao: 'PRODUTO APPLE' }),
    item({ vendaId: 8913080, produtoId: 12021477, dataVenda: at, valorTotal: 3460, valorCliente: 3460, valorCusto: 3460, lucro: 0, tipoProdutoDescricao: 'PRODUTO APPLE' }),
    item({ vendaId: 8913080, produtoId: 328423, dataVenda: at, valorTotal: 100, valorCliente: 100, valorCusto: 2.74, lucro: 97.26 }),
    item({ vendaId: 8913080, produtoId: 149456, dataVenda: at, valorTotal: 0, valorCliente: 0, valorCusto: 11.1, lucro: -11.1, tipoProdutoDescricao: 'BRINDES' }),
  ];
  const click = async (db: ReturnType<typeof fakeDb>, fetch: FetchHistory, range = { from: '2026-11-01', to: '2026-11-30' }) => {
    const days = await pickPendingDays(db, { ...range, now: NOW });
    if (days.length === 0) return null;
    const sorted = [...days].sort();
    return runFinancialSync(db, fetch, { start: sorted[0], end: sorted.at(-1)!, days, mode: 'apply', trigger: 'button:admin@loja', now: NOW, countChecks: false });
  };

  it('regressão 8913080: custos disponíveis → os itens ficam conciliados com os valores da origem', async () => {
    const db = fakeDb(order());
    const res = await click(db, history(costs));
    assert.deepEqual(res?.days_processed, ['2026-11-04']);
    const byExt = new Map(db.tables.sales.map((r) => [r.external_id, r]));
    assert.equal(byExt.get('8913080-12012586-0')?.financial_status, 'ok');
    assert.equal(byExt.get('8913080-12012586-0')?.cost, 3700);
    assert.equal(byExt.get('8913080-12012586-0')?.profit, 800);
    assert.equal(byExt.get('8913080-149456-3')?.profit, -11.1);
    assert.equal(db.tables.sales.length, 4, 'nenhuma linha nova');
    assert.equal(db.tables.financial_reconcile_attempts.at(-1)?.outcome, 'reconciled');
  });

  it('custos ainda indisponíveis (pedido fora do histórico) → seguem em aberto, sem custo inventado', async () => {
    const db = fakeDb(order());
    await click(db, history([]));
    for (const r of db.tables.sales) {
      // Mesma regra da rotina: pedido ausente vira `not_found` (aberto, conferido de novo depois).
      assert.equal(r.financial_status, 'not_found');
      assert.equal(r.cost ?? null, null);
      assert.equal(r.profit ?? null, null);
    }
    assert.equal(db.tables.financial_reconcile_attempts.at(-1)?.outcome, 'empty_history');
  });

  it('conciliação parcial: item sem custo na origem segue pendente e os demais conciliam', async () => {
    const db = fakeDb(order());
    const partial = costs.map((c) => (c.produtoId === 12021477 ? { ...c, valorCusto: null } : c)) as typeof costs;
    await click(db, history(partial));
    const byExt = new Map(db.tables.sales.map((r) => [r.external_id, r]));
    assert.equal(byExt.get('8913080-12021477-5')?.financial_status, 'pending');
    assert.equal(byExt.get('8913080-12021477-5')?.profit ?? null, null);
    assert.equal(byExt.get('8913080-12012586-0')?.financial_status, 'ok');
  });

  it('falha temporária da API → nada gravado nos valores e tentativa registrada como erro', async () => {
    const db = fakeDb(order());
    const down: FetchHistory = async () => { throw new Error('MercadoPhone API HistoricoVendaApiController.index failed: 503 — após 2 tentativa(s)'); };
    const res = await click(db, down);
    assert.equal(res?.days_failed.length, 1);
    assert.ok(db.tables.sales.every((r) => r.financial_status === 'pending' && (r.cost ?? null) === null));
    assert.equal(db.tables.financial_reconcile_attempts.at(-1)?.outcome, 'api_error');
  });

  it('cliques seguidos não somam conferências da rotina (nem antecipam o alerta de pendência longa)', async () => {
    const db = fakeDb(order().map((r) => ({ ...r, financial_check_attempts: PENDING_ALERT_ATTEMPTS - 1 })));
    await click(db, history([]));
    await click(db, history([]));
    assert.ok(db.tables.sales.every((r) => r.financial_check_attempts === PENDING_ALERT_ATTEMPTS - 1));
    assert.equal(db.tables.financial_reconcile_alerts.filter((a) => a.kind === 'pending_too_long').length, 0);
  });

  it('sem pendências no período não consulta o MercadoPhone', async () => {
    const db = fakeDb([sale('1-1-0', { sold_date: '2026-11-03', financial_status: 'ok', cost: 10, profit: 60 })]);
    let calls = 0;
    const res = await click(db, async () => { calls++; return []; });
    assert.equal(res, null);
    assert.equal(calls, 0);
  });

  it('só dias com pendência, dentro do período visível, desde 01/09 e até hoje — mais recentes primeiro e com limite', async () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => sale(`${100 + i}-1-0`, { sold_date: `2026-10-${String(20 + i).padStart(2, '0')}` })),
      sale('200-1-0', { sold_date: '2026-08-20' }),
      sale('201-1-0', { sold_date: '2026-10-15', financial_status: 'ok', cost: 5, profit: 1 }),
      sale('202-1-0', { sold_date: '2026-10-10', item_status: 'cancelled' }),
    ];
    const days = await pickPendingDays(fakeDb(rows), { from: '2026-08-01', to: '2026-10-31', now: NOW, maxDays: 6 });
    assert.deepEqual(days, ['2026-10-28', '2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23']);
    assert.deepEqual(await pickPendingDays(fakeDb(rows), { from: '2026-08-01', to: '2026-08-31', now: NOW }), []);
  });

  it('iPhone com custo 0 (custo não cadastrado) entra; brinde/serviço com custo 0 não', async () => {
    const rows = [
      sale('300-1-0', { sold_date: '2026-10-11', financial_status: 'ok', cost: 0, profit: 4000, amount: 4000, product_type: 'PRODUTO APPLE' }),
      sale('301-1-0', { sold_date: '2026-10-12', financial_status: 'ok', cost: 0, profit: 0, amount: 0, product_type: 'BRINDES' }),
      sale('302-1-0', { sold_date: '2026-10-13', financial_status: 'ok', cost: 0, profit: 30, amount: 30, product_type: 'SERVICOS' }),
    ];
    assert.deepEqual(await pickPendingDays(fakeDb(rows), { from: '2026-10-01', to: '2026-10-31', now: NOW }), ['2026-10-11']);
  });

  it('valor já conciliado fora dos dias pendentes não é tocado', async () => {
    const done = sale('400-1-0', { sold_date: '2026-11-02', financial_status: 'ok', cost: 50, profit: 20, revenue: 70 });
    const db = fakeDb([...order(), done]);
    await click(db, history(costs));
    assert.equal(done.cost, 50);
    assert.equal(done.profit, 20);
    assert.equal(done.financial_synced_at, undefined);
  });
});

describe('refreshGate — cliques repetidos e execuções simultâneas', () => {
  const now = Date.parse('2026-11-04T15:10:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('libera sem execução recente', () => {
    assert.equal(refreshGate([{ started_at: ago(30 * 60_000), finished_at: ago(30 * 60_000 - 4000), trigger: 'cron' }], now), 'ok');
  });
  it('execução em andamento (rotina ou outro clique) → busy', () => {
    assert.equal(refreshGate([{ started_at: ago(5000), finished_at: null, trigger: 'cron' }], now), 'busy');
    assert.equal(refreshGate([{ started_at: ago(5000), finished_at: null, trigger: 'button:outro@loja' }], now), 'busy');
  });
  it('execução presa há muito tempo não bloqueia para sempre', () => {
    assert.equal(refreshGate([{ started_at: ago(10 * 60_000), finished_at: null, trigger: 'cron' }], now), 'ok');
  });
  it('clique terminado há pouco → recent; depois do intervalo → ok', () => {
    assert.equal(refreshGate([{ started_at: ago(5000), finished_at: ago(2000), trigger: 'button:admin@loja' }], now), 'recent');
    assert.equal(refreshGate([{ started_at: ago(PENDING_REFRESH_COOLDOWN_MS + 1000), finished_at: ago(PENDING_REFRESH_COOLDOWN_MS), trigger: 'button:admin@loja' }], now), 'ok');
  });
  it('rotina recém-terminada não impede o clique', () => {
    assert.equal(refreshGate([{ started_at: ago(5000), finished_at: ago(1000), trigger: 'cron' }], now), 'ok');
  });
});

describe('botão com a trava compartilhada (reconcilePendingRange)', () => {
  const NOW = new Date('2026-11-04T14:50:00Z');
  const pendingSale = () => sale('8913080-12012586-0', { sold_date: '2026-11-04', amount: 3460, created_at: '2026-11-04T14:36:13Z' });
  const costs = [item({ vendaId: 8913080, produtoId: 12012586, dataVenda: '2026-11-04 10:56:00', valorTotal: 4500, valorCliente: 3460, valorCusto: 3700, lucro: 800, tipoProdutoDescricao: 'PRODUTO APPLE' })];

  it('trava livre: concilia e libera', async () => {
    const lock = fakeLockDb();
    const db = Object.assign(fakeDb([pendingSale()]), { rpc: lock.rpc });
    const res = await reconcilePendingRange(db, history(costs), { from: '2026-11-01', to: '2026-11-30', trigger: 'button:admin@loja', now: NOW, holder: 'button#1' });
    assert.equal(res.skipped, undefined);
    assert.equal(db.tables.sales[0].financial_status, 'ok');
    assert.equal(lock.row.holder, null);
  });

  it('rotina conciliando (trava ocupada) → busy, nada gravado e MercadoPhone não consultado', async () => {
    const lock = fakeLockDb();
    await lock.rpc('try_financial_sync_lock', { p_holder: 'cron#1', p_ttl_seconds: 180 });
    const db = Object.assign(fakeDb([pendingSale()]), { rpc: lock.rpc });
    let calls = 0;
    const res = await reconcilePendingRange(db, async () => { calls++; return costs; }, { from: '2026-11-01', to: '2026-11-30', trigger: 'button:admin@loja', now: NOW, holder: 'button#1' });
    assert.equal(res.skipped, 'busy');
    assert.equal(calls, 0);
    assert.equal(db.tables.sales[0].financial_status, 'pending');
    assert.equal(db.tables.financial_sync_runs.length, 0);
  });

  it('sem pendência: não pega a trava', async () => {
    const lock = fakeLockDb();
    const db = Object.assign(fakeDb([sale('1-1-0', { sold_date: '2026-11-03', financial_status: 'ok', cost: 1, profit: 1 })]), { rpc: lock.rpc });
    const res = await reconcilePendingRange(db, history([]), { from: '2026-11-01', to: '2026-11-30', trigger: 'button:admin@loja', now: NOW });
    assert.equal(res.skipped, 'nothing_pending');
    assert.ok(!lock.calls.includes('try_financial_sync_lock'));
  });

  it('dois cliques simultâneos (instâncias diferentes): uma concilia, a outra fica busy', async () => {
    const lock = fakeLockDb();
    const db = Object.assign(fakeDb([pendingSale()]), { rpc: lock.rpc });
    const slow: FetchHistory = async () => { await new Promise((r) => setTimeout(r, 5)); return costs; };
    const opts = (h: string) => ({ from: '2026-11-01', to: '2026-11-30', trigger: 'button:admin@loja', now: NOW, holder: h });
    const [a, b] = await Promise.all([reconcilePendingRange(db, slow, opts('a')), reconcilePendingRange(db, slow, opts('b'))]);
    assert.deepEqual([a.skipped, b.skipped].sort(), ['busy', undefined].sort());
    assert.equal(db.tables.financial_sync_runs.length, 1, 'uma execução só');
    assert.equal(db.tables.sales.length, 1, 'nenhuma linha duplicada');
  });
});
