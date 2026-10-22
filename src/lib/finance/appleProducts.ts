/**
 * Classificação AUTOMÁTICA de produtos Apple pelo que vem do Mercado Phone (nome do produto,
 * valor pago e, quando a venda já foi conciliada, o `tipoProdutoDescricao` do histórico).
 * Usada só no Forecast — as demais páginas seguem com productClassifier.ts.
 *
 * Regras (validadas com os nomes reais vendidos jul–out/2026):
 * - O tipo vem do INÍCIO do nome ("MACBOOK AIR…", "IPAD 11…", "WATCH S11 APPLE…"), opcionalmente
 *   precedido de "APPLE". A palavra "Apple" sozinha não classifica nada ("CABO ORIGINAL APPLE" e
 *   "FONTE USB-C APPLE 20W" são acessórios).
 * - Nome com palavra de acessório (capa, película, pulseira, cabo…) é acessório compatível, nunca
 *   produto Apple ("CAPA IPAD", "PULSEIRA SMART WATCH").
 * - iPhone segue a regra oficial do sistema (nome começa com "iPhone"), igual à aba Aparelhos.
 * - Nada é classificado por suposição. Vai para REVISÃO (e não conta como produto Apple):
 *   · nome de produto Apple com marcador de réplica ("AIRPODS PRO 1 LINHA") ou valor unitário
 *     abaixo do mínimo plausível para o original ("AIRPODS MAX VOLTS" a R$ 250);
 *   · nome reconhecido como Apple, mas o Mercado Phone marcou a venda como acessório/brinde;
 *   · o Mercado Phone marcou "PRODUTO APPLE", mas o nome não é reconhecido;
 *   · nome com capacidade (GB/TB) sem tipo reconhecido ("15 PLUS - 128 GB", "MCBOOCK AIR M2").
 */
import { isDeviceProduct } from '../productClassifier.ts';

export type AppleType = 'iPhone' | 'MacBook' | 'iPad' | 'Apple Watch' | 'AirPods' | 'iMac' | 'Mac mini' | 'Outros Apple';

/** Ordem de exibição dos tipos. */
export const APPLE_TYPES: AppleType[] = ['iPhone', 'MacBook', 'iPad', 'Apple Watch', 'AirPods', 'iMac', 'Mac mini', 'Outros Apple'];

export type ReviewReason = 'replica' | 'accessory_word' | 'type_conflict' | 'unrecognized_apple' | 'unrecognized_device';

export const REVIEW_LABELS: Record<ReviewReason, string> = {
  replica: 'Nome de produto Apple com indício de réplica/brinde/importação paralela ou valor abaixo do original',
  accessory_word: 'Começa como produto Apple, mas o nome também tem palavra de acessório (ex.: caixa, estojo, case, kit)',
  type_conflict: 'Nome de produto Apple, mas o Mercado Phone registrou como acessório/brinde',
  unrecognized_apple: 'Mercado Phone registrou como produto Apple, mas o nome não foi reconhecido',
  unrecognized_device: 'Parece um aparelho (tem capacidade em GB/TB), mas o tipo não foi reconhecido',
};

export type AppleClassification =
  | { kind: 'apple'; type: AppleType }
  | { kind: 'review'; reason: ReviewReason; type: AppleType | null }
  | { kind: 'other' };

/** Maiúsculas, sem acentos e com espaços simples. */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const ACCESSORY_WORDS =
  /\b(CAPA|CAPAS|CAPINHA|CASE|PELICULA|PELICULAS|PROTETOR|PROTECAO|CABO|FONTE|CARREGADOR|ADAPTADOR|PULSEIRA|SUPORTE|CAIXA|SKIN|BOLSA|ESTOJO|KIT|LENTE|LEANS|SEGURO)\b/;
const REPLICA_WORDS = /\b(1 ?LINHA|1A LINHA|PRIMEIRA LINHA|REPLICA|SIMILAR|PARALELO|BRINDE|GENERICO|PREMIUM|VOLTS?)\b/;
/** Nomenclatura oficial do Apple Watch: "caixa/case de alumínio, aço, titânio" — não é acessório. */
const WATCH_CASE = /\b(CAIXA|CASE) (DE )?(ALUMINIO|ACO|TITANIO)\b/;
const STORAGE = /\b\d+ ?(GB|TB)\b/;
/** Marcas/itens que não são Apple: não vão para a revisão de produtos Apple mesmo tendo GB/TB no nome. */
const NON_APPLE = /\b(SAMSUNG|GALAXY|XIAOMI|REDMI|POCO|REALME|REALMI|MOTOROLA|MOTO|LG|ASUS|LENOVO|INFINIX|TECNO|CARTAO|MEMORIA|PEN ?DRIVE|PENDRIVE|SSD|HD|MICRO ?SD)\b/;

/** Prefixos reconhecidos (no início do nome, com "APPLE" opcional antes). Ordem importa: Mac mini antes de MacBook. */
const RULES: [RegExp, AppleType][] = [
  [/^(APPLE )?MAC ?MINI\b/, 'Mac mini'],
  // Inclui a grafia "MCBOOCK" vista no Mercado Phone (sempre seguida de AIR/PRO/NEO).
  [/^(APPLE )?(MAC ?BOOK|MC ?BOO?C?K (?=AIR|PRO|NEO))\b/, 'MacBook'],
  [/^(APPLE )?IMAC\b/, 'iMac'],
  [/^(APPLE )?IPAD\b/, 'iPad'],
  [/^(APPLE )?AIR ?PODS\b/, 'AirPods'],
  // "WATCH" sozinho é genérico: exige "APPLE" no nome ou uma linha da Apple (S11, SE, ULTRA, SERIES).
  [/^APPLE WATCH\b/, 'Apple Watch'],
  [/^WATCH (S\d{1,2}|SE|ULTRA|SERIES ?\d{1,2})\b/, 'Apple Watch'],
  [/^WATCH\b.*\bAPPLE\b/, 'Apple Watch'],
  [/^(APPLE PENCIL|(APPLE )?AIR ?TAG|(APPLE )?HOMEPOD|APPLE TV|APPLE VISION|VISION PRO|MAGIC (KEYBOARD|MOUSE|TRACKPAD)|APPLE MAGIC|STUDIO DISPLAY|MAC STUDIO|MAC PRO)\b/, 'Outros Apple'],
];

/**
 * Valor unitário mínimo plausível de um ORIGINAL (valor pago). Abaixo disso o item vai para revisão
 * em vez de ser contado como produto Apple — não é classificação por preço, é uma trava de segurança.
 */
export const MIN_UNIT_PRICE: Partial<Record<AppleType, number>> = {
  MacBook: 2500,
  iMac: 4000,
  'Mac mini': 2000,
  iPad: 1500,
  'Apple Watch': 1000,
  AirPods: 600,
  'Outros Apple': 200,
};

const OTHER_PHONE_BRANDS = /\b(SAMSUNG|GALAXY|XIAOMI|REDMI|POCO|REALME|REALMI|MOTOROLA|MOTO|INFINIX|TECNO|ASUS|LG)\b/;

/**
 * Celular de outra marca (POCO, Realme, Samsung…): marca + capacidade no nome. Não é iPhone nem
 * acessório — no Forecast fica fora das duas categorias.
 */
export function isOtherBrandPhone(name: string | null | undefined): boolean {
  const n = normalizeName(name);
  return OTHER_PHONE_BRANDS.test(n) && STORAGE.test(n) && !ACCESSORY_WORDS.test(n);
}

/** Tipo pelo nome (sem olhar valor nem tipo do Mercado Phone); null = não reconhecido. */
export function appleTypeFromName(name: string | null | undefined): AppleType | null {
  if (isDeviceProduct(name)) return 'iPhone';
  const n = normalizeName(name);
  if (!n) return null;
  const type = typeByPrefix(n);
  if (type === 'Apple Watch' && ACCESSORY_WORDS.test(n.replace(WATCH_CASE, ''))) return null;
  if (type !== 'Apple Watch' && ACCESSORY_WORDS.test(n)) return null;
  return type;
}

function typeByPrefix(n: string): AppleType | null {
  for (const [rx, type] of RULES) if (rx.test(n)) return type;
  return null;
}

export interface AppleLine {
  quantity: number;
  amount: number | string;
  /** `tipoProdutoDescricao` do histórico (só em vendas conciliadas): "PRODUTO APPLE", "ACESSORIOS", "BRINDES". */
  product_type?: string | null;
}

/** Classifica UMA linha vendida (o mesmo produto pode ser original numa venda e suspeito em outra). */
export function classifyAppleLine(name: string | null | undefined, line: AppleLine): AppleClassification {
  const type = appleTypeFromName(name);
  // iPhone: regra oficial, idêntica à aba Aparelhos (sem trava de preço).
  if (type === 'iPhone') return { kind: 'apple', type };
  const n = normalizeName(name);
  const mpType = normalizeName(line.product_type);
  if (type) {
    if (REPLICA_WORDS.test(n)) return { kind: 'review', reason: 'replica', type };
    const paid = Number(line.amount) || 0;
    const unit = line.quantity > 0 ? paid / line.quantity : paid;
    const min = MIN_UNIT_PRICE[type];
    if (paid > 0 && min != null && unit < min) return { kind: 'review', reason: 'replica', type };
    if (mpType === 'ACESSORIOS' || mpType === 'BRINDES') return { kind: 'review', reason: 'type_conflict', type };
    return { kind: 'apple', type };
  }
  // Começa como produto Apple mas tem palavra de acessório ("APPLE WATCH … CAIXA ALUMINIO", "AIRPODS 4 COM ESTOJO",
  // "IPAD CAPA"): pode ser o original ou um acessório — revisão, nunca contagem por suposição.
  const prefixType = typeByPrefix(n);
  if (prefixType && ACCESSORY_WORDS.test(n)) return { kind: 'review', reason: 'accessory_word', type: prefixType };
  if (mpType === 'PRODUTO APPLE') return { kind: 'review', reason: 'unrecognized_apple', type: null };
  if (STORAGE.test(n) && !NON_APPLE.test(n) && (Number(line.amount) || 0) > 0) return { kind: 'review', reason: 'unrecognized_device', type: null };
  return { kind: 'other' };
}
