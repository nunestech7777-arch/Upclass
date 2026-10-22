import { supabase } from '../supabaseClient';
import { addDays, STORE_TIME_ZONE } from './dates';
import type { DateRange } from './dashboard';
import type { StockMovement, TurnoverLine } from './stockTurnover';

/** Tamanho de cada consulta à function (limite dela: 400 dias; blocos menores evitam timeout). */
export const CHUNK_DAYS = 180;

/** Itens vendidos no período, ao vivo do histórico do MercadoPhone (function mercadophone-giro; só admin), em blocos. */
export async function fetchTurnoverLines(range: DateRange): Promise<TurnoverLine[]> {
  const out: TurnoverLine[] = [];
  for (let from = range.from; from <= range.to; from = addDays(from, CHUNK_DAYS)) {
    const to = addDays(from, CHUNK_DAYS - 1) < range.to ? addDays(from, CHUNK_DAYS - 1) : range.to;
    // Linhas de uma mesma venda têm o mesmo horário: nunca ficam em blocos diferentes (chaves únicas).
    out.push(...(await fetchChunk({ from, to })));
  }
  return out;
}

async function fetchChunk(range: DateRange): Promise<TurnoverLine[]> {
  const { data, error } = await supabase.functions.invoke('mercadophone-giro', { body: range });
  if (error) {
    let detail = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) detail = body.error;
    } catch {
      if (/not found|404/i.test(detail)) detail = 'function mercadophone-giro ainda não publicada';
    }
    throw new Error(`Não foi possível ler o histórico de vendas: ${detail}`);
  }
  if (!data?.ok) throw new Error(`Não foi possível ler o histórico de vendas: ${data?.error ?? 'resposta inválida'}`);
  return data.lines as TurnoverLine[];
}

const WALL = new Intl.DateTimeFormat('en-CA', {
  timeZone: STORE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Instante → relógio da loja `AAAA-MM-DD HH:mm:ss` (mesmo formato de `dataVenda`). */
export function storeWallClock(iso: string): string {
  const p = Object.fromEntries(WALL.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

/** Entradas/saídas detectadas pela sincronização (migração 0018). `available=false` = migração pendente. */
export async function fetchStockMovements(): Promise<{ movements: StockMovement[]; available: boolean }> {
  const out: StockMovement[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('product_external_id, detected_at, kind, quantity, quantity_after, entry_date, name, product_type')
      .order('id')
      .range(offset, offset + 999);
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') return { movements: [], available: false };
      throw new Error(`Não foi possível ler as entradas de estoque: ${error.message}`);
    }
    for (const m of data ?? [])
      out.push({
        productId: m.product_external_id,
        detectedAt: storeWallClock(m.detected_at),
        kind: m.kind,
        quantity: m.quantity,
        entryDate: m.entry_date,
        quantityAfter: m.quantity_after,
        name: m.name,
        type: m.product_type,
      });
    if ((data ?? []).length < 1000) break;
  }
  return { movements: out, available: true };
}
