import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchAllVendedores, fetchEstoqueSnapshot, fetchHistoricoVendas } from '../_shared/mercadophone.ts';
import { mapItemSellers, planSellerUpdates, type SaleSellerRow } from '../_shared/itemSellers.ts';
import { addDays, runFinancialSync, todayInStore } from '../_shared/financialSync.ts';
import { planStockMovements, type IntervalSales, type LedgerSnapshotItem, type LevelRow } from '../_shared/stockLedger.ts';

const RECONCILE_DAYS = 3;
const pad = (n: number) => String(n).padStart(2, '0');
/** `Date` em UTC → `YYYY-MM-DD HH:mm:ss`. */
const wallClock = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/**
 * Confere o vendedor de cada item das vendas recentes com o histórico do MercadoPhone e corrige
 * `sales.seller_id` onde difere. Cobre o que o webhook não conseguiu atribuir na hora e as vendas
 * editadas depois. Só altera o vendedor — nunca cria, apaga ou muda valor de venda.
 */
// deno-lint-ignore no-explicit-any
async function reconcileItemSellers(supabase: any): Promise<number> {
  // `sold_at` guarda o horário da loja como se fosse UTC, então a janela é larga dos dois lados.
  const from = new Date(Date.now() - (RECONCILE_DAYS + 1) * 86_400_000);
  const to = new Date(Date.now() + 86_400_000);
  const itemSellers = mapItemSellers(await fetchHistoricoVendas(wallClock(from), wallClock(to)));
  if (itemSellers.size === 0) return 0;

  const { data: sellers, error: sellersError } = await supabase.from('sellers').select('id, external_id');
  if (sellersError) throw new Error(`listar vendedores: ${sellersError.message}`);
  const sellerIdByExternalId = new Map<string, string>(
    // deno-lint-ignore no-explicit-any
    (sellers ?? []).filter((s: any) => s.external_id).map((s: any) => [s.external_id, s.id])
  );

  const sales: SaleSellerRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('sales')
      .select('id, external_id, seller_id')
      .gte('sold_at', from.toISOString())
      .order('id')
      .range(offset, offset + 999);
    if (error) throw new Error(`listar vendas: ${error.message}`);
    sales.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const updates = planSellerUpdates(sales, itemSellers, sellerIdByExternalId);
  for (const update of updates) {
    const { error } = await supabase.from('sales').update({ seller_id: update.to }).eq('id', update.saleId);
    if (error) throw new Error(`corrigir vendedor do item ${update.externalId}: ${error.message}`);
  }
  return updates.length;
}

/** Data da loja (America/Sao_Paulo) de um instante. */
const storeDateOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

/** Instante → relógio da loja `AAAA-MM-DD HH:mm:ss` (formato de dataVenda do MercadoPhone). */
function storeWallClock(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

/**
 * Giro de estoque: compara a leitura COMPLETA do estoque com a anterior e grava entradas/saídas de
 * produtos vendidos em lote (stock_movements) numa única transação (RPC record_stock_movements).
 * As vendas do intervalo (histórico) entram na conta para que reposição + venda na mesma janela não
 * se anulem e devoluções de canceladas não pareçam reposição. Ver _shared/stockLedger.ts e a 0018.
 */
const CANCEL_LOOKBACK_DAYS = 15;

// deno-lint-ignore no-explicit-any
async function recordStockMovements(supabase: any, snapshot: LedgerSnapshotItem[], snapshotAt: Date): Promise<{ movements: number }> {
  const levels: LevelRow[] = [];
  let basedOn: string | null = null;
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('stock_levels')
      .select('product_external_id, quantity, last_seen_at')
      .order('product_external_id')
      .range(offset, offset + 999);
    if (error) throw new Error(`listar níveis de estoque: ${error.message}`);
    for (const l of data ?? []) {
      levels.push({ product_external_id: l.product_external_id, quantity: l.quantity, last_seen_date: storeDateOf(l.last_seen_at) });
      if (basedOn == null || Date.parse(l.last_seen_at) > Date.parse(basedOn)) basedOn = l.last_seen_at;
    }
    if ((data ?? []).length < 1000) break;
  }

  // Intervalo = da leitura anterior do estoque até ESTA leitura (vendas depois dela ainda não
  // aparecem no saldo lido e ficam para a próxima execução).
  const seenAt = snapshotAt.toISOString();
  const until = storeWallClock(seenAt);
  const lookback = storeWallClock(new Date(snapshotAt.getTime() - CANCEL_LOOKBACK_DAYS * 86_400_000).toISOString());
  const since = basedOn ? storeWallClock(basedOn) : null;
  const rows = (await fetchHistoricoVendas(since && since < lookback ? since : lookback, until)) as unknown as {
    vendaId: number | string;
    produtoId: number | string;
    quantidade: number;
    dataVenda: string;
    statusVenda?: string;
  }[];

  // Cancelamentos recentes (venda + produto). Os ainda não contabilizados viram devolução.
  const cancelled = new Map<string, { productId: string; quantity: number }>();
  const sold = new Map<string, number>();
  for (const r of rows) {
    const id = String(r.produtoId);
    const q = Number(r.quantidade) || 0;
    if (String(r.statusVenda ?? '').toLowerCase().startsWith('cancel')) {
      const key = `${r.vendaId}-${id}`;
      const c = cancelled.get(key) ?? { productId: id, quantity: 0 };
      c.quantity += q;
      cancelled.set(key, c);
    } else if (since && String(r.dataVenda) > since && String(r.dataVenda) <= until) {
      sold.set(id, (sold.get(id) ?? 0) + q);
    }
  }
  const seenKeys = new Set<string>();
  if (cancelled.size > 0) {
    const { data, error } = await supabase.from('stock_cancellations_seen').select('line_key').in('line_key', [...cancelled.keys()]);
    if (error) throw new Error(`ler cancelamentos vistos: ${error.message}`);
    for (const r of data ?? []) seenKeys.add(r.line_key);
  }
  const returned = new Map<string, number>();
  // Na primeira leitura tudo vira saldo inicial: cancelamentos antigos só são marcados como vistos.
  if (basedOn) for (const [key, c] of cancelled) if (!seenKeys.has(key)) returned.set(c.productId, (returned.get(c.productId) ?? 0) + c.quantity);
  const interval: IntervalSales | undefined = basedOn ? { sold, returned } : undefined;

  const plan = planStockMovements(levels, snapshot, todayInStore(snapshotAt), interval);
  const { data: written, error } = await supabase.rpc('record_stock_movements', {
    p_movements: plan.movements,
    p_levels: plan.levels,
    p_zeroed: plan.zeroed,
    p_based_on: basedOn,
    p_seen_at: seenAt,
    p_cancelled: [...cancelled].map(([line_key, c]) => ({ line_key, quantity: c.quantity })),
  });
  if (error) throw new Error(`gravar movimentos de estoque: ${error.message}`);
  // -1 = outra sincronização gravou antes (plano velho descartado; a próxima execução recalcula).
  return { movements: written === -1 ? 0 : plan.movements.length };
}

Deno.serve(async (req) => {
  // Chamada pelo agendador (pg_cron) sem JWT: autenticada por segredo na URL, como o webhook e as funções do
  // Kommo. Aceita o segredo próprio do agendamento (MERCADOPHONE_SYNC_SECRET) ou o do webhook; sem nenhum
  // configurado, ou com valor diferente, recusa.
  const secret = new URL(req.url).searchParams.get('secret');
  const accepted = [Deno.env.get('MERCADOPHONE_SYNC_SECRET'), Deno.env.get('MERCADOPHONE_WEBHOOK_SECRET')].filter(
    (value): value is string => !!value
  );
  if (!secret || !accepted.includes(secret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Instante da leitura do estoque: limite das vendas consideradas no giro (ver recordStockMovements).
    const snapshotAt = new Date();
    const [vendedores, estoque] = await Promise.all([fetchAllVendedores(), fetchEstoqueSnapshot()]);
    const produtos = estoque.items;

    const sellerRows = vendedores.map((v) => ({
      external_id: String(v.id),
      name: v.nome.trim(),
      active: v.snAtivo === 1,
    }));
    if (sellerRows.length > 0) {
      const { error } = await supabase.from('sellers').upsert(sellerRows, { onConflict: 'external_id' });
      if (error) throw new Error(`upsert sellers: ${error.message}`);
    }

    // snServico = serviço (não é item físico de estoque) — não sincronizamos.
    const productRows = produtos
      .filter((p) => p.snServico !== 1)
      .map((p) => ({
        external_id: String(p.id),
        name: p.aparelhoDescricao || p.descricao,
        code: String(p.id),
        category: (p.snAcessorio === 1 || p.snPeca === 1 || p.snBike === 1 ? 'Acessórios' : 'Aparelhos') as
          | 'Acessórios'
          | 'Aparelhos',
        stock: p.quantidade ?? 0,
        min_stock: p.quantidadeMinima ?? 0,
        price: p.valorVenda ?? 0,
        imei: p.imei,
        battery_health: p.saudeBateria != null ? `${p.saudeBateria}%` : null,
      }));
    if (productRows.length > 0) {
      const { error } = await supabase.from('products').upsert(productRows, { onConflict: 'external_id' });
      if (error) throw new Error(`upsert products: ${error.message}`);
    }

    // O MercadoPhone só lista o que está em estoque: produto do MercadoPhone que saiu da lista (vendido,
    // baixado) fica com estoque 0 aqui. Só com a lista COMPLETA (a API informou o total e todos os itens
    // chegaram) — resposta parcial ou inválida nunca zera estoque.
    let stockZeroed: number | null = null;
    if (estoque.complete && productRows.length > 0) {
      const current = new Set(productRows.map((r) => r.external_id));
      // deno-lint-ignore no-explicit-any
      const withStock: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from('products')
          .select('id, external_id')
          .gt('stock', 0)
          .not('external_id', 'is', null)
          .order('id')
          .range(offset, offset + 999);
        if (error) throw new Error(`listar produtos com estoque: ${error.message}`);
        withStock.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
      }
      // deno-lint-ignore no-explicit-any
      const stale = withStock.filter((p: any) => !current.has(String(p.external_id))).map((p: any) => p.id);
      for (let i = 0; i < stale.length; i += 200) {
        const { error: zeroError } = await supabase.from('products').update({ stock: 0 }).in('id', stale.slice(i, i + 200));
        if (zeroError) throw new Error(`zerar estoque de produtos vendidos: ${zeroError.message}`);
      }
      stockZeroed = stale.length;
    }

    // Giro de estoque (só com lista completa: parcial nunca vira "saída"). Falha aqui não derruba o resto.
    let stockMovements: number | null = null;
    if (estoque.complete) {
      try {
        stockMovements = (await recordStockMovements(supabase, produtos as unknown as LedgerSnapshotItem[], snapshotAt)).movements;
      } catch (err) {
        console.error('failed to record stock movements', err);
      }
    }

    // Não derruba a sincronização de estoque/vendedores se o histórico de vendas falhar.
    let itemSellersFixed: number | null = null;
    try {
      itemSellersFixed = await reconcileItemSellers(supabase);
    } catch (err) {
      console.error('failed to reconcile item sellers', err);
    }

    // Custo, lucro, cancelamentos e itens removidos dos últimos dias (o histórico completo é
    // recuperado pela function mercadophone-financial-sync, por período).
    let financial: unknown = null;
    try {
      const today = todayInStore();
      const result = await runFinancialSync(supabase, fetchHistoricoVendas, {
        start: addDays(today, -RECONCILE_DAYS),
        end: today,
        mode: 'apply',
        trigger: 'cron',
        timeBudgetMs: 60_000,
      });
      financial = result.counts;
    } catch (err) {
      console.error('failed to reconcile financial data', err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sellers: sellerRows.length,
        products: productRows.length,
        stock_zeroed: stockZeroed,
        stock_movements: stockMovements,
        item_sellers_fixed: itemSellersFixed,
        financial,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
