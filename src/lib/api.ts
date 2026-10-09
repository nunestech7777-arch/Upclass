import { supabase } from './supabaseClient';
import { classifyProductCategory } from './productClassifier';
import { parseSaleExternalId, parseSaleOrderDetails } from './saleDetails';
import type { SaleOrderDetails, SaleOrderEventRow } from './saleDetails';
import type {
  Seller,
  Product,
  Sale,
  Conversation,
  ConversationMessage,
  Goals,
  PanelSettings,
  KommoUser,
} from './database.types';

const PAGE_SIZE = 1000;

const PAGE_BATCH = 4;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * O Supabase corta qualquer select em 1000 linhas por padrão — pagina até esgotar.
 * A 1ª página vai sozinha (a maioria das consultas cabe nela); se vier cheia, as
 * seguintes são buscadas em paralelo, em lotes, em vez de uma por vez.
 */
async function fetchAllRows<T>(queryPage: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const fetchPage = async (page: number): Promise<T[]> => {
    const from = page * PAGE_SIZE;
    const { data, error } = await queryPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const rows = await fetchPage(0);
  if (rows.length < PAGE_SIZE) return rows;

  for (let page = 1; ; page += PAGE_BATCH) {
    const batch = await Promise.all(Array.from({ length: PAGE_BATCH }, (_, i) => fetchPage(page + i)));
    for (const pageRows of batch) rows.push(...pageRows);
    if (batch.some((pageRows) => pageRows.length < PAGE_SIZE)) return rows;
  }
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();

/** Reaproveita por 1 min listas grandes que várias telas pedem iguais (e junta chamadas simultâneas). */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise as Promise<T>;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export async function fetchSellers(): Promise<Seller[]> {
  return fetchAllRows<Seller>((from, to) =>
    supabase.from('sellers').select('*').order('name').range(from, to)
  );
}

export async function fetchSellerById(id: string): Promise<Seller> {
  const { data, error } = await supabase.from('sellers').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** Vendedores com o toggle "aparecer no ranking" ligado — usado em Vendedores, Dashboard, Painel TV e Previsão. */
export async function fetchVisibleSellers(): Promise<Seller[]> {
  return fetchAllRows<Seller>((from, to) =>
    supabase.from('sellers').select('*').eq('show_in_ranking', true).order('name').range(from, to)
  );
}

export async function updateSellerRankingVisibility(id: string, show_in_ranking: boolean): Promise<void> {
  const { error } = await supabase.from('sellers').update({ show_in_ranking }).eq('id', id);
  if (error) throw error;
}

/** Usuários do Kommo sincronizados via kommo-sync — usados para o mapeamento manual vendedor ↔ usuário Kommo. */
export async function fetchKommoUsers(): Promise<KommoUser[]> {
  return fetchAllRows<KommoUser>((from, to) =>
    supabase.from('kommo_users').select('*').order('name').range(from, to)
  );
}

export async function updateSellerKommoMapping(id: string, kommo_user_id: string | null): Promise<void> {
  const { error } = await supabase.from('sellers').update({ kommo_user_id }).eq('id', id);
  if (error) throw error;
}

export async function fetchProducts(): Promise<Product[]> {
  return cached('products', () =>
    fetchAllRows<Product>((from, to) =>
      supabase.from('products').select('*').order('name').order('id').range(from, to)
    )
  );
}

export async function insertProduct(input: {
  name: string;
  category: 'Aparelhos' | 'Acessórios';
  brand: string | null;
  location: string | null;
  stock: number;
  min_stock: number;
  price: number;
  imei: string | null;
  battery_health: string | null;
}): Promise<Product> {
  const code = `EST-${Date.now().toString(36).toUpperCase()}`;
  const { data, error } = await supabase
    .from('products')
    .insert({ ...input, code })
    .select()
    .single();
  if (error) throw error;
  cache.delete('products');
  return data;
}

export async function updateProductStock(id: string, stock: number): Promise<void> {
  const { error } = await supabase.from('products').update({ stock }).eq('id', id);
  if (error) throw error;
  cache.delete('products');
}

export async function fetchSalesInRange(start: Date, end: Date): Promise<Sale[]> {
  return fetchAllRows<Sale>((from, to) =>
    supabase
      .from('sales')
      .select('*')
      .gte('sold_at', start.toISOString())
      .lt('sold_at', end.toISOString())
      .order('sold_at')
      .order('id')
      .range(from, to)
  );
}

/** Todas as vendas já registradas na plataforma, mais recentes primeiro. */
export async function fetchAllSales(): Promise<Sale[]> {
  return fetchAllRows<Sale>((from, to) =>
    supabase.from('sales').select('*').order('sold_at', { ascending: false }).order('id').range(from, to)
  );
}

// Só os campos exibidos no modal — CPF, endereço e contato do cliente ficam fora da consulta.
const SALE_ORDER_SELECT = [
  'order_id:payload->>id',
  'customer_name:payload->cliente->>nome',
  'seller_name:payload->>vendedorNome',
  'status:payload->>status',
  'sale_type:payload->>tipoVendaDescricao',
  'delivery_type:payload->>tipoEntregaDescricao',
  'sales_channel:payload->>canalVendaDescricao',
  'discount:payload->>desconto',
  'total:payload->>totalVenda',
  'canceled_at:payload->>dataCancelamento',
  'cancel_reason:payload->>motivoCancelamento',
  'items:payload->itens',
  'payments:payload->formasPagamento',
].join(', ');

/**
 * Detalhes da venda (cliente, pagamentos, itens e vendedor de cada item) no último `venda_salva` que o MercadoPhone
 * enviou para ela. Devolve `null` quando não há payload guardado — caso das vendas importadas
 * antes do webhook. O filtro por `tipoEvento` é obrigatório: ordens de serviço usam a mesma
 * tabela e têm numeração de `id` própria.
 */
export async function fetchSaleOrderDetails(externalId: string | null): Promise<SaleOrderDetails | null> {
  const ref = parseSaleExternalId(externalId);
  if (!ref) return null;

  const [event, orderSales] = await Promise.all([
    supabase
      .from('mercadophone_webhook_events')
      .select(SALE_ORDER_SELECT)
      .eq('payload->>id', ref.orderId)
      .eq('payload->>tipoEvento', 'venda_salva')
      .order('received_at', { ascending: false })
      .limit(1),
    // Cada item da venda é uma linha de `sales` com o seu próprio vendedor.
    supabase.from('sales').select('external_id, seller_id').like('external_id', `${ref.orderId}-%`),
  ]);
  if (event.error) throw new Error(event.error.message);
  if (orderSales.error) throw new Error(orderSales.error.message);

  const row = (event.data as unknown as SaleOrderEventRow[] | null)?.[0];
  return row ? parseSaleOrderDetails(row, ref, orderSales.data ?? []) : null;
}

/** Só as colunas usadas nos rankings e no modal de vendas — `raw_payload` e a análise completa ficam de fora. */
export type ConversationSummary = Pick<
  Conversation,
  'id' | 'seller_id' | 'result_type' | 'occurred_at' | 'product' | 'client_name'
>;

export async function fetchAllConversations(): Promise<ConversationSummary[]> {
  return cached('conversations', () =>
    fetchAllRows<ConversationSummary>((from, to) =>
      supabase
        .from('conversations')
        .select('id, seller_id, result_type, occurred_at, product, client_name')
        .order('id')
        .range(from, to)
    )
  );
}

export async function fetchConversationsBySeller(sellerId: string): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('seller_id', sellerId)
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Timeline da conversa em ordem cronológica estável (ver compareTimeline em transcript.ts). */
export type TimelineMessage = Pick<
  ConversationMessage,
  'id' | 'external_id' | 'sender' | 'sender_name' | 'message' | 'message_type' | 'sent_at' | 'received_seq'
>;

export async function fetchConversationMessages(conversationId: string): Promise<TimelineMessage[]> {
  return fetchAllRows<TimelineMessage>((from, to) =>
    supabase
      .from('conversation_messages')
      .select('id, external_id, sender, sender_name, message, message_type, sent_at, received_seq')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
      .order('received_seq', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  );
}

export async function fetchGoals(): Promise<Goals> {
  const { data, error } = await supabase.from('goals').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}

export async function updateGoals(patch: Partial<Omit<Goals, 'id' | 'updated_at'>>): Promise<void> {
  const { error } = await supabase
    .from('goals')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
}

export async function fetchPanelSettings(): Promise<PanelSettings> {
  const { data, error } = await supabase.from('panel_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}

export async function updatePanelSettings(
  patch: Partial<Omit<PanelSettings, 'id' | 'updated_at'>>
): Promise<void> {
  const { error } = await supabase
    .from('panel_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
}

export { 
  classifyProductCategory, 
  isDeviceProduct, 
  isCountableAccessorySale, 
  isCountableSale 
} from './productClassifier';

export interface SellerPerformance {
  seller: Seller;
  sold: number;
  devicesSold: number;
  accessoriesSold: number;
  conversion: number;
}

/** Sold units come from `sales`; conversion comes from `conversations` (0 when the seller has none yet). */
export function computeSellerPerformance(
  sellers: Seller[],
  sales: Sale[],
  conversations: Pick<Conversation, 'seller_id' | 'result_type'>[],
  products?: Product[]
): SellerPerformance[] {
  const soldBySeller = new Map<string, number>();
  const devicesSoldBySeller = new Map<string, number>();
  const accessoriesSoldBySeller = new Map<string, number>();
  const productMap = products ? new Map(products.map((p) => [p.id, p])) : null;

  for (const sale of sales) {
    const qty = sale.quantity;
    const amount = Number(sale.amount) || 0;

    if (productMap) {
      const prod = productMap.get(sale.product_id);
      if (prod) {
        const category = classifyProductCategory(prod.name);
        if (category === 'Aparelhos') {
          devicesSoldBySeller.set(sale.seller_id, (devicesSoldBySeller.get(sale.seller_id) ?? 0) + qty);
          soldBySeller.set(sale.seller_id, (soldBySeller.get(sale.seller_id) ?? 0) + qty);
        } else if (category === 'Acessórios') {
          // Acessórios só contam se tiverem valor de venda > 0 (brindes/cortesias zerados não entram)
          if (amount > 0) {
            accessoriesSoldBySeller.set(sale.seller_id, (accessoriesSoldBySeller.get(sale.seller_id) ?? 0) + qty);
            soldBySeller.set(sale.seller_id, (soldBySeller.get(sale.seller_id) ?? 0) + qty);
          }
        }
      } else {
        if (amount > 0) {
          soldBySeller.set(sale.seller_id, (soldBySeller.get(sale.seller_id) ?? 0) + qty);
        }
      }
    } else {
      if (amount > 0) {
        soldBySeller.set(sale.seller_id, (soldBySeller.get(sale.seller_id) ?? 0) + qty);
      }
    }
  }

  const conversationStatsBySeller = new Map<string, { success: number; total: number }>();
  for (const conv of conversations) {
    if (!conv.seller_id) continue;
    const stats = conversationStatsBySeller.get(conv.seller_id) ?? { success: 0, total: 0 };
    stats.total += 1;
    if (conv.result_type === 'success') stats.success += 1;
    conversationStatsBySeller.set(conv.seller_id, stats);
  }

  return sellers.map((seller) => {
    const stats = conversationStatsBySeller.get(seller.id);
    return {
      seller,
      sold: soldBySeller.get(seller.id) ?? 0,
      devicesSold: devicesSoldBySeller.get(seller.id) ?? 0,
      accessoriesSold: accessoriesSoldBySeller.get(seller.id) ?? 0,
      conversion: stats && stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0,
    };
  });
}

export function getMonthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

/** Week starts on Monday. */
export function getWeekRange(date: Date): { start: Date; end: Date } {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diffToMonday);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { start, end };
}

export function getDayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { start, end };
}

/** Atualiza a URL da foto do vendedor na tabela `sellers` */
export async function updateSellerPhoto(sellerId: string, photo_url: string | null): Promise<void> {
  const { error } = await supabase.from('sellers').update({ photo_url }).eq('id', sellerId);
  if (error) throw error;
}

/**
 * Processa e otimiza uma imagem no cliente (Canvas API):
 * - Valida se é imagem
 * - Redimensiona para quadrado centralizado de até maxDim x maxDim
 * - Exporta WebP/JPEG de alta qualidade e tamanho ultra-reduzido
 */
export async function processAndOptimizeImage(
  file: File,
  maxDim = 400
): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('O arquivo selecionado não é uma imagem válida.'));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo de imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Falha ao carregar a imagem para processamento.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calcula crop centralizado quadrado
        const minSide = Math.min(width, height);
        const startX = (width - minSide) / 2;
        const startY = (height - minSide) / 2;

        const targetDim = Math.min(maxDim, minSide);
        canvas.width = targetDim;
        canvas.height = targetDim;

        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Não foi possível obter o contexto 2D do Canvas.'));

        // Renderiza com suavização
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, startX, startY, minSide, minSide, 0, 0, targetDim, targetDim);

        // Tenta WebP, fallback para JPEG
        let mime = 'image/webp';
        let dataUrl = canvas.toDataURL(mime, 0.88);
        if (!dataUrl.startsWith('data:image/webp')) {
          mime = 'image/jpeg';
          dataUrl = canvas.toDataURL(mime, 0.88);
        }

        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('Falha ao gerar o blob da imagem.'));
            resolve({ blob, dataUrl });
          },
          mime,
          0.88
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Faz upload do avatar do vendedor para o Supabase Storage ou salva como Data-URL otimizada.
 * Atualiza o registro do vendedor no banco de dados.
 */
export async function uploadSellerAvatar(sellerId: string, file: File): Promise<string> {
  const { blob, dataUrl } = await processAndOptimizeImage(file, 400);

  let finalPhotoUrl = dataUrl;

  try {
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${sellerId}-${Date.now()}.${ext}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('seller-avatars')
      .upload(fileName, blob, {
        contentType: blob.type,
        upsert: true,
      });

    if (!uploadError && uploadData) {
      const { data: pubData } = supabase.storage.from('seller-avatars').getPublicUrl(fileName);
      if (pubData?.publicUrl) {
        finalPhotoUrl = pubData.publicUrl;
      }
    }
  } catch (err) {
    console.warn('Storage upload fallback to optimized data-url:', err);
  }

  // Atualiza no banco
  await updateSellerPhoto(sellerId, finalPhotoUrl);
  return finalPhotoUrl;
}

