/**
 * Normalização pura das mensagens de chat do Kommo — sem dependência de Deno/Supabase
 * para poder ser testada com `node --test` (ver kommoMessage.test.ts).
 *
 * Formato do webhook "message[add]" do Kommo (form-urlencoded, já convertido por parseBracketForm):
 *   id, chat_id, talk_id, contact_id, text, created_at (unix, segundos, UTC),
 *   element_type, element_id, entity_type, entity_id, type ("incoming" | "outgoing"),
 *   origin, author { id, type, name, avatar_url }, attachment { type, link, file_name }
 */

export type SenderType = 'client' | 'seller' | 'bot' | 'system';

export interface KommoWebhookMessage {
  id?: string;
  chat_id?: string;
  talk_id?: string;
  contact_id?: string;
  text?: string;
  created_at?: string | number;
  element_type?: string;
  element_id?: string;
  entity_type?: string;
  entity_id?: string;
  type?: string;
  origin?: string;
  author?: { id?: string; type?: string; name?: string; avatar_url?: string };
  attachment?: { type?: string; link?: string; file_name?: string };
}

export interface NormalizedMessage {
  kommo_message_id: string;
  kommo_chat_id: string;
  kommo_talk_id: string | null;
  kommo_contact_id: string | null;
  /** Só preenchido quando entity_type = "lead". */
  kommo_lead_id: string | null;
  kommo_entity_type: string | null;
  kommo_entity_id: string | null;
  direction: 'incoming' | 'outgoing' | null;
  sender_type: SenderType;
  sender_id: string | null;
  sender_name: string | null;
  message_text: string;
  message_type: string;
  /** Valor exatamente como veio do Kommo (auditoria). */
  created_at_original: string | null;
  /** created_at normalizado em ISO-8601 UTC — é a base da ordenação. */
  sent_at: string;
  /** false quando o created_at do Kommo veio ausente/inválido e usamos a hora de recebimento. */
  timestamp_valid: boolean;
  raw_payload: KommoWebhookMessage;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedMessage }
  | { ok: false; reason: string };

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
/** Maior índice de array aceito — um webhook do Kommo traz poucas dezenas de itens. */
const MAX_ARRAY_INDEX = 1000;

/**
 * Webhooks do Kommo chegam form-urlencoded com notação de colchetes
 * (ex: "message[add][0][chat_id]=123"), não JSON. Reconstrói o objeto aninhado.
 * Chaves que tentariam alcançar propriedades herdadas (__proto__, toString...), índices
 * enormes ou chaves não numéricas dentro de arrays (ex. "length") são descartadas.
 */
export function parseBracketForm(body: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const params = new URLSearchParams(body);
  for (const [rawKey, value] of params.entries()) {
    const segments: string[] = [];
    const re = /([^[\]]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rawKey)) !== null) segments.push(m[1]);
    if (
      segments.length === 0 ||
      segments.some((seg) => FORBIDDEN_SEGMENTS.has(seg) || (/^\d+$/.test(seg) && Number(seg) > MAX_ARRAY_INDEX))
    ) {
      continue;
    }

    // deno-lint-ignore no-explicit-any
    let node: any = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (Array.isArray(node) && !/^\d+$/.test(seg)) break;
      if (i === segments.length - 1) {
        node[seg] = value;
        break;
      }
      if (!Object.hasOwn(node, seg)) {
        node[seg] = /^\d+$/.test(segments[i + 1]) ? [] : {};
      }
      node = node[seg];
      // Conflito com um valor escalar já gravado nessa chave: ignora esta entrada.
      if (node === null || typeof node !== 'object') break;
    }
  }
  return root;
}

function extractAdd(payload: unknown, group: string): KommoWebhookMessage[] {
  const add = ((payload as Record<string, unknown> | null)?.[group] as Record<string, unknown> | undefined)?.add;
  if (!add || typeof add !== 'object') return [];
  const list = Array.isArray(add) ? add : Object.values(add as Record<string, unknown>);
  return list.filter((m): m is KommoWebhookMessage => !!m && typeof m === 'object');
}

/** Extrai message[add] do payload; o parse de colchetes pode gerar arrays esparsos, então filtra buracos. */
export function extractWebhookMessages(payload: unknown): KommoWebhookMessage[] {
  return extractAdd(payload, 'message');
}

/**
 * Extrai outgoing_message[add] — webhook add_outgoing_message (mensagens enviadas pelo Kommo por
 * vendedor ou Salesbot). Mesmos campos do message[add] mais author.user_id, message_type e attachment.
 */
export function extractOutgoingWebhookMessages(payload: unknown): KommoWebhookMessage[] {
  return extractAdd(payload, 'outgoing_message');
}

/** Janela plausível para uma mensagem real: de 2015 (Kommo/amoCRM chats) até 1 dia no futuro. */
const MIN_PLAUSIBLE_MS = Date.UTC(2015, 0, 1);
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * O Kommo envia created_at como Unix em segundos (UTC). Aceita também milissegundos
 * e ISO com fuso explícito. Nunca aplica o fuso local do processo — o resultado é sempre UTC.
 * Valores fora da janela plausível são tratados como inválidos (fallback = hora de recebimento).
 */
export function parseKommoTimestamp(
  raw: string | number | undefined | null,
  fallback: Date
): { iso: string; valid: boolean } {
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const str = String(raw).trim();
    let ms: number | null = null;
    if (/^\d+(\.\d+)?$/.test(str)) {
      const n = Number(str);
      // < 1e12 → segundos; >= 1e12 → milissegundos
      ms = n < 1e12 ? n * 1000 : n;
    } else if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
      ms = new Date(str).getTime();
    }
    if (ms !== null && Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_MS && ms <= Date.now() + MAX_FUTURE_SKEW_MS) {
      return { iso: new Date(ms).toISOString(), valid: true };
    }
  }
  return { iso: fallback.toISOString(), valid: false };
}

const BOT_AUTHOR_TYPES = new Set(['bot', 'salesbot', 'robot', 'chatbot']);
const SYSTEM_AUTHOR_TYPES = new Set(['system', 'amocrm', 'kommo']);
const CLIENT_AUTHOR_TYPES = new Set(['external', 'contact', 'client', 'customer']);

/**
 * Quem enviou a mensagem. A direção (type) do Kommo é o sinal mais confiável:
 * "incoming" é sempre o cliente; "outgoing" é da empresa (atendente, bot ou sistema,
 * diferenciados por author.type). Só sem direção caímos para author.type.
 */
export function classifySender(msg: KommoWebhookMessage): SenderType {
  const direction = (msg.type ?? '').toLowerCase();
  const authorType = (msg.author?.type ?? '').toLowerCase();

  if (direction === 'incoming') return 'client';
  if (BOT_AUTHOR_TYPES.has(authorType)) return 'bot';
  if (SYSTEM_AUTHOR_TYPES.has(authorType)) return 'system';
  if (direction === 'outgoing') return 'seller';
  if (CLIENT_AUTHOR_TYPES.has(authorType)) return 'client';
  if (authorType === 'user' || authorType === 'internal') return 'seller';
  return 'system';
}

function clean(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '0' ? null : s;
}

export function normalizeKommoMessage(msg: KommoWebhookMessage, receivedAt: Date): NormalizeResult {
  const id = clean(msg.id);
  if (!id) return { ok: false, reason: 'missing_message_id' };
  const chatId = clean(msg.chat_id);
  if (!chatId) return { ok: false, reason: 'missing_chat_id' };

  const text = typeof msg.text === 'string' ? msg.text : '';
  const attachmentType = clean(msg.attachment?.type);
  if (text.trim() === '' && !attachmentType) return { ok: false, reason: 'empty_message' };

  const entityType = clean(msg.entity_type)?.toLowerCase() ?? null;
  const entityId = clean(msg.entity_id);
  const directionRaw = (msg.type ?? '').toLowerCase();
  const senderType = classifySender(msg);
  const ts = parseKommoTimestamp(msg.created_at, receivedAt);

  const defaultNames: Record<SenderType, string | null> = {
    client: null,
    seller: null,
    bot: 'Bot',
    system: 'Sistema',
  };

  return {
    ok: true,
    value: {
      kommo_message_id: id,
      kommo_chat_id: chatId,
      kommo_talk_id: clean(msg.talk_id),
      kommo_contact_id: clean(msg.contact_id),
      kommo_lead_id: entityType === 'lead' ? entityId : null,
      kommo_entity_type: entityType,
      kommo_entity_id: entityId,
      direction: directionRaw === 'incoming' || directionRaw === 'outgoing' ? directionRaw : null,
      sender_type: senderType,
      sender_id: clean(msg.author?.id),
      sender_name: clean(msg.author?.name) ?? defaultNames[senderType],
      message_text: text,
      message_type: attachmentType ?? 'text',
      created_at_original: msg.created_at === undefined || msg.created_at === null ? null : String(msg.created_at),
      sent_at: ts.iso,
      timestamp_valid: ts.valid,
      raw_payload: msg,
    },
  };
}

/**
 * Chave de agrupamento da conversa. Um chat (WhatsApp/Instagram do contato) pode atravessar
 * vários leads ao longo do tempo, e um lead pode ter vários chats — por isso a transcrição é
 * identificada por lead + chat. Mensagens sem lead (entity_type = contact) ficam isoladas por entidade.
 */
export function conversationKey(m: NormalizedMessage): string {
  if (m.kommo_lead_id) return `kommo:lead:${m.kommo_lead_id}:chat:${m.kommo_chat_id}`;
  if (m.kommo_entity_type && m.kommo_entity_id) {
    return `kommo:${m.kommo_entity_type}:${m.kommo_entity_id}:chat:${m.kommo_chat_id}`;
  }
  return `kommo:chat:${m.kommo_chat_id}`;
}

// ---------------------------------------------------------------------------
// Auditoria contra a API (GET /api/v4/events) — o Kommo registra um evento
// incoming_chat_message / outgoing_chat_message por mensagem, com o id da mensagem.
// ---------------------------------------------------------------------------

export interface KommoChatEvent {
  message_id: string;
  direction: 'incoming' | 'outgoing';
  created_at: string;
  talk_id: string | null;
}

// deno-lint-ignore no-explicit-any
export function parseChatMessageEvents(events: any[]): KommoChatEvent[] {
  const out: KommoChatEvent[] = [];
  for (const ev of events ?? []) {
    const type = String(ev?.type ?? '');
    if (type !== 'incoming_chat_message' && type !== 'outgoing_chat_message') continue;
    const values = Array.isArray(ev?.value_after) ? ev.value_after : [];
    for (const v of values) {
      const messageId = clean(v?.message?.id);
      if (!messageId) continue;
      out.push({
        message_id: messageId,
        direction: type === 'incoming_chat_message' ? 'incoming' : 'outgoing',
        created_at: parseKommoTimestamp(ev?.created_at, new Date(0)).iso,
        talk_id: clean(v?.message?.talk_id),
      });
    }
  }
  return out;
}

export interface StoredMessageForAudit {
  external_id: string | null;
  sender: SenderType;
  sent_at: string;
}

export interface AuditReport {
  kommo_total: number;
  stored_total: number;
  missing_in_db: KommoChatEvent[];
  not_in_kommo_events: string[];
  sender_mismatch: Array<{ message_id: string; kommo_direction: string; stored_sender: string }>;
  /** Diferença de horário acima da tolerância (segundos). */
  timestamp_mismatch: Array<{ message_id: string; kommo: string; stored: string; diff_seconds: number }>;
  order_matches: boolean;
}

/** Compara o que o Kommo registrou (events API) com o que está gravado no banco. */
export function compareWithKommoEvents(
  kommo: KommoChatEvent[],
  stored: StoredMessageForAudit[],
  toleranceSeconds = 5
): AuditReport {
  const storedById = new Map(stored.filter((s) => s.external_id).map((s) => [s.external_id!, s]));
  const kommoIds = new Set(kommo.map((k) => k.message_id));

  const report: AuditReport = {
    kommo_total: kommo.length,
    stored_total: stored.length,
    missing_in_db: [],
    not_in_kommo_events: stored.filter((s) => !s.external_id || !kommoIds.has(s.external_id)).map((s) => s.external_id ?? '(sem external_id)'),
    sender_mismatch: [],
    timestamp_mismatch: [],
    order_matches: true,
  };

  for (const k of kommo) {
    const s = storedById.get(k.message_id);
    if (!s) {
      report.missing_in_db.push(k);
      continue;
    }
    const storedIsIncoming = s.sender === 'client';
    if (storedIsIncoming !== (k.direction === 'incoming')) {
      report.sender_mismatch.push({ message_id: k.message_id, kommo_direction: k.direction, stored_sender: s.sender });
    }
    const diff = Math.abs(new Date(k.created_at).getTime() - new Date(s.sent_at).getTime()) / 1000;
    if (diff > toleranceSeconds) {
      report.timestamp_mismatch.push({ message_id: k.message_id, kommo: k.created_at, stored: s.sent_at, diff_seconds: diff });
    }
  }

  // Ordem: a sequência de ids no banco (já ordenada) deve respeitar a ordem cronológica do Kommo.
  const storedOrder = stored.map((s) => s.external_id).filter((id): id is string => !!id && kommoIds.has(id));
  const kommoTimeById = new Map(kommo.map((k) => [k.message_id, k.created_at]));
  // Empates no mesmo segundo não têm ordem definida no Kommo — só compara onde o horário difere.
  for (let i = 1; i < storedOrder.length; i++) {
    if (kommoTimeById.get(storedOrder[i - 1])! > kommoTimeById.get(storedOrder[i])!) {
      report.order_matches = false;
      break;
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Marcadores de mensagens que o webhook não entrega (o Kommo só envia as recebidas).
// A events API informa id, direção, horário, talk e autor, mas não o texto.
// ---------------------------------------------------------------------------

export interface PlaceholderMessage {
  conversation_id: string;
  kommo_message_id: string;
  direction: 'incoming' | 'outgoing';
  sender_type: SenderType;
  sender_id: string | null;
  sender_name: string | null;
  sent_at: string;
  created_at_original: string | null;
  kommo_talk_id: string | null;
  source_event: unknown;
}

export interface PlaceholderPlan {
  placeholders: PlaceholderMessage[];
  /** Eventos cujo talk não pôde ser associado a uma única conversa do lead. */
  unmatched: string[];
}

/** Evento de chat pertence a este lead? Eventos de talks sem lead (entity_type=contact) ou de outros leads do contato ficam fora. */
// deno-lint-ignore no-explicit-any
export function isChatEventOfLead(ev: any, leadId: string | number): boolean {
  return ev?.entity_type === 'lead' && String(ev?.entity_id) === String(leadId);
}

/** Talks citados em eventos ainda não gravados e cuja conversa não é conhecida — precisam de /talks/{id}. */
// deno-lint-ignore no-explicit-any
export function collectUnknownTalks(rawEvents: any[], existingMessageIds: Set<string>, talkToConversation: Map<string, string>) {
  const talks = new Set<string>();
  for (const ev of rawEvents ?? []) {
    for (const v of Array.isArray(ev?.value_after) ? ev.value_after : []) {
      const id = clean(v?.message?.id);
      const talkId = clean(v?.message?.talk_id);
      if (id && talkId && !existingMessageIds.has(id) && !talkToConversation.has(talkId)) talks.add(talkId);
    }
  }
  return [...talks];
}

/**
 * Decide quais eventos de chat do lead viram marcadores e em qual conversa entram.
 * A conversa é achada pelo talk: primeiro por mensagens já gravadas daquele talk; senão pelo
 * chat do talk (resolvido via /talks/{id}) casado com conversations.kommo_chat_id. Sem uma dessas
 * evidências o evento fica sem marcador — nunca é "chutado" para outra conversa.
 * Autor: outgoing com created_by > 0 é o usuário do Kommo (atendente); created_by = 0 não tem
 * usuário (automação/Salesbot ou envio feito fora da Kommo, ex. app do WhatsApp).
 */
export function planPlaceholders(
  // deno-lint-ignore no-explicit-any
  rawEvents: any[],
  opts: {
    existingMessageIds: Set<string>;
    talkToConversation: Map<string, string>;
    /** talk_id → conversa, resolvido pelo chat do talk. */
    talkChatConversation: Map<string, string>;
    userNames: Map<string, string>;
  }
): PlaceholderPlan {
  const plan: PlaceholderPlan = { placeholders: [], unmatched: [] };
  const seen = new Set<string>();
  // A events API devolve do mais novo para o mais antigo. Os marcadores são inseridos em ordem
  // cronológica (received_seq desempata o mesmo segundo), então ordena por created_at crescente e,
  // no empate, pela posição inversa na resposta.
  const ordered = (rawEvents ?? [])
    .map((ev, i) => ({ ev, i }))
    .sort((a, b) => Number(a.ev?.created_at ?? 0) - Number(b.ev?.created_at ?? 0) || b.i - a.i)
    .map((x) => x.ev);
  for (const ev of ordered) {
    const type = String(ev?.type ?? '');
    if (type !== 'incoming_chat_message' && type !== 'outgoing_chat_message') continue;
    const direction = type === 'incoming_chat_message' ? 'incoming' : 'outgoing';
    const ts = parseKommoTimestamp(ev?.created_at, new Date(0));
    if (!ts.valid) continue;
    for (const v of Array.isArray(ev?.value_after) ? ev.value_after : []) {
      const id = clean(v?.message?.id);
      if (!id || opts.existingMessageIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      const talkId = clean(v?.message?.talk_id);
      const conversationId = talkId
        ? opts.talkToConversation.get(talkId) ?? opts.talkChatConversation.get(talkId)
        : undefined;
      if (!conversationId) {
        plan.unmatched.push(id);
        continue;
      }
      const createdBy = clean(ev?.created_by);
      let senderType: SenderType;
      let senderName: string | null;
      if (direction === 'incoming') {
        senderType = 'client';
        senderName = null;
      } else if (createdBy) {
        senderType = 'seller';
        senderName = opts.userNames.get(createdBy) ?? null;
      } else {
        senderType = 'bot';
        senderName = 'Automação ou envio externo';
      }
      plan.placeholders.push({
        conversation_id: conversationId,
        kommo_message_id: id,
        direction,
        sender_type: senderType,
        sender_id: createdBy,
        sender_name: senderName,
        sent_at: ts.iso,
        created_at_original: ev?.created_at === undefined ? null : String(ev.created_at),
        kommo_talk_id: talkId,
        source_event: ev,
      });
    }
  }
  return plan;
}
