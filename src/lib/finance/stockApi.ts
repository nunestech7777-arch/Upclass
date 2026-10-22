import { supabase } from '../supabaseClient';
import type { StockItem } from './stockMetrics';

export interface LiveStock {
  items: StockItem[];
  fetchedAt: string;
  /** false = o Mercado Phone não confirmou o total; a lista pode estar incompleta. */
  complete: boolean;
}

/** Estoque atual do MercadoPhone, ao vivo (function mercadophone-estoque; só leitura). */
export async function fetchLiveStock(): Promise<LiveStock> {
  const { data, error } = await supabase.functions.invoke('mercadophone-estoque', { body: {} });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) detail = body.error;
    } catch {
      // resposta sem corpo JSON
    }
    throw new Error(`Não foi possível ler o estoque do Mercado Phone: ${detail}`);
  }
  if (!data?.ok) throw new Error(`Não foi possível ler o estoque do Mercado Phone: ${data?.error ?? 'resposta inválida'}`);
  return { items: data.items as StockItem[], fetchedAt: data.fetched_at as string, complete: data.complete !== false };
}

/**
 * Item de estoque como a conta de VENDEDOR o recebe: a function mercadophone-estoque já remove
 * custo, IMEI e datas no servidor (toSellerStockItem) — nada disso chega ao navegador.
 */
export type SellerStockItem = Omit<StockItem, 'cost' | 'imei' | 'entryDate' | 'updatedAt' | 'unitTracked'>;

export async function fetchSellerStock(): Promise<{ items: SellerStockItem[]; fetchedAt: string; complete: boolean }> {
  const live = await fetchLiveStock();
  return { ...live, items: live.items as unknown as SellerStockItem[] };
}
