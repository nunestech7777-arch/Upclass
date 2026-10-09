import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchHistoricoVendas } from '../_shared/mercadophone.ts';
import { itemSellerKey, mapItemSellers, type ItemSeller } from '../_shared/itemSellers.ts';

interface VendaItem {
  produtoId: number | string;
  produtoNome?: string;
  quantidade: number;
  valorUnitario?: number;
  valorTotal?: number;
}

interface Venda {
  id: number | string;
  dataVenda: string;
  status?: string;
  vendedorId: number | string;
  vendedorNome?: string;
  itens: VendaItem[];
}

function extractVenda(payload: unknown): Venda | null {
  const obj = payload as Record<string, unknown> | null;
  const data = obj?.data as Record<string, unknown> | undefined;
  const candidates = [payload, obj?.venda, data, data?.venda];
  for (const c of candidates) {
    if (c && typeof c === 'object' && 'id' in c && 'itens' in c && Array.isArray((c as Venda).itens)) {
      return c as Venda;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!secret || secret !== Deno.env.get('MERCADOPHONE_WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Segunda camada: o MercadoPhone também envia um token próprio nesse header.
  // Só valida se o segredo estiver configurado (evita quebrar o deploy antes de setá-lo).
  const expectedAuthCode = Deno.env.get('MERCADOPHONE_WEBHOOK_AUTH_CODE');
  if (expectedAuthCode && req.headers.get('mp-auth-code') !== expectedAuthCode) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const rawText = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = { raw: rawText };
  }

  const { data: eventRow, error: insertError } = await supabase
    .from('mercadophone_webhook_events')
    .insert({ payload })
    .select('id')
    .single();

  if (insertError) {
    console.error('failed to stage webhook event', insertError);
    return new Response('ok', { status: 200 });
  }

  try {
    const venda = extractVenda(payload);
    if (!venda) {
      throw new Error('payload não reconhecido: não encontrei um objeto de venda com id + itens');
    }

    const status = (venda.status ?? '').toLowerCase().trim();
    if (status && status !== 'concluido') {
      await supabase
        .from('mercadophone_webhook_events')
        .update({ processed: true, error: `ignorado: status="${venda.status}"` })
        .eq('id', eventRow.id);
      return new Response('ok', { status: 200 });
    }

    const sellerIdCache = new Map<string, string>();
    const resolveSellerId = async (externalId: string, name: string | null | undefined): Promise<string> => {
      const cachedId = sellerIdCache.get(externalId);
      if (cachedId) return cachedId;
      let id: string;
      const { data: existing } = await supabase
        .from('sellers')
        .select('id')
        .eq('external_id', externalId)
        .maybeSingle();
      if (existing) {
        id = existing.id;
      } else {
        const { data: created, error } = await supabase
          .from('sellers')
          .insert({
            external_id: externalId,
            name: name?.trim() || `Vendedor ${externalId}`,
            active: true,
          })
          .select('id')
          .single();
        if (error) throw new Error(`criar vendedor: ${error.message}`);
        id = created.id;
      }
      sellerIdCache.set(externalId, id);
      return id;
    };

    // Vendedor da venda inteira — só é usado no item quando o histórico não informa o vendedor dele.
    const sellerId = await resolveSellerId(String(venda.vendedorId), venda.vendedorNome);

    // O payload não traz o vendedor de cada item; ele vem do histórico de vendas (uma linha por item).
    let itemSellers = new Map<string, ItemSeller | null>();
    try {
      const minute = String(venda.dataVenda).slice(0, 16);
      itemSellers = mapItemSellers(await fetchHistoricoVendas(`${minute}:00`, `${minute}:59`));
    } catch (err) {
      console.error('failed to fetch item sellers; mercadophone-sync reconcilia depois', err);
    }

    for (const [itemIndex, item] of venda.itens.entries()) {
      let productId: string;
      const { data: existingProduct } = await supabase
        .from('products')
        .select('id')
        .eq('external_id', String(item.produtoId))
        .maybeSingle();

      if (existingProduct) {
        productId = existingProduct.id;
      } else {
        const unitPrice = item.valorUnitario ?? (item.quantidade > 0 ? (item.valorTotal ?? 0) / item.quantidade : 0);
        const { data: created, error } = await supabase
          .from('products')
          .insert({
            external_id: String(item.produtoId),
            name: item.produtoNome || `Produto ${item.produtoId}`,
            code: String(item.produtoId),
            category: unitPrice > 500 ? 'Aparelhos' : 'Acessórios',
            stock: 0,
            min_stock: 0,
            price: unitPrice,
          })
          .select('id')
          .single();
        if (error) throw new Error(`criar produto: ${error.message}`);
        productId = created.id;
      }

      const externalId = `${venda.id}-${item.produtoId}-${itemIndex}`;
      const saleFields = {
        product_id: productId,
        quantity: item.quantidade,
        amount: item.valorTotal ?? (item.valorUnitario ?? 0) * item.quantidade,
        sold_at: venda.dataVenda,
      };
      const itemSeller = itemSellers.get(itemSellerKey(venda.id, item.produtoId));

      if (itemSeller) {
        const { error: saleError } = await supabase.from('sales').upsert(
          {
            external_id: externalId,
            seller_id: await resolveSellerId(itemSeller.externalId, itemSeller.name),
            ...saleFields,
          },
          { onConflict: 'external_id' }
        );
        if (saleError) throw new Error(`gravar venda: ${saleError.message}`);
        continue;
      }

      // Sem vendedor do item: linha nova entra com o vendedor da venda; linha existente mantém o
      // vendedor que já tem, para não desfazer uma atribuição por item feita antes.
      const { data: existingSale } = await supabase
        .from('sales')
        .select('id')
        .eq('external_id', externalId)
        .maybeSingle();
      const { error: saleError } = existingSale
        ? await supabase.from('sales').update(saleFields).eq('id', existingSale.id)
        : await supabase.from('sales').insert({ external_id: externalId, seller_id: sellerId, ...saleFields });
      if (saleError) throw new Error(`gravar venda: ${saleError.message}`);
    }

    await supabase
      .from('mercadophone_webhook_events')
      .update({ processed: true })
      .eq('id', eventRow.id);
  } catch (err) {
    console.error('failed to process webhook event', err);
    await supabase
      .from('mercadophone_webhook_events')
      .update({ error: String(err) })
      .eq('id', eventRow.id);
  }

  // Sempre 200: já persistimos o payload bruto, então um erro de parsing não deve
  // fazer o MercadoPhone ficar retentando a entrega indefinidamente.
  return new Response('ok', { status: 200 });
});
