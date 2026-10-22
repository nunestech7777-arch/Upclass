/**
 * Aba Estoque: classificação dos itens do estoque ATUAL do MercadoPhone e os 5 indicadores.
 * Fonte: function mercadophone-estoque (EstoqueApiController, ao vivo) — só unidades em estoque;
 * vendidas não aparecem (a aba Vendas usa `sales`, as bases não se misturam).
 *
 * Classificação: mesma lógica automática dos Produtos Apple do Forecast (appleProducts.ts) — iPhone,
 * MacBook, iPad, Apple Watch, AirPods, Mac mini, iMac, outros Apple —, com o tipo do MercadoPhone
 * para peças e brindes. Capas, películas e carregadores nunca viram iPhone/MacBook/iPad.
 *
 * Disponibilidade: só "Disponível para venda" está livre; "Laboratório" e demais situações
 * (reserva/indisponível) ficam fora das contas no filtro padrão.
 *
 * Indicadores (todos sobre os itens filtrados):
 * - Quantidade = Σ unidades.
 * - Ranking = produto (modelo) com mais unidades.
 * - Valor potencial = Σ unidades × preço de venda (só itens com preço > 0; brindes não são vendidos).
 *   Item vendável sem preço não recebe valor inventado: fica de fora e o card fica "parcial".
 * - Custo total = Σ unidades × custo (itens com custo > 0; custo 0/ausente deixa o card "parcial").
 * - Lucro bruto potencial = valor potencial − custo total (projeção; parcial se faltar preço/custo).
 * Itens de controle do MercadoPhone (seguro/blindagem com quantidade "infinita") não são mercadoria.
 */
import { APPLE_TYPES, classifyAppleLine, isOtherBrandPhone, normalizeName, type AppleType } from './appleProducts.ts';
import { deviceModel } from './dashboard.ts';

export interface StockItem {
  id: string;
  name: string;
  description: string;
  model: string | null;
  color: string | null;
  storage: string | null;
  condition: string | null;
  battery: number | null;
  quantity: number;
  cost: number | null;
  price: number | null;
  availability: string;
  available: boolean;
  mpType: string | null;
  isAccessory: boolean;
  isPart: boolean;
  entryDate: string | null;
  updatedAt: string | null;
  imei: string | null;
  /** Unidade com IMEI/série (data de entrada da própria unidade). Ausente em respostas antigas. */
  unitTracked?: boolean;
}

export type StockCategory = 'Produtos Apple' | 'Acessórios' | 'Brindes' | 'Peças' | 'Outros aparelhos';
export const STOCK_CATEGORIES: StockCategory[] = ['Produtos Apple', 'Acessórios', 'Brindes', 'Peças', 'Outros aparelhos'];

export interface ClassifiedStockItem extends StockItem {
  category: StockCategory;
  appleType: AppleType | null;
  /** Nome do ranking (iPhones agrupados por modelo: "iPhone 17 Pro Max"). */
  group: string;
}

/** Seguro/blindagem/garantia: itens de controle do MercadoPhone, não mercadoria. */
const CONTROL = /\b(SEGURO|BLINDAGEM|GARANTIA)\b/;
export const CONTROL_QTY = 9000;

export function isControlItem(item: Pick<StockItem, 'description' | 'quantity'>): boolean {
  return CONTROL.test(normalizeName(item.description)) || item.quantity >= CONTROL_QTY;
}

export function classifyStockItem(item: StockItem): ClassifiedStockItem {
  const mp = normalizeName(item.mpType);
  const label = item.description || item.name;
  const c = classifyAppleLine(label, { quantity: 1, amount: item.price ?? 0, product_type: item.mpType });
  let category: StockCategory;
  let appleType: AppleType | null = null;
  if (c.kind === 'apple') {
    category = 'Produtos Apple';
    appleType = c.type;
  } else if (item.isPart || /^PECAS?$/.test(mp)) category = 'Peças';
  else if (mp === 'BRINDES' || /\b(BND|BRINDE)\b/.test(normalizeName(label))) category = 'Brindes';
  else if (isOtherBrandPhone(label)) category = 'Outros aparelhos';
  else category = 'Acessórios';
  const group =
    appleType === 'iPhone'
      ? deviceModel(item.model ?? label)
      : (item.model ?? label.split(' - ')[0]).replace(/\s+/g, ' ').trim() || 'Produto sem nome';
  return { ...item, category, appleType, group };
}

export type StockStatusFilter = 'available' | 'unavailable' | 'all';

export interface StockFilters {
  category: 'all' | StockCategory;
  appleType: 'all' | AppleType;
  status: StockStatusFilter;
  search: string;
}

export function filterStock(items: ClassifiedStockItem[], f: StockFilters): ClassifiedStockItem[] {
  const q = normalizeName(f.search);
  return items.filter((i) => {
    if (f.status === 'available' && !i.available) return false;
    if (f.status === 'unavailable' && i.available) return false;
    if (f.category !== 'all' && i.category !== f.category) return false;
    if (f.appleType !== 'all' && i.appleType !== f.appleType) return false;
    if (q) {
      const hay = normalizeName([i.description, i.group, i.model, i.color, i.storage, i.condition, i.imei, i.id].filter(Boolean).join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const cents = (v: number) => Math.round(v * 100);

export interface StockRank {
  group: string;
  category: StockCategory;
  appleType: AppleType | null;
  units: number;
  items: number;
  potential: number;
  cost: number;
}

export interface StockMetrics {
  units: number;
  items: number;
  /** Unidades por tipo/categoria (iPhone, MacBook…, Acessórios…), maior primeiro. */
  breakdown: { label: string; units: number }[];
  ranking: StockRank[];
  potential: number;
  /** Itens vendáveis (não brinde) sem preço de venda: fora do valor potencial. */
  missingPrice: { items: number; units: number };
  cost: number;
  /** Itens sem custo (0 ou ausente): fora do custo total. */
  missingCost: { items: number; units: number };
  /** Valor potencial − custo total. */
  profit: number;
  /** Lucro potencial é definitivo só sem lacunas de preço e custo. */
  complete: boolean;
}

export const isSellable = (i: ClassifiedStockItem) => i.category !== 'Brindes';
export const hasPrice = (i: StockItem) => (i.price ?? 0) > 0;
export const hasCost = (i: StockItem) => (i.cost ?? 0) > 0;

export function computeStockMetrics(items: ClassifiedStockItem[]): StockMetrics {
  let units = 0;
  let potential = 0;
  let cost = 0;
  const missingPrice = { items: 0, units: 0 };
  const missingCost = { items: 0, units: 0 };
  const byLabel = new Map<string, number>();
  const groups = new Map<string, StockRank & { pc: number; cc: number }>();
  for (const i of items) {
    units += i.quantity;
    const label = i.appleType ?? i.category;
    byLabel.set(label, (byLabel.get(label) ?? 0) + i.quantity);
    const itemPotential = isSellable(i) && hasPrice(i) ? cents(i.price!) * i.quantity : 0;
    const itemCost = hasCost(i) ? cents(i.cost!) * i.quantity : 0;
    potential += itemPotential;
    cost += itemCost;
    if (isSellable(i) && !hasPrice(i)) {
      missingPrice.items += 1;
      missingPrice.units += i.quantity;
    }
    if (!hasCost(i)) {
      missingCost.items += 1;
      missingCost.units += i.quantity;
    }
    const key = `${i.category}|${i.appleType ?? ''}|${normalizeName(i.group)}`;
    const g = groups.get(key) ?? { group: i.group, category: i.category, appleType: i.appleType, units: 0, items: 0, potential: 0, cost: 0, pc: 0, cc: 0 };
    g.units += i.quantity;
    g.items += 1;
    g.pc += itemPotential;
    g.cc += itemCost;
    groups.set(key, g);
  }
  const order = (l: string) => {
    const a = APPLE_TYPES.indexOf(l as AppleType);
    return a >= 0 ? a : 100;
  };
  return {
    units,
    items: items.length,
    breakdown: [...byLabel.entries()].map(([label, u]) => ({ label, units: u })).sort((a, b) => b.units - a.units || order(a.label) - order(b.label)),
    // Ranking de produtos comerciais: brindes só entram quando são o próprio filtro (todos brindes).
    ranking: [...groups.values()]
      .filter((g) => g.category !== 'Brindes' || items.every((i) => i.category === 'Brindes'))
      .map(({ pc, cc, ...g }) => ({ ...g, potential: pc / 100, cost: cc / 100 }))
      .sort((a, b) => b.units - a.units || b.potential - a.potential || a.group.localeCompare(b.group, 'pt-BR')),
    potential: potential / 100,
    missingPrice,
    cost: cost / 100,
    missingCost,
    profit: (potential - cost) / 100,
    complete: missingPrice.items === 0 && missingCost.items === 0,
  };
}
