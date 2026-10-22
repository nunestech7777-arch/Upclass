import { isUnitTracked } from './stockLedger.ts';

/**
 * Estoque ATUAL do MercadoPhone (EstoqueApiController) normalizado para o painel. Módulo puro (sem
 * Deno) — usado pela function mercadophone-estoque e pelos testes.
 *
 * - A API devolve só o que está em estoque agora (vendido sai da lista): é a fonte da aba Estoque.
 * - Serviços (snServico = 1) não são mercadoria e ficam fora.
 * - Não repassa dados de cliente nem de fornecedor; IMEI segue (a busca da tela usa).
 * - Valores por UNIDADE: `valorCusto` e `valorVenda`. Zero é mantido como 0 (a tela decide se é
 *   brinde, preço ausente ou custo não informado) — nada é inventado.
 */

export interface EstoqueApiItem {
  id: number | string;
  descricao?: string | null;
  nome?: string | null;
  aparelhoDescricao?: string | null;
  corDescricao?: string | null;
  gbDescricao?: string | null;
  estadoProdutoDescricao?: string | null;
  saudeBateria?: number | null;
  quantidade?: number | string | null;
  valorCusto?: number | string | null;
  valorVenda?: number | string | null;
  disponibilidade?: string | null;
  produtoDisponibilidadeId?: number | null;
  tipoProdutoDescricao?: string | null;
  snAcessorio?: number | null;
  snPeca?: number | null;
  snServico?: number | null;
  dataEntrada?: string | null;
  dataModificacao?: string | null;
  imei?: string | null;
  serialNumber?: string | null;
  excluido?: boolean | null;
}

export interface StockItem {
  id: string;
  /** Nome para exibir e classificar (modelo do aparelho ou descrição limpa). */
  name: string;
  /** Descrição sem IMEI/SN, com cor/capacidade/estado. */
  description: string;
  model: string | null;
  color: string | null;
  storage: string | null;
  condition: string | null;
  battery: number | null;
  quantity: number;
  /** Custo por unidade; null = não informado. */
  cost: number | null;
  /** Preço de venda por unidade; null = não informado. */
  price: number | null;
  availability: string;
  /** "Disponível para venda" = livre; demais (ex.: "Laboratório") não estão disponíveis. */
  available: boolean;
  mpType: string | null;
  isAccessory: boolean;
  isPart: boolean;
  entryDate: string | null;
  updatedAt: string | null;
  imei: string | null;
  /** Unidade com IMEI/série: a data de entrada é a da própria unidade (giro de estoque). */
  unitTracked: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/** "11677039 - IPHONE XR  - BLUE - 64GB -  Estado: SEMI NOVO -  IMEI: … - SN: …" → "IPHONE XR - BLUE - 64GB". */
export function cleanDescription(descricao: string | null | undefined, id?: string | number): string {
  let d = clean(descricao);
  if (id != null) d = d.replace(new RegExp(`^${String(id)}\\s*-\\s*`), '');
  else d = d.replace(/^\d+\s*-\s*/, '');
  return d
    .split(/\s+-\s+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && !/^(IMEI|IMEI 2|SN|ESTADO|SAUDE|SAÚDE|ID)\b/i.test(s))
    .join(' - ');
}

export function toStockItem(p: EstoqueApiItem): StockItem | null {
  if (p.snServico === 1 || p.excluido) return null;
  const id = String(p.id);
  const description = cleanDescription(p.descricao, id) || clean(p.nome) || `Produto ${id}`;
  const model = clean(p.aparelhoDescricao) || null;
  const availability = clean(p.disponibilidade) || 'Disponível para venda';
  const isPart = p.snPeca === 1 || /^PE[CÇ]AS?$/i.test(clean(p.tipoProdutoDescricao));
  return {
    id,
    name: model ?? description,
    description,
    model,
    color: clean(p.corDescricao) || null,
    storage: clean(p.gbDescricao) || null,
    condition: clean(p.estadoProdutoDescricao) || null,
    battery: num(p.saudeBateria),
    quantity: Math.max(0, num(p.quantidade) ?? 0),
    cost: num(p.valorCusto),
    price: num(p.valorVenda),
    availability,
    available: p.produtoDisponibilidadeId != null ? p.produtoDisponibilidadeId === 1 : /^dispon[ií]vel/i.test(availability),
    mpType: clean(p.tipoProdutoDescricao) || null,
    isAccessory: p.snAcessorio === 1,
    isPart,
    entryDate: p.dataEntrada ?? null,
    updatedAt: p.dataModificacao ?? null,
    imei: clean(p.imei) || null,
    unitTracked: isUnitTracked(p),
  };
}

export function toStockItems(items: EstoqueApiItem[]): StockItem[] {
  return items.map(toStockItem).filter((i): i is StockItem => i != null && i.quantity > 0);
}

/**
 * Item de estoque para a conta de VENDEDOR: lista fechada de campos (nada de custo, IMEI, datas de
 * entrada). Montado campo a campo — um campo novo em StockItem nunca vaza por padrão.
 */
export interface SellerStockItem {
  id: string;
  name: string;
  description: string;
  model: string | null;
  color: string | null;
  storage: string | null;
  condition: string | null;
  battery: number | null;
  quantity: number;
  /** Preço de VENDA por unidade; null = não informado. */
  price: number | null;
  availability: string;
  available: boolean;
  mpType: string | null;
  isAccessory: boolean;
  isPart: boolean;
}

/** Remove IMEI/número de série em qualquer formato ("IMEI2: …", "S/N …", "IMEI 3512…"). */
export function stripIdentifiers(text: string): string {
  return text
    .replace(/\b(IMEI\s*\d?|S\s*\/?\s*N|SERIAL|N[ºo°]?\s*S[EÉ]RIE)\b\s*[:#-]?\s*[A-Z0-9]+/gi, '')
    .replace(/\b\d{14,17}\b/g, '')
    .split(/\s+-\s+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && p !== '.' && p !== '-')
    .join(' - ');
}

export function toSellerStockItem(i: StockItem): SellerStockItem {
  // Aparelho com campos estruturados: descrição montada só deles (o texto livre do MercadoPhone pode
  // trazer IMEI/série ou anotações internas). Senão, texto livre sem identificadores.
  const structured = [i.model, i.color, i.storage].filter(Boolean).join(' - ');
  return {
    id: i.id,
    name: stripIdentifiers(i.name),
    description: i.model ? structured : stripIdentifiers(i.description),
    model: i.model,
    color: i.color,
    storage: i.storage,
    condition: i.condition,
    battery: i.battery,
    quantity: i.quantity,
    price: i.price,
    availability: i.availability,
    available: i.available,
    mpType: i.mpType,
    isAccessory: i.isAccessory,
    isPart: i.isPart,
  };
}
