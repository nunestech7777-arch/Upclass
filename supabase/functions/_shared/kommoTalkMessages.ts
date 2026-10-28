/**
 * Histórico oficial de um talk — GET /api/v4/talks/{talk_id}/messages. Normalização pura (sem
 * Deno/Supabase) para ser testada com `node --test` (ver kommoTalkMessages.test.ts).
 *
 * Diferente do webhook (que só entrega as mensagens recebidas) e da events API (que não traz texto),
 * este endpoint devolve as duas direções com texto, autor e anexos:
 *   id, chat_id, type ("incoming" | "outgoing"), message_type (text, voice, picture, file...),
 *   author { id, type: internal | external | bot, name, user_id (só internal) },
 *   text, created_at (unix s), sec_created_at (ms), origin, attachment { type, link, file_name }
 */
import { normalizeKommoMessage, type NormalizeResult, type SenderType } from './kommoMessage.ts';

export interface KommoTalkApiMessage {
  id?: string | number;
  chat_id?: string;
  type?: string;
  message_type?: string;
  author?: { id?: string; type?: string; name?: string; avatar_url?: string; user_id?: number | string };
  text?: string;
  created_at?: number | string;
  sec_created_at?: number | string;
  origin?: string;
  attachment?: { type?: string; link?: string; file_name?: string } | null;
}

/** Contexto do talk: a API de mensagens não informa lead/contato, só o chat. */
export interface TalkContext {
  talk_id: string;
  chat_id: string | null;
  contact_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
}

/** Nome gravado quando o Kommo não identifica quem enviou uma mensagem outgoing. */
export const UNIDENTIFIED_AUTHOR = 'Autor não identificado';

/**
 * Quem enviou, pelo author.type documentado — nunca "toda outgoing é do vendedor":
 * internal = usuário Kommo (vendedor), bot = bot do Kommo, external/incoming = cliente.
 * Outgoing sem autor reconhecível vira 'system' com identified = false (não inventa autor).
 */
export function classifyTalkMessageSender(m: KommoTalkApiMessage): { sender: SenderType; identified: boolean } {
  const direction = (m.type ?? '').toLowerCase();
  const authorType = (m.author?.type ?? '').toLowerCase();
  if (direction === 'incoming') return { sender: 'client', identified: true };
  if (authorType === 'internal') return { sender: 'seller', identified: true };
  if (authorType === 'bot') return { sender: 'bot', identified: true };
  if (!direction && authorType === 'external') return { sender: 'client', identified: true };
  return { sender: 'system', identified: false };
}

/**
 * A API identificou o autor o suficiente para substituir o do marcador? Vendedor sem user_id não:
 * o marcador já tem o created_by da events API, que é o mesmo id de usuário Kommo.
 */
export function talkMessageAuthorIdentified(m: KommoTalkApiMessage): boolean {
  const { sender, identified } = classifyTalkMessageSender(m);
  return identified && !(sender === 'seller' && !clean(m.author?.user_id));
}

function clean(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '0' ? null : s;
}

/** Converte uma mensagem da API para o mesmo formato normalizado do webhook (kommo_ingest_message). */
export function normalizeTalkMessage(
  m: KommoTalkApiMessage,
  talk: TalkContext,
  receivedAt: Date,
  source = 'talk_messages_api'
): NormalizeResult {
  const apiMessageType = clean(m.message_type)?.toLowerCase() ?? null;
  // Áudio, imagem, localização etc. podem vir sem texto: o tipo da mensagem conta como conteúdo.
  const attachmentType = clean(m.attachment?.type) ?? (apiMessageType && apiMessageType !== 'text' ? apiMessageType : null);
  // sec_created_at (ms) desempata mensagens do mesmo segundo — só quando é o mesmo instante de created_at.
  const ms = Number(m.sec_created_at);
  const preciseCreatedAt = Number.isFinite(ms) && Math.floor(ms / 1000) === Number(m.created_at) ? ms : m.created_at;
  const result = normalizeKommoMessage(
    {
      id: clean(m.id) ?? undefined,
      chat_id: talk.chat_id ?? clean(m.chat_id) ?? undefined,
      talk_id: talk.talk_id,
      contact_id: talk.contact_id ?? undefined,
      text: typeof m.text === 'string' ? m.text : '',
      created_at: preciseCreatedAt,
      entity_type: talk.entity_type ?? undefined,
      entity_id: talk.entity_id ?? undefined,
      type: m.type,
      origin: m.origin,
      author: m.author ? { id: m.author.id, type: m.author.type, name: m.author.name } : undefined,
      attachment: attachmentType ? { ...(m.attachment ?? {}), type: attachmentType } : undefined,
    },
    receivedAt
  );
  if (!result.ok) return result;

  const { sender, identified } = classifyTalkMessageSender(m);
  const value = result.value;
  value.sender_type = sender;
  // sender_id de vendedor = id do usuário Kommo (mesmo valor de sellers.kommo_user_id e do created_by dos marcadores).
  value.sender_id = sender === 'seller' ? clean(m.author?.user_id) : clean(m.author?.id);
  value.sender_name = identified ? clean(m.author?.name) ?? (sender === 'bot' ? 'Bot' : null) : UNIDENTIFIED_AUTHOR;
  // "text" com texto vazio e anexo: o tipo do anexo descreve melhor a mensagem.
  value.message_type = apiMessageType === 'text' && !m.text?.trim() && attachmentType ? attachmentType : apiMessageType ?? value.message_type;
  value.created_at_original = m.created_at === undefined || m.created_at === null ? null : String(m.created_at);
  value.raw_payload = { ...(m as Record<string, unknown>), _source: source } as typeof value.raw_payload;
  return { ok: true, value };
}

/** Item de outgoing_message[add] (webhook add_outgoing_message): o próprio item traz talk, lead e contato. */
export interface KommoOutgoingWebhookMessage extends KommoTalkApiMessage {
  talk_id?: string | number;
  contact_id?: string | number;
  entity_type?: string;
  entity_id?: string | number;
}

/**
 * Mensagem enviada pelo Kommo (webhook add_outgoing_message). O autor segue a mesma regra do histórico:
 * internal = vendedor (sender_id = user_id), bot = bot (user_id "0" ignorado), resto = não identificado.
 */
export function normalizeOutgoingWebhookMessage(m: KommoOutgoingWebhookMessage, receivedAt: Date): NormalizeResult {
  return normalizeTalkMessage(
    m,
    {
      talk_id: clean(m.talk_id) ?? '',
      chat_id: clean(m.chat_id),
      contact_id: clean(m.contact_id),
      entity_type: clean(m.entity_type),
      entity_id: clean(m.entity_id),
    },
    receivedAt,
    'outgoing_webhook'
  );
}

/** Linha já gravada que importa para decidir o que gravar. */
export interface StoredTalkRow {
  external_id: string | null;
  message_type: string;
}

export interface TalkIngestPlan {
  /** Mensagens novas ou que substituem um marcador ('unavailable'), em ordem cronológica. */
  toIngest: KommoTalkApiMessage[];
  /** Já gravadas com conteúdo real (webhook ou sync anterior): não são reescritas. */
  alreadyStored: number;
  placeholdersFilled: number;
  duplicatesInResponse: number;
  /**
   * O talk tem mensagens reais gravadas no intervalo devolvido pela API, mas nenhuma delas tem id da
   * API: os ids não são do mesmo espaço e gravar duplicaria a conversa. O sync não grava nada.
   * (Bater só com marcadores não prova nada: eles vêm da events API, não do webhook.)
   */
  idMismatch: boolean;
}

/**
 * `stored` = linhas com os mesmos ids da API + linhas reais do talk dentro do intervalo de horário
 * devolvido pela API (para detectar ids de outro espaço).
 */
export function planTalkIngest(apiMessages: KommoTalkApiMessage[], stored: StoredTalkRow[]): TalkIngestPlan {
  const byId = new Map(stored.filter((s) => s.external_id).map((s) => [s.external_id!, s.message_type]));
  const plan: TalkIngestPlan = { toIngest: [], alreadyStored: 0, placeholdersFilled: 0, duplicatesInResponse: 0, idMismatch: false };
  const seen = new Set<string>();
  let realOverlap = 0;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const ordered = [...(apiMessages ?? [])].sort(
    (a, b) => num(a.created_at) - num(b.created_at) || num(a.sec_created_at) - num(b.sec_created_at)
  );
  for (const m of ordered) {
    const id = clean(m.id);
    if (!id) {
      plan.toIngest.push(m); // vira 'skipped: missing_message_id' na normalização, fica no resumo
      continue;
    }
    if (seen.has(id)) {
      plan.duplicatesInResponse += 1;
      continue;
    }
    seen.add(id);
    const storedType = byId.get(id);
    if (storedType !== undefined && storedType !== 'unavailable') realOverlap += 1;
    if (storedType === undefined) plan.toIngest.push(m);
    else if (storedType === 'unavailable') {
      plan.toIngest.push(m);
      plan.placeholdersFilled += 1;
    } else plan.alreadyStored += 1;
  }
  const realStored = stored.filter((s) => s.message_type !== 'unavailable').length;
  if (realStored > 0 && realOverlap === 0 && seen.size > 0) {
    plan.idMismatch = true;
    plan.toIngest = [];
    plan.placeholdersFilled = 0;
  }
  return plan;
}

export type TalkFetchFailure = 'token_invalid' | 'payment_required' | 'forbidden' | 'talk_not_found' | 'other';

/** Como tratar um erro HTTP da API de mensagens (códigos documentados pelo Kommo). */
export function classifyTalkFetchError(status: number): { kind: TalkFetchFailure; blocksAll: boolean } {
  if (status === 401) return { kind: 'token_invalid', blocksAll: true }; // token expirado/revogado
  if (status === 402) return { kind: 'payment_required', blocksAll: true }; // plano/assinatura
  if (status === 403) return { kind: 'forbidden', blocksAll: true }; // falta "External chat history" ou direitos
  if (status === 404) return { kind: 'talk_not_found', blocksAll: false };
  return { kind: 'other', blocksAll: false };
}

/**
 * Evidência sanitizada de um talk real (kommo-talk-probe): contagens, tipos, ids de usuário e
 * tamanho do texto — nunca o texto, nomes ou telefones.
 */
export function summarizeTalkProbe(
  apiMessages: KommoTalkApiMessage[],
  stored: Array<{ external_id: string | null; sender: string; sender_id: string | null; message_type: string }>
) {
  const msgs = apiMessages ?? [];
  const storedById = new Map(stored.filter((s) => s.external_id).map((s) => [s.external_id!, s]));
  const count = (f: (m: KommoTalkApiMessage) => string) => {
    const out: Record<string, number> = {};
    for (const m of msgs) out[f(m)] = (out[f(m)] ?? 0) + 1;
    return out;
  };
  const hasText = (m: KommoTalkApiMessage) => String(m.text ?? '').trim() !== '';
  const internal = msgs.filter((m) => m.author?.type === 'internal');
  const seller = { match: 0, differ: 0 };
  for (const m of internal) {
    const s = storedById.get(String(m.id));
    if (s) seller[String(s.sender_id) === String(m.author?.user_id) ? 'match' : 'differ'] += 1;
  }
  return {
    total: msgs.length,
    message_keys: [...new Set(msgs.flatMap((m) => Object.keys(m)))].sort(),
    author_keys: [...new Set(msgs.flatMap((m) => Object.keys(m.author ?? {})))].sort(),
    by_direction_and_author: count((m) => `${m.type ?? '?'} / ${m.author?.type ?? '?'}`),
    by_message_type: count((m) => String(m.message_type ?? '?')),
    // Canal da mensagem (WhatsApp, Instagram...): a documentação não lista os valores de origin.
    by_origin: count((m) => String(m.origin ?? '?')),
    internal_user_ids: [...new Set(internal.map((m) => m.author?.user_id ?? null))],
    internal_without_user_id: internal.filter((m) => !clean(m.author?.user_id)).length,
    incoming_with_text: msgs.filter((m) => m.type === 'incoming' && hasText(m)).length,
    outgoing_with_text: msgs.filter((m) => m.type === 'outgoing' && hasText(m)).length,
    with_attachment: msgs.filter((m) => clean(m.attachment?.type)).length,
    created_at_range: msgs.length
      ? [Math.min(...msgs.map((m) => Number(m.created_at))), Math.max(...msgs.map((m) => Number(m.created_at)))]
      : null,
    api_order_ascending: msgs.every((m, i) => i === 0 || Number(msgs[i - 1].created_at) <= Number(m.created_at)),
    db: {
      stored_rows_for_talk: stored.length,
      api_ids_found_in_db: msgs.filter((m) => storedById.has(String(m.id))).length,
      api_outgoing_matching_placeholders: msgs.filter(
        (m) => m.type === 'outgoing' && storedById.get(String(m.id))?.message_type === 'unavailable'
      ).length,
      seller_user_id_vs_placeholder_created_by: seller,
    },
    timeline: msgs.slice(0, 60).map((m) => ({
      created_at: m.created_at,
      type: m.type,
      author_type: m.author?.type ?? null,
      user_id: m.author?.user_id ?? null,
      message_type: m.message_type ?? null,
      text_len: String(m.text ?? '').length,
      attachment: clean(m.attachment?.type),
      in_db: storedById.has(String(m.id)),
    })),
  };
}
