import { fetchLead } from './kommo.ts';
import {
  conversationKey,
  extractOutgoingWebhookMessages,
  extractWebhookMessages,
  normalizeKommoMessage,
  type NormalizedMessage,
} from './kommoMessage.ts';
import { normalizeOutgoingWebhookMessage, talkMessageAuthorIdentified } from './kommoTalkMessages.ts';

/**
 * Logs de diagnóstico da transcrição (TEMPORÁRIOS). Ligue com o secret KOMMO_DEBUG=true e
 * desligue quando a integração estiver validada — o resumo por evento continua em
 * kommo_webhook_events.result mesmo com o debug desligado.
 */
const DEBUG = (Deno.env.get('KOMMO_DEBUG') ?? '').toLowerCase() === 'true';

function debugLog(label: string, data: Record<string, unknown>) {
  if (DEBUG) console.log(JSON.stringify({ kommo_debug: label, ...data }));
}

export interface MessageOutcome {
  message_id: string | null;
  status: 'inserted' | 'updated' | 'duplicate_ignored' | 'skipped' | 'error';
  reason?: string;
  conversation_key?: string;
  sender_type?: string;
}

export interface IngestContext {
  // deno-lint-ignore no-explicit-any
  supabase: any;
  /** Cache lead → seller por execução, para não repetir chamadas à API do Kommo. */
  leadSellerCache: Map<string, string | null>;
}

export function createIngestContext(
  // deno-lint-ignore no-explicit-any
  supabase: any
): IngestContext {
  return { supabase, leadSellerCache: new Map() };
}

async function resolveSellerId(ctx: IngestContext, leadId: string): Promise<string | null> {
  if (ctx.leadSellerCache.has(leadId)) return ctx.leadSellerCache.get(leadId)!;
  let sellerId: string | null = null;
  try {
    const lead = await fetchLead(leadId);
    const { data } = await ctx.supabase
      .from('sellers')
      .select('id')
      .eq('kommo_user_id', String(lead.responsible_user_id))
      .maybeSingle();
    sellerId = data?.id ?? null;
  } catch (err) {
    console.error(`failed to resolve seller for lead ${leadId}`, err);
  }
  ctx.leadSellerCache.set(leadId, sellerId);
  return sellerId;
}

async function ingestNormalized(ctx: IngestContext, m: NormalizedMessage, eventId: string | null): Promise<MessageOutcome> {
  const key = conversationKey(m);

  // Só consulta o Kommo quando a conversa ainda não tem vendedor — o resto é resolvido no banco.
  let sellerId: string | null = null;
  if (m.kommo_lead_id) {
    const { data: existing } = await ctx.supabase
      .from('conversations')
      .select('seller_id')
      .eq('external_id', key)
      .maybeSingle();
    sellerId = existing?.seller_id ?? (await resolveSellerId(ctx, m.kommo_lead_id));
  }

  const clientName = m.sender_type === 'client' ? m.sender_name : null;

  const { data, error } = await ctx.supabase.rpc('kommo_ingest_message', {
    p_conversation_key: key,
    p_seller_id: sellerId,
    p_client_name: clientName,
    p_message: m,
    p_event_id: eventId,
  });
  if (error) throw new Error(`kommo_ingest_message: ${error.message}`);

  debugLog('message', {
    event_id: eventId,
    message_id: m.kommo_message_id,
    conversation_key: key,
    conversation_id: data?.conversation_id,
    lead_id: m.kommo_lead_id,
    chat_id: m.kommo_chat_id,
    talk_id: m.kommo_talk_id,
    contact_id: m.kommo_contact_id,
    created_at_original: m.created_at_original,
    sent_at_utc: m.sent_at,
    timestamp_valid: m.timestamp_valid,
    direction: m.direction,
    author_type_raw: m.raw_payload.author?.type ?? null,
    sender_type: m.sender_type,
    sender_name: m.sender_name,
    message_type: m.message_type,
    status: data?.status,
  });

  return { message_id: m.kommo_message_id, status: data?.status, conversation_key: key, sender_type: m.sender_type };
}

/**
 * Mensagem enviada (add_outgoing_message). Na conversa que já existe, grava por kommo_fill_talk_messages
 * (0019): preenche o marcador da events API (mesmo id), nunca reescreve mensagem real e só troca o
 * vendedor do marcador quando o Kommo identifica o autor. Sem conversa, segue o caminho do webhook de
 * entrada (kommo_ingest_message cria a conversa).
 */
async function ingestOutgoing(
  ctx: IngestContext,
  m: NormalizedMessage,
  authorIdentified: boolean,
  eventId: string | null
): Promise<MessageOutcome> {
  const key = conversationKey(m);
  const { data: conv, error } = await ctx.supabase.from('conversations').select('id').eq('external_id', key).maybeSingle();
  if (error) throw new Error(`conversa ${key}: ${error.message}`);
  if (!conv) return ingestNormalized(ctx, m, eventId);

  // A função grava timestamp_valid = true: sem horário do Kommo o marcador fica como está.
  if (!m.timestamp_valid) {
    return { message_id: m.kommo_message_id, status: 'skipped', reason: 'invalid_timestamp', conversation_key: key, sender_type: m.sender_type };
  }
  const { data, error: rpcError } = await ctx.supabase.rpc('kommo_fill_talk_messages', {
    p_conversation_id: conv.id,
    p_messages: [{ ...m, author_identified: authorIdentified }],
  });
  if (rpcError || data?.error || data?.failed) {
    throw new Error(`kommo_fill_talk_messages: ${rpcError?.message ?? data?.error ?? 'item falhou'}`);
  }
  const status: MessageOutcome['status'] = data?.inserted ? 'inserted' : data?.filled ? 'updated' : 'duplicate_ignored';
  debugLog('outgoing', { event_id: eventId, message_id: m.kommo_message_id, conversation_key: key, sender_type: m.sender_type, status });
  return { message_id: m.kommo_message_id, status, conversation_key: key, sender_type: m.sender_type };
}

/**
 * Processa todas as mensagens de um payload de webhook (message[add] e outgoing_message[add]).
 * Cada mensagem é isolada: um erro numa não impede as demais de serem gravadas.
 */
export async function ingestWebhookPayload(
  ctx: IngestContext,
  payload: unknown,
  eventId: string | null,
  receivedAt: Date
): Promise<MessageOutcome[]> {
  const raw = extractWebhookMessages(payload);
  debugLog('event', { event_id: eventId, received_at: receivedAt.toISOString(), messages: raw.length, payload });

  const outcomes: MessageOutcome[] = [];
  for (const msg of raw) {
    const normalized = normalizeKommoMessage(msg, receivedAt);
    if (!normalized.ok) {
      outcomes.push({ message_id: msg.id ?? null, status: 'skipped', reason: normalized.reason });
      debugLog('skipped', { event_id: eventId, message_id: msg.id ?? null, reason: normalized.reason });
      continue;
    }
    try {
      outcomes.push(await ingestNormalized(ctx, normalized.value, eventId));
    } catch (err) {
      console.error(`failed to ingest kommo message ${normalized.value.kommo_message_id}`, err);
      outcomes.push({ message_id: normalized.value.kommo_message_id, status: 'error', reason: String(err) });
    }
  }

  for (const msg of extractOutgoingWebhookMessages(payload)) {
    const normalized = normalizeOutgoingWebhookMessage(msg, receivedAt);
    if (!normalized.ok) {
      outcomes.push({ message_id: msg.id ?? null, status: 'skipped', reason: normalized.reason });
      debugLog('skipped', { event_id: eventId, message_id: msg.id ?? null, reason: normalized.reason });
      continue;
    }
    try {
      outcomes.push(await ingestOutgoing(ctx, normalized.value, talkMessageAuthorIdentified(msg), eventId));
    } catch (err) {
      console.error(`failed to ingest kommo outgoing message ${normalized.value.kommo_message_id}`, String(err).slice(0, 300));
      outcomes.push({ message_id: normalized.value.kommo_message_id, status: 'error', reason: String(err) });
    }
  }
  return outcomes;
}

export function summarizeOutcomes(outcomes: MessageOutcome[]) {
  const counts: Record<string, number> = {};
  for (const o of outcomes) counts[o.status] = (counts[o.status] ?? 0) + 1;
  return { counts, messages: outcomes };
}
