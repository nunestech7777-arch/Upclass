/**
 * Vendedor por item da venda. O webhook `venda_salva` só traz o vendedor da venda inteira;
 * o vendedor de cada item vem do histórico de vendas (HistoricoVendaApiController), que devolve
 * uma linha por item. Módulo puro (sem Deno) para ser usado pelas functions e pelos testes.
 */

export interface HistoricoItem {
  vendaId: number | string;
  produtoId: number | string;
  vendedorId: number | string | null;
  vendedorNome?: string | null;
}

export interface ItemSeller {
  externalId: string;
  name: string | null;
}

export function itemSellerKey(vendaId: number | string, produtoId: number | string): string {
  return `${vendaId}-${produtoId}`;
}

/**
 * Mapa `<venda>-<produto>` → vendedor do item. O histórico não traz o id do item, então quando o
 * mesmo produto aparece na mesma venda com vendedores diferentes a chave fica `null` (ambígua)
 * e ninguém é atribuído por dedução.
 */
export function mapItemSellers(rows: HistoricoItem[]): Map<string, ItemSeller | null> {
  const map = new Map<string, ItemSeller | null>();
  for (const row of rows) {
    if (row.vendedorId == null || row.vendedorId === '') continue;
    const key = itemSellerKey(row.vendaId, row.produtoId);
    const seller: ItemSeller = { externalId: String(row.vendedorId), name: row.vendedorNome?.trim() || null };
    const current = map.get(key);
    if (current === undefined) map.set(key, seller);
    else if (current !== null && current.externalId !== seller.externalId) map.set(key, null);
  }
  return map;
}

export interface SaleSellerRow {
  id: string;
  external_id: string | null;
  seller_id: string;
}

export interface SellerUpdate {
  saleId: string;
  externalId: string;
  from: string;
  to: string;
}

/**
 * Linhas de `sales` cujo vendedor difere do vendedor do item no MercadoPhone.
 * `sellerIdByExternalId` mapeia o id do vendedor no MercadoPhone para `sellers.id`;
 * vendedor ainda não cadastrado ou item ambíguo ficam de fora.
 */
export function planSellerUpdates(
  sales: SaleSellerRow[],
  itemSellers: Map<string, ItemSeller | null>,
  sellerIdByExternalId: Map<string, string>
): SellerUpdate[] {
  const updates: SellerUpdate[] = [];
  for (const sale of sales) {
    const match = /^(\d+)-(\d+)-\d+$/.exec(sale.external_id ?? '');
    if (!match) continue;
    const seller = itemSellers.get(itemSellerKey(match[1], match[2]));
    if (!seller) continue;
    const target = sellerIdByExternalId.get(seller.externalId);
    if (!target || target === sale.seller_id) continue;
    updates.push({ saleId: sale.id, externalId: sale.external_id!, from: sale.seller_id, to: target });
  }
  return updates;
}
