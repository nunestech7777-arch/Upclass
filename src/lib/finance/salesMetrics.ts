/**
 * Os 5 indicadores da aba Vendas, calculados sobre as linhas JÁ FILTRADAS na tela (período, produto,
 * categoria, vendedor, busca). Uma linha de `sales` é um ITEM; uma venda (pedido) pode ter vários.
 *
 * - Produtos vendidos = aparelhos (iPhone) + acessórios pagos, em unidades; brindes (valor 0) à parte.
 * - Ranking = produto com mais unidades (iPhones agrupados por modelo; acessórios pelo nome).
 * - Faturamento = Σ valorTotal (`revenue`) das linhas conciliadas — o mesmo do Dashboard.
 * - Lucro bruto = Σ lucro (`profit` = receita − custo) das linhas conciliadas, inclusive o custo dos
 *   brindes (lucro negativo), como no módulo financeiro. Não é lucro líquido.
 * - Lucro médio por venda = lucro bruto ÷ vendas (pedidos distintos), só com vendas cujos itens
 *   filtrados estão todos conciliados (as demais ficam de fora dos dois lados e são informadas).
 * Linhas canceladas/removidas nunca entram. Somas em centavos.
 */
import { financeCategory, isActive, isReconciled, type FinanceSale } from './calc.ts';
import { accessoryLabel, deviceModel } from './dashboard.ts';

const cents = (v: number | string | null | undefined) => Math.round((Number(v) || 0) * 100);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

export interface ProductRank {
  name: string;
  category: 'Aparelhos' | 'Acessórios';
  units: number;
  /** Faturamento conciliado do produto. */
  revenue: number;
  cost: number;
  profit: number;
  pendingItems: number;
}

export interface OrderProfit {
  orderId: string;
  soldAt: string;
  sellerIds: string[];
  items: number;
  revenue: number;
  profit: number;
}

export interface SalesMetrics {
  orders: number;
  devices: number;
  accessories: number;
  gifts: number;
  units: number;
  ranking: ProductRank[];
  revenue: number;
  cost: number;
  profit: number;
  /** Itens ativos sem conciliação (fora de faturamento/lucro). */
  pendingItems: number;
  /** Valor pago dos itens pendentes, só para dimensionar a lacuna. */
  pendingAmount: number;
  /** Itens pendentes PAGOS (afetam o faturamento; brinde pendente só afeta o lucro). */
  pendingPaidItems: number;
  /** Lucro médio por venda; null sem venda conciliada. */
  avgProfitPerOrder: number | null;
  reconciledOrders: OrderProfit[];
  pendingOrders: number;
}

type Row = Pick<FinanceSale, 'id' | 'product_id' | 'quantity' | 'amount' | 'sold_at' | 'item_status' | 'revenue' | 'cost' | 'profit' | 'financial_status' | 'seller_id'> & {
  mp_order_id?: string | null;
};

export function computeSalesMetrics(rows: Row[], productNames: Map<string, string>): SalesMetrics {
  let devices = 0;
  let accessories = 0;
  let gifts = 0;
  let revenue = 0;
  let cost = 0;
  let profit = 0;
  let pendingItems = 0;
  let pendingAmount = 0;
  let pendingPaidItems = 0;
  const groups = new Map<string, ProductRank & { variants: Map<string, number>; rc: number; cc: number; pc: number }>();
  const orders = new Map<string, { soldAt: string; sellers: Set<string>; items: number; rc: number; pc: number; complete: boolean }>();

  for (const s of rows) {
    if (!isActive(s)) continue;
    const name = productNames.get(s.product_id);
    const cat = financeCategory(name, Number(s.amount) || 0);
    const ok = isReconciled(s);
    if (cat === 'Aparelhos') devices += s.quantity;
    else if (cat === 'Acessórios') accessories += s.quantity;
    else gifts += s.quantity;

    if (ok) {
      revenue += cents(s.revenue);
      cost += cents(s.cost);
      profit += cents(s.profit);
    } else {
      pendingItems += 1;
      pendingAmount += cents(s.amount);
      if ((Number(s.amount) || 0) > 0) pendingPaidItems += 1;
    }

    const orderId = s.mp_order_id ?? `linha:${s.id}`;
    const o = orders.get(orderId) ?? { soldAt: s.sold_at, sellers: new Set<string>(), items: 0, rc: 0, pc: 0, complete: true };
    o.items += 1;
    o.sellers.add(s.seller_id);
    if (s.sold_at > o.soldAt) o.soldAt = s.sold_at;
    if (ok) {
      o.rc += cents(s.revenue);
      o.pc += cents(s.profit);
    } else o.complete = false;
    orders.set(orderId, o);

    if (cat === 'Brindes') continue;
    const label = cat === 'Aparelhos' ? deviceModel(name) : accessoryLabel(name);
    const key = `${cat}|${norm(label)}`;
    const g = groups.get(key) ?? { name: label, category: cat, units: 0, revenue: 0, cost: 0, profit: 0, pendingItems: 0, variants: new Map(), rc: 0, cc: 0, pc: 0 };
    g.units += s.quantity;
    g.variants.set(label, (g.variants.get(label) ?? 0) + s.quantity);
    if (ok) {
      g.rc += cents(s.revenue);
      g.cc += cents(s.cost);
      g.pc += cents(s.profit);
    } else g.pendingItems += 1;
    groups.set(key, g);
  }

  const ranking = [...groups.values()]
    .map(({ variants, rc, cc, pc, ...g }) => ({
      ...g,
      // Nome exibido: a grafia mais usada do grupo.
      name: [...variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0][0],
      revenue: rc / 100,
      cost: cc / 100,
      profit: pc / 100,
    }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.name.localeCompare(b.name, 'pt-BR'));

  const reconciledOrders: OrderProfit[] = [];
  let pendingOrders = 0;
  let orderProfit = 0;
  for (const [orderId, o] of orders) {
    if (!o.complete) {
      pendingOrders += 1;
      continue;
    }
    orderProfit += o.pc;
    reconciledOrders.push({ orderId, soldAt: o.soldAt, sellerIds: [...o.sellers], items: o.items, revenue: o.rc / 100, profit: o.pc / 100 });
  }
  reconciledOrders.sort((a, b) => b.profit - a.profit || b.soldAt.localeCompare(a.soldAt));

  return {
    orders: orders.size,
    devices,
    accessories,
    gifts,
    units: devices + accessories,
    ranking,
    revenue: revenue / 100,
    cost: cost / 100,
    profit: profit / 100,
    pendingItems,
    pendingAmount: pendingAmount / 100,
    pendingPaidItems,
    avgProfitPerOrder: reconciledOrders.length > 0 ? orderProfit / 100 / reconciledOrders.length : null,
    reconciledOrders,
    pendingOrders,
  };
}
