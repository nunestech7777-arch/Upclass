import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchEstoqueSnapshot } from '../_shared/mercadophone.ts';
import { toSellerStockItem, toStockItems, type EstoqueApiItem } from '../_shared/stockItems.ts';
import { getCaller, isActiveAdmin, isActiveSeller } from '../_shared/access.ts';

/**
 * Estoque atual do MercadoPhone, ao vivo. Somente leitura: não grava nada no banco.
 * - Administrador: itens completos (aba Estoque, com custo).
 * - Vendedor com acesso ativo: só campos de venda (toSellerStockItem) — custo, IMEI e datas nem
 *   saem do servidor. Qualquer outra conta: 403.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let caller;
  try {
    caller = await getCaller(supabase, req);
  } catch (err) {
    console.error('estoque: papel do usuário', err);
    return json({ ok: false, error: 'falha ao verificar o acesso' }, 500);
  }
  if (!caller) return json({ ok: false, error: 'não autenticado' }, 401);
  const admin = isActiveAdmin(caller);
  if (!admin && !isActiveSeller(caller)) return json({ ok: false, error: 'acesso não autorizado' }, 403);

  try {
    const snapshot = await fetchEstoqueSnapshot();
    const items = toStockItems(snapshot.items as unknown as EstoqueApiItem[]);
    return json({
      ok: true,
      fetched_at: new Date().toISOString(),
      // false = a API não confirmou o total: a tela avisa que a lista pode estar incompleta.
      complete: snapshot.complete,
      items: admin ? items : items.map(toSellerStockItem),
    });
  } catch (err) {
    // Detalhe só no log; o cliente recebe uma mensagem genérica.
    console.error('estoque failed', err);
    return json({ ok: false, error: 'falha ao consultar o estoque no Mercado Phone' }, 502);
  }
});
