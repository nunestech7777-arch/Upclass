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

export interface RetryPolicy {
  /** Esperas entre tentativas (ms); o número de tentativas é delaysMs.length + 1. */
  delaysMs: number[];
  /** Tempo máximo de cada tentativa (ms). */
  timeoutMs: number;
}

/** Padrão (rotinas). Exportado para os testes trocarem as esperas por zero. */
export const retryPolicy: RetryPolicy = { delaysMs: [2_000], timeoutMs: 25_000 };
/** Webhook: mantém o comportamento original (uma tentativa só; o limite de tempo é o da própria
 * function). A rotina de 30 min reconfere o que falhar. */
export const WEBHOOK_POLICY: RetryPolicy = { delaysMs: [], timeoutMs: 120_000 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Falha que vale repetir: rede, tempo esgotado, 429 e 5xx. 4xx (token, parâmetro) não melhora repetindo. */
class RetryableError extends Error {}

async function call(
  className: string,
  method: string,
  body?: Record<string, unknown>,
  httpMethod: 'GET' | 'POST' = 'POST',
  policy: RetryPolicy = retryPolicy
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const url = `${BASE_URL}?class=${className}&method=${method}`;
  const attempts = policy.delaysMs.length + 1;
  for (let attempt = 1; ; attempt++) {
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: httpMethod,
          headers: {
            Authorization: getToken(),
            'Content-Type': 'application/json',
          },
          body: httpMethod === 'POST' ? JSON.stringify(body ?? {}) : undefined,
          signal: AbortSignal.timeout(policy.timeoutMs),
        });
      } catch (err) {
        throw new RetryableError(`MercadoPhone API ${className}.${method}: falha de rede/tempo esgotado (${String(err)})`);
      }
      if (!res.ok) {
        const message = `MercadoPhone API ${className}.${method} failed: ${res.status} ${await res.text()}`;
        if (res.status === 429 || res.status >= 500) throw new RetryableError(message);
        throw new Error(message);
      }
      try {
        return await res.json();
      } catch (err) {
        throw new RetryableError(`MercadoPhone API ${className}.${method}: resposta não é JSON (${String(err)})`);
      }
    } catch (err) {
      if (!(err instanceof RetryableError) || attempt >= attempts) {
        throw err instanceof RetryableError ? new Error(`${err.message} — após ${attempt} tentativa(s)`) : err;
      }
      await sleep(policy.delaysMs[attempt - 1]);
    }
  }
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
 * datas, então a paginação para na primeira página incompleta. Resposta sem `data.itens` lança erro
 * (histórico incompleto nunca é tratado como vazio); falhas transitórias são repetidas (ver `call`).
 */
export async function fetchHistoricoVendas(
  dataInicial: string,
  dataFinal: string,
  concurrency = 1,
  policy: RetryPolicy = retryPolicy
): Promise<HistoricoVendaRow[]> {
  const items: HistoricoVendaRow[] = [];
  const limit = 300;
  const page = async (n: number): Promise<HistoricoVendaRow[]> => {
    const res = await call('HistoricoVendaApiController', 'index', {
      page: n,
      limit,
      order: 'data_venda',
      direction: 'asc',
      filters: { dataVendaInicial: dataInicial, dataVendaFinal: dataFinal },
    }, 'POST', policy);
    // Resposta sem a lista é inválida — nunca é "dia sem vendas" (a API devolve itens: [] nesse caso).
    // Tratá-la como vazia faria a conciliação marcar linhas válidas como ausentes ou removidas.
    const pageItems = res?.data?.itens;
    if (!Array.isArray(pageItems)) {
      throw new Error(`MercadoPhone API HistoricoVendaApiController.index: resposta sem data.itens (página ${n}, ${dataInicial}..${dataFinal})`);
    }
    return pageItems;
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
