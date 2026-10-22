import type { HistoricoItem } from './itemSellers.ts';
import type { HistoricoFinanceItem } from './financialReconcile.ts';

/** Linha do histórico de vendas: vendedor do item + valores financeiros da linha. */
export type HistoricoVendaRow = HistoricoItem & HistoricoFinanceItem;

const BASE_URL = 'https://app.mercadophone.tech/api.php';

function getToken(): string {
  const token = Deno.env.get('MERCADOPHONE_API_TOKEN');
  if (!token) throw new Error('MERCADOPHONE_API_TOKEN not set');
  return token;
}

async function call(
  className: string,
  method: string,
  body?: Record<string, unknown>,
  httpMethod: 'GET' | 'POST' = 'POST'
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const url = `${BASE_URL}?class=${className}&method=${method}`;
  const res = await fetch(url, {
    method: httpMethod,
    headers: {
      Authorization: getToken(),
      'Content-Type': 'application/json',
    },
    body: httpMethod === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!res.ok) {
    throw new Error(`MercadoPhone API ${className}.${method} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface MercadoPhoneProduct {
  id: number;
  aparelhoDescricao: string | null;
  descricao: string;
  imei: string | null;
  saudeBateria: number | null;
  quantidade: number;
  quantidadeMinima: number | null;
  valorVenda: number;
  snAcessorio: number;
  snPeca: number;
  snServico: number;
  snBike: number;
}

export interface MercadoPhoneSeller {
  id: number;
  nome: string;
  snAtivo: number;
}

export interface EstoqueSnapshot {
  items: MercadoPhoneProduct[];
  /** totalItens informado pela API; null se não veio. */
  total: number | null;
  /** true só quando a API informou o total e todos os itens chegaram — condição para zerar estoque. */
  complete: boolean;
}

/** Estoque atual, paginado até esgotar, dizendo se a lista veio completa. */
export async function fetchEstoqueSnapshot(): Promise<EstoqueSnapshot> {
  const items: MercadoPhoneProduct[] = [];
  let page = 1;
  const limit = 300;
  let total: number | null = null;
  let malformed = false;
  // deno-lint-ignore no-constant-condition
  while (true) {
    const res = await call('EstoqueApiController', 'index', {
      page,
      limit,
      order: 'id',
      direction: 'desc',
      filters: {},
    });
    const pageItems = res?.data?.itens;
    if (!Array.isArray(pageItems)) {
      // Resposta 200 sem lista: não é "estoque vazio", é resposta inválida.
      malformed = true;
      break;
    }
    items.push(...pageItems);
    const reported = Number(res?.data?.totalItens);
    if (Number.isFinite(reported)) total = reported;
    if (pageItems.length === 0 || items.length >= (total ?? items.length)) break;
    page += 1;
  }
  return { items, total, complete: !malformed && total != null && items.length >= total };
}

/** Estoque tem centenas de itens no máximo — pagina até esgotar. */
export async function fetchAllEstoque(): Promise<MercadoPhoneProduct[]> {
  return (await fetchEstoqueSnapshot()).items;
}

export async function fetchAllVendedores(): Promise<MercadoPhoneSeller[]> {
  const res = await call('VendedorApiController', 'index', undefined, 'GET');
  return res?.data?.itens ?? [];
}

/**
 * Histórico de vendas, uma linha por item, com o vendedor, a receita (`valorTotal`), o custo
 * (`valorCusto`) e o lucro da linha. Datas no horário da loja (`YYYY-MM-DD HH:mm:ss`), como o
 * MercadoPhone as grava. O limite por página da API é 300; `totalItens` não respeita o filtro de
 * datas, então a paginação para na primeira página incompleta.
 */
export async function fetchHistoricoVendas(dataInicial: string, dataFinal: string, concurrency = 1): Promise<HistoricoVendaRow[]> {
  const items: HistoricoVendaRow[] = [];
  const limit = 300;
  const page = async (n: number): Promise<HistoricoVendaRow[]> => {
    const res = await call('HistoricoVendaApiController', 'index', {
      page: n,
      limit,
      order: 'data_venda',
      direction: 'asc',
      filters: { dataVendaInicial: dataInicial, dataVendaFinal: dataFinal },
    });
    return res?.data?.itens ?? [];
  };
  // `concurrency` > 1 busca páginas em lotes paralelos (a API leva ~2,5 s por página); a ordem final
  // é a das páginas e a busca para no primeiro lote com página incompleta.
  const step = Math.max(1, Math.floor(concurrency));
  for (let first = 1; ; first += step) {
    const pages = await Promise.all(Array.from({ length: step }, (_, i) => page(first + i)));
    let done = false;
    for (const pageItems of pages) {
      if (done) break;
      items.push(...pageItems);
      if (pageItems.length < limit) done = true;
    }
    if (done) break;
  }
  return items;
}
