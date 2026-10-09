/**
 * Detalhes de uma venda vindos do payload `venda_salva` do MercadoPhone, guardado em
 * `mercadophone_webhook_events`. Só normaliza o que o MercadoPhone enviou — campo ausente
 * vira `null` e nunca é preenchido com valor inventado.
 */

export interface SaleOrderItem {
  productId: string | null;
  name: string | null;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  total: number | null;
  imei: string | null;
  serialNumber: string | null;
  /** `sellers.id` do vendedor deste item (linha correspondente em `sales`), quando identificável. */
  sellerId: string | null;
}

export interface SaleOrderPayment {
  description: string | null;
  amount: number | null;
}

export interface SaleOrderDetails {
  /** Id da venda no MercadoPhone. */
  orderId: string;
  customerName: string | null;
  /** Vendedor registrado na venda inteira no MercadoPhone — cada item pode ter outro. */
  orderSellerName: string | null;
  status: string | null;
  saleType: string | null;
  deliveryType: string | null;
  salesChannel: string | null;
  discount: number | null;
  total: number | null;
  canceledAt: string | null;
  cancelReason: string | null;
  items: SaleOrderItem[];
  payments: SaleOrderPayment[];
  /** Posição, em `items`, do item que corresponde à linha de venda aberta (ou -1). */
  currentItemIndex: number;
}

/** Linha devolvida pela consulta em `fetchSaleOrderDetails` (campos extraídos do payload). */
export interface SaleOrderEventRow {
  order_id: string | null;
  customer_name: string | null;
  seller_name: string | null;
  status: string | null;
  sale_type: string | null;
  delivery_type: string | null;
  sales_channel: string | null;
  discount: string | null;
  total: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  items: unknown;
  payments: unknown;
}

export interface SaleExternalRef {
  orderId: string;
  productId: string;
  itemIndex: number;
}

/** `sales.external_id` é gravado pelo webhook como `<id da venda>-<id do produto>-<índice do item>`. */
export function parseSaleExternalId(externalId: string | null | undefined): SaleExternalRef | null {
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(externalId ?? '');
  if (!match) return null;
  return { orderId: match[1], productId: match[2], itemIndex: Number(match[3]) };
}

function toText(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object');
}

/** Linhas de `sales` da mesma venda — cada uma é um item, com o seu próprio vendedor. */
export interface OrderSaleRow {
  external_id: string | null;
  seller_id: string;
}

export function parseSaleOrderDetails(
  row: SaleOrderEventRow,
  ref: SaleExternalRef,
  orderSales: OrderSaleRow[] = []
): SaleOrderDetails {
  const saleRefs = orderSales.flatMap((sale) => {
    const saleRef = parseSaleExternalId(sale.external_id);
    return saleRef && saleRef.orderId === ref.orderId ? [{ ...saleRef, sellerId: sale.seller_id }] : [];
  });
  const sellerIdFor = (productId: string | null, index: number): string | null => {
    if (productId === null) return null;
    const exact = saleRefs.find((s) => s.productId === productId && s.itemIndex === index);
    if (exact) return exact.sellerId;
    const sameProduct = new Set(saleRefs.filter((s) => s.productId === productId).map((s) => s.sellerId));
    return sameProduct.size === 1 ? [...sameProduct][0] : null;
  };

  const items: SaleOrderItem[] = toRecords(row.items).map((item, index) => ({
    productId: toText(item.produtoId),
    name: toText(item.produtoNome) ?? toText(item.aparelhoDescricao),
    quantity: toNumber(item.quantidade),
    unitPrice: toNumber(item.valorUnitario),
    discount: toNumber(item.desconto),
    total: toNumber(item.valorTotal),
    imei: toText(item.imei),
    serialNumber: toText(item.serialNumber),
    sellerId: sellerIdFor(toText(item.produtoId), index),
  }));

  // O índice só vale se o produto naquela posição ainda for o mesmo (a venda pode ter sido editada).
  let currentItemIndex = items[ref.itemIndex]?.productId === ref.productId ? ref.itemIndex : -1;
  if (currentItemIndex === -1) {
    const sameProduct = items.flatMap((item, index) => (item.productId === ref.productId ? [index] : []));
    if (sameProduct.length === 1) currentItemIndex = sameProduct[0];
  }

  return {
    orderId: toText(row.order_id) ?? ref.orderId,
    customerName: toText(row.customer_name),
    orderSellerName: toText(row.seller_name),
    status: toText(row.status),
    saleType: toText(row.sale_type),
    deliveryType: toText(row.delivery_type),
    salesChannel: toText(row.sales_channel),
    discount: toNumber(row.discount),
    total: toNumber(row.total),
    canceledAt: toText(row.canceled_at),
    cancelReason: toText(row.cancel_reason),
    items,
    payments: toRecords(row.payments).map((payment) => ({
      description: toText(payment.formaPagamentoDescrita),
      amount: toNumber(payment.valor),
    })),
    currentItemIndex,
  };
}
