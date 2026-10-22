/**
 * Classifica um produto vendido em 'Aparelhos' ou 'Acessórios'.
 * Regra oficial:
 * - 'Aparelhos': produtos cujo nome começa com 'IPHONE' (case-insensitive, trimmed) — e também os
 *   iPhones cadastrados no Mercado Phone SEM a palavra "iPhone", reconhecidos com segurança por
 *   modelo + capacidade (ex.: "15 PLUS - 128 GB - PINK", "CASE MAGSAFE 15 PRO MAX - 256 GB - NATURAL").
 * - 'Acessórios': qualquer outro produto (ex: iPad, Watch, AirPods, Capas, etc.).
 */
export function classifyProductCategory(productName: string | null | undefined): 'Aparelhos' | 'Acessórios' {
  return isDeviceProduct(productName) ? 'Aparelhos' : 'Acessórios';
}

const normalize = (v: string | null | undefined) =>
  (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** Modelo de iPhone (11 a 19, com Pro Max/Pro/Plus/Mini/E) no início do nome, com até 2 palavras antes. */
const UNNAMED_IPHONE_MODEL = /^(?:[A-Z]+ ){0,2}(1[1-9])(?: (PRO MAX|PRO|PLUS|MINI|E))?(?= |$| -)/;
const STORAGE = /\b\d+ ?(GB|TB)\b/;
/** Outros produtos (Apple ou não) que também têm número + capacidade no nome. */
const NOT_IPHONE = /\b(IPAD|MAC ?BOOK|MCBOOCK|MAC|IMAC|WATCH|AIR ?PODS|SAMSUNG|GALAXY|XIAOMI|REDMI|POCO|REALME|REALMI|MOTOROLA|MOTO|LG|ASUS|LENOVO|INFINIX|TECNO|NOTE|CAPA|CAPINHA|PELICULA|CARTAO|MEMORIA|PEN ?DRIVE|SSD|HD)\b/;

/** Retorna true se o produto é um aparelho (iPhone). */
export function isDeviceProduct(productName: string | null | undefined): boolean {
  const n = normalize(productName);
  if (n.startsWith('IPHONE')) return true;
  // iPhone cadastrado sem a palavra "iPhone": precisa de modelo E capacidade, e nada que indique outro produto.
  return UNNAMED_IPHONE_MODEL.test(n) && STORAGE.test(n) && !NOT_IPHONE.test(n);
}

/**
 * Retorna true se a venda de um acessório deve ser contabilizada nas métricas e rankings.
 * Regra obrigatória:
 * - NÃO pode começar com 'iPhone' (deve ser acessório).
 * - O valor de venda (amount) DEVE ser maior que 0.
 * - Brindes, cortesias ou itens com valor R$ 0,00 NUNCA são contabilizados como acessório vendido.
 */
export function isCountableAccessorySale(
  sale: { amount?: number | string | null; quantity?: number },
  productName?: string | null | undefined
): boolean {
  if (isDeviceProduct(productName)) {
    return false;
  }
  const amount = Number(sale?.amount) || 0;
  if (amount <= 0) {
    return false;
  }
  return true;
}

/**
 * Retorna true se a venda deve ser contabilizada nas metas e rankings gerais:
 * - Se for Aparelho (iPhone): sempre conta.
 * - Se for Acessório: somente conta se amount > 0 (não é brinde/cortesia zerada).
 */
export function isCountableSale(
  sale: { amount?: number | string | null; quantity?: number },
  productName?: string | null | undefined
): boolean {
  const isDevice = isDeviceProduct(productName);
  if (isDevice) return true;
  return isCountableAccessorySale(sale, productName);
}
