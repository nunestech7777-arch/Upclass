import { isChatEventOfLead } from './kommoMessage.ts';

function getSubdomain(): string {
  const subdomain = Deno.env.get('KOMMO_SUBDOMAIN');
  if (!subdomain) throw new Error('KOMMO_SUBDOMAIN not set');
  return subdomain;
}

function getToken(): string {
  const token = Deno.env.get('KOMMO_API_TOKEN');
  if (!token) throw new Error('KOMMO_API_TOKEN not set');
  return token;
}

// Limitador por isolate: a API do Kommo aceita ~7 req/s por conta — fica abaixo disso.
const MIN_INTERVAL_MS = 180;
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/** Erro HTTP da API do Kommo — `status` permite distinguir 401/402/403/404 (ver kommoTalkMessages.ts). */
export class KommoApiError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string, body: string) {
    super(`Kommo API ${path} failed: ${status} ${body.slice(0, 300)}`);
    this.status = status;
    this.path = path;
  }
}

async function call(path: string): Promise<Record<string, unknown>> {
  const url = `https://${getSubdomain()}.kommo.com/api/v4/${path}`;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 204) return {};
    // 429 (limite de taxa) e 5xx: tenta de novo com backoff exponencial.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      throw new KommoApiError(res.status, path, await res.text());
    }
    return res.json();
  }
}

/** Webhooks da conta (GET /webhooks, só leitura) — destino e eventos assinados. */
export async function fetchWebhooks(destination?: string): Promise<Array<{ destination?: string; settings?: string[]; disabled?: boolean }>> {
  const data = await call(destination ? `webhooks?filter[destination]=${encodeURIComponent(destination)}` : 'webhooks');
  return ((data._embedded as Record<string, unknown> | undefined)?.webhooks as Array<Record<string, unknown>>) ?? [];
}

/** Cria (POST) ou remove (DELETE) a assinatura de webhook de um destino. Só administrador da conta. */
export async function setWebhook(method: 'POST' | 'DELETE', destination: string, settings: string[] = []): Promise<unknown> {
  await throttle();
  const res = await fetch(`https://${getSubdomain()}.kommo.com/api/v4/webhooks`, {
    method,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(method === 'POST' ? { destination, settings } : { destination }),
  });
  if (!res.ok) throw new KommoApiError(res.status, 'webhooks', await res.text());
  return res.status === 204 ? {} : res.json();
}

export interface KommoUser {
  id: number;
  name: string;
  email: string | null;
}

/** Endpoint estável e documentado da API v4 do Kommo — usado para popular o mapeamento manual vendedor ↔ usuário. */
export async function fetchAllUsers(): Promise<KommoUser[]> {
  const users: KommoUser[] = [];
  let page = 1;
  const limit = 250;
  while (true) {
    const res = await call(`users?page=${page}&limit=${limit}`);
    const embedded = res?._embedded as Record<string, unknown> | undefined;
    const pageUsers = (embedded?.users ?? []) as Array<{ id: number; name: string; email?: string | null }>;
    users.push(...pageUsers.map((u) => ({ id: u.id, name: u.name, email: u.email ?? null })));
    const links = res?._links as Record<string, unknown> | undefined;
    if (!links?.next || pageUsers.length === 0) break;
    page += 1;
  }
  return users;
}

export interface KommoLead {
  id: number;
  name: string;
  responsible_user_id: number;
}

/** Usado pelo webhook para descobrir o vendedor responsável (entity_id da mensagem = id do lead). */
export async function fetchLead(id: string | number): Promise<KommoLead> {
  const res = await call(`leads/${id}`);
  return res as unknown as KommoLead;
}

/**
 * Eventos de mensagem de chat de um lead (incoming_chat_message / outgoing_chat_message).
 * O Kommo indexa esses eventos pelo CONTATO (filtrar por lead não retorna nada); cada evento
 * traz entity_type/entity_id do lead ao qual o talk estava vinculado. Só entram eventos
 * explicitamente deste lead — eventos de talks sem lead ou de outros leads do mesmo contato ficam fora.
 * A API v4 pública não expõe o texto — só id, direção, horário e autor (created_by).
 */
export async function fetchLeadChatMessageEvents(
  leadId: string | number,
  contactIds: Array<string | number>,
  sinceUnix?: number
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const events: any[] = [];
  for (const contactId of contactIds) {
    let page = 1;
    while (true) {
      const query = [
        `page=${page}`,
        'limit=100',
        'filter[entity]=contact',
        `filter[entity_id][]=${encodeURIComponent(String(contactId))}`,
        'filter[type][]=incoming_chat_message',
        'filter[type][]=outgoing_chat_message',
        ...(sinceUnix ? [`filter[created_at][from]=${Math.floor(sinceUnix)}`] : []),
      ].join('&');
      const res = await call(`events?${query}`);
      const embedded = res?._embedded as Record<string, unknown> | undefined;
      // deno-lint-ignore no-explicit-any
      const pageEvents = (embedded?.events ?? []) as any[];
      events.push(...pageEvents.filter((e) => isChatEventOfLead(e, leadId)));
      const links = res?._links as Record<string, unknown> | undefined;
      if (!links?.next || pageEvents.length === 0) break;
      page += 1;
    }
  }
  return events;
}

/**
 * Eventos de chat da conta inteira desde `sinceUnix` (sem filtro de entidade), do mais novo para o
 * mais antigo. Usado pelo cron: descobre de uma vez quais leads tiveram mensagens recentes.
 */
// deno-lint-ignore no-explicit-any
export async function fetchRecentChatEvents(sinceUnix: number, maxPages = 50): Promise<{ events: any[]; truncated: boolean }> {
  // deno-lint-ignore no-explicit-any
  const events: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const query = [
      `page=${page}`,
      'limit=100',
      'filter[type][]=incoming_chat_message',
      'filter[type][]=outgoing_chat_message',
      `filter[created_at][from]=${Math.floor(sinceUnix)}`,
    ].join('&');
    const res = await call(`events?${query}`);
    const embedded = res?._embedded as Record<string, unknown> | undefined;
    // deno-lint-ignore no-explicit-any
    const pageEvents = (embedded?.events ?? []) as any[];
    events.push(...pageEvents);
    const links = res?._links as Record<string, unknown> | undefined;
    if (!links?.next || pageEvents.length === 0) return { events, truncated: false };
  }
  return { events, truncated: true };
}

export interface KommoTalk {
  chat_id: string | null;
  entity_id: string | null;
  entity_type: string | null;
}

/** Talk → chat: usado para achar a conversa de mensagens cujo talk ainda não tem mensagem gravada. */
export async function fetchTalk(talkId: string | number): Promise<KommoTalk | null> {
  try {
    const res = await call(`talks/${encodeURIComponent(String(talkId))}`);
    return {
      chat_id: res?.chat_id ? String(res.chat_id) : null,
      entity_id: res?.entity_id ? String(res.entity_id) : null,
      entity_type: res?.entity_type ? String(res.entity_type) : null,
    };
  } catch (err) {
    console.error(`failed to fetch kommo talk ${talkId}`, err);
    return null;
  }
}

/** Diagnóstico: primeira página de eventos de um lead sem filtro de tipo (só metadados). */
// deno-lint-ignore no-explicit-any
export function fetchEntityEventsRaw(entity: 'lead' | 'contact', id: string | number): Promise<any> {
  return call(`events?limit=100&filter[entity]=${entity}&filter[entity_id][]=${encodeURIComponent(String(id))}`);
}

/** Diagnóstico: notas de uma entidade (primeira página). */
// deno-lint-ignore no-explicit-any
export function fetchEntityNotesRaw(entity: 'leads' | 'contacts', id: string | number): Promise<any> {
  return call(`${entity}/${encodeURIComponent(String(id))}/notes?limit=250`);
}

/**
 * Histórico completo de um talk (GET /api/v4/talks/{talk_id}/messages) — as duas direções, com texto,
 * autor (author.type internal/external/bot e author.user_id) e anexos. Exige o escopo
 * "External chat history" e plano Pro/Enterprise; erros sobem como KommoApiError (402/403/404).
 * A API não documenta _links.next: pagina até uma página vir com menos que `limit` itens (ou 204).
 */
export async function fetchTalkMessages(
  talkId: string | number,
  opts: { fromUnix?: number; toUnix?: number; maxPages?: number } = {}
  // deno-lint-ignore no-explicit-any
): Promise<{ messages: any[]; pages: number; truncated: boolean }> {
  const limit = 250;
  const maxPages = opts.maxPages ?? 40;
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [];
  let firstIdOfLastPage: unknown;
  for (let page = 1; page <= maxPages; page++) {
    const query = [
      `page=${page}`,
      `limit=${limit}`,
      ...(opts.fromUnix ? [`filter[created_at][from]=${Math.floor(opts.fromUnix)}`] : []),
      ...(opts.toUnix ? [`filter[created_at][to]=${Math.floor(opts.toUnix)}`] : []),
    ].join('&');
    const res = await call(`talks/${encodeURIComponent(String(talkId))}/messages?${query}`);
    const embedded = res?._embedded as Record<string, unknown> | undefined;
    // deno-lint-ignore no-explicit-any
    const pageMessages = (embedded?.messages ?? []) as any[];
    // Servidor ignorando `page` (mesma página de novo): para em vez de repetir até maxPages.
    if (page > 1 && pageMessages.length && String(pageMessages[0]?.id) === String(firstIdOfLastPage)) {
      return { messages, pages: page - 1, truncated: false };
    }
    firstIdOfLastPage = pageMessages[0]?.id;
    messages.push(...pageMessages);
    if (pageMessages.length < limit) return { messages, pages: page, truncated: false };
  }
  return { messages, pages: maxPages, truncated: true };
}
