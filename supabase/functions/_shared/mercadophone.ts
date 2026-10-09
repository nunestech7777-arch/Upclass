import type { HistoricoItem } from './itemSellers.ts';

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

/** Estoque tem centenas de itens no máximo — pagina até esgotar. */
export async function fetchAllEstoque(): Promise<MercadoPhoneProduct[]> {
  const items: MercadoPhoneProduct[] = [];
  let page = 1;
  const limit = 300;
  // deno-lint-ignore no-constant-condition
  while (true) {
    const res = await call('EstoqueApiController', 'index', {
      page,
      limit,
      order: 'id',
      direction: 'desc',
      filters: {},
    });
    const pageItems: MercadoPhoneProduct[] = res?.data?.itens ?? [];
    items.push(...pageItems);
    const total: number = res?.data?.totalItens ?? items.length;
    if (pageItems.length === 0 || items.length >= total) break;
    page += 1;
  }
  return items;
}

export async function fetchAllVendedores(): Promise<MercadoPhoneSeller[]> {
  const res = await call('VendedorApiController', 'index', undefined, 'GET');
  return res?.data?.itens ?? [];
}

/**
 * Histórico de vendas, uma linha por item, com o vendedor de cada item. Datas no horário da loja
 * (`YYYY-MM-DD HH:mm:ss`), como o MercadoPhone as grava. O limite por página da API é 300.
 */
export async function fetchHistoricoVendas(dataInicial: string, dataFinal: string): Promise<HistoricoItem[]> {
  const items: HistoricoItem[] = [];
  const limit = 300;
  for (let page = 1; ; page += 1) {
    const res = await call('HistoricoVendaApiController', 'index', {
      page,
      limit,
      order: 'data_venda',
      direction: 'asc',
      filters: { dataVendaInicial: dataInicial, dataVendaFinal: dataFinal },
    });
    const pageItems: HistoricoItem[] = res?.data?.itens ?? [];
    items.push(...pageItems);
    if (pageItems.length < limit) break;
  }
  return items;
}
