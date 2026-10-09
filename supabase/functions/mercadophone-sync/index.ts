import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchAllEstoque, fetchAllVendedores, fetchHistoricoVendas } from '../_shared/mercadophone.ts';
import { mapItemSellers, planSellerUpdates, type SaleSellerRow } from '../_shared/itemSellers.ts';

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

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const [vendedores, produtos] = await Promise.all([fetchAllVendedores(), fetchAllEstoque()]);

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

    // Não derruba a sincronização de estoque/vendedores se o histórico de vendas falhar.
    let itemSellersFixed: number | null = null;
    try {
      itemSellersFixed = await reconcileItemSellers(supabase);
    } catch (err) {
      console.error('failed to reconcile item sellers', err);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sellers: sellerRows.length,
        products: productRows.length,
        item_sellers_fixed: itemSellersFixed,
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
