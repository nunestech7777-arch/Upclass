import { supabase } from '../supabaseClient';
import { fetchAllRows, fetchSellers } from '../api';
import { storeToday } from '../finance/dates';
import type { Conversation } from '../database.types';
import { CHANNEL_ORIGINS, KNOWN_ORIGINS } from './channels';
import { daysOf, rangeToInstants, type StoreRange, type SupervisorFilters } from './filters';
import { attendantKeys, classifyConversations, conversationsInPeriod, summarize, type PeriodConversation, type PeriodMessage, type SupervisorSummary } from './metrics';
import {
  attendanceTotals,
  isChannelAuthored,
  kommoProcessedConversations,
  normalizeTemplateText,
  type KommoProcessed,
  templateTexts,
  type AttendanceTotals,
  type BotText,
  type ConversationAttendance,
} from './attendance';

/**
 * Consultas do Meu Supervisor — somente leitura sobre as tabelas que a integração Kommo já
 * alimenta (conversations, conversation_messages, kommo_webhook_events, kommo_users). Nenhuma
 * consulta traz payload bruto de webhook; o acesso é limitado a administradores pelo RLS (0017).
 */

const PERIOD_COLUMNS =
  'id, seller_id, client_name, occurred_at, messages_count, score, summary, kommo_lead_id, origin:raw_payload->>origin';

// O builder tipado do supabase-js não aceita filtros em caminho JSON (raw_payload->>origin).
type Query = any;

/**
 * Aplica o canal a uma consulta em `conversations`. O filtro de vendedor NÃO vai para o banco:
 * seller_id é o responsável do lead; quem atendeu sai das mensagens (loadPeriodSummary).
 */
function applyFilters(query: Query, f: Pick<SupervisorFilters, 'channel'>): Query {
  let q = query;
  if (f.channel === 'whatsapp' || f.channel === 'instagram') q = q.in('raw_payload->>origin', [...CHANNEL_ORIGINS[f.channel]]);
  // NULL NOT IN (...) não retorna linha no SQL: conversa sem origin também é "Outros" (como em channelOf).
  else if (f.channel === 'other') q = q.or(`raw_payload->>origin.is.null,raw_payload->>origin.not.in.(${KNOWN_ORIGINS.join(',')})`);
  return q;
}

/**
 * Marcadores sem texto (respostas antigas recuperadas dos eventos do Kommo) não mexem em
 * occurred_at; com essa folga a conversa cuja última mensagem com texto foi pouco antes do período
 * ainda é candidata, e entra se tiver marcador dentro dele.
 */
const CANDIDATE_MARGIN_MS = 7 * 24 * 3600_000;

/**
 * Candidatas do período: conversas cuja última mensagem real (occurred_at, ver 0009) é de até 7 dias
 * antes do início em diante. Quem continuou depois do período também entra; loadPeriodBase fica só
 * com as que têm mensagem DENTRO dele — senão a conversa de ontem respondida hoje sumiria de "Ontem".
 */
export async function fetchPeriodConversations(f: SupervisorFilters): Promise<PeriodConversation[]> {
  const sinceIso = new Date(Date.parse(rangeToInstants(f.range).fromIso) - CANDIDATE_MARGIN_MS).toISOString();
  return fetchAllRows<PeriodConversation>((from, to) =>
    applyFilters(
      supabase.from('conversations').select(PERIOD_COLUMNS).gte('occurred_at', sinceIso),
      f
    )
      .order('id')
      .range(from, to)
  );
}

const ID_CHUNK = 80;
const CHUNK_CONCURRENCY = 4;
/** Respostas até 24 h depois do fim do período ainda contam como resposta às mensagens dele. */
const REPLY_GRACE_MS = 24 * 3600_000;
/**
 * Janela usada para reconhecer respostas prontas do canal (texto repetido em várias conversas):
 * 14 dias até o fim da busca, qualquer que seja o período — sender não tem índice, então janelas
 * maiores ficam lentas e podem estourar o tempo limite do banco.
 */
const TEMPLATE_LOOKBACK_MS = 14 * 24 * 3600_000;
const TEMPLATE_CACHE_TTL_MS = 10 * 60_000;

/** Fim da busca de mensagens: fim do período + 24 h, nunca depois de agora. */
function messagesUpperIso(toIso: string): string {
  return new Date(Math.min(Date.now(), Date.parse(toIso) + REPLY_GRACE_MS)).toISOString();
}

/** Autor, tipo e horário das mensagens do período — o texto não é necessário para os indicadores. */
export async function fetchPeriodMessages(conversationIds: string[], range: SupervisorFilters['range']): Promise<PeriodMessage[]> {
  const { fromIso, toIso } = rangeToInstants(range);
  const upperIso = messagesUpperIso(toIso);
  const chunks: string[][] = [];
  for (let i = 0; i < conversationIds.length; i += ID_CHUNK) chunks.push(conversationIds.slice(i, i + ID_CHUNK));
  const out: PeriodMessage[] = [];
  for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
    const batch = await Promise.all(
      chunks.slice(i, i + CHUNK_CONCURRENCY).map((ids) =>
        fetchAllRows<PeriodMessage>((from, to) =>
          supabase
            .from('conversation_messages')
            .select('id, conversation_id, kommo_talk_id, sender, sender_id, sender_name, message_type, sent_at, received_seq')
            .in('conversation_id', ids)
            .gte('sent_at', fromIso)
            .lt('sent_at', upperIso)
            .order('id')
            .range(from, to) as unknown as PromiseLike<{ data: PeriodMessage[] | null; error: { message: string } | null }>
        )
      )
    );
    for (const rows of batch) out.push(...rows);
  }
  return out;
}

const templateCache = new Map<string, { at: number; promise: Promise<BotText[]> }>();

/**
 * Mensagens com o nome do canal como autor ("WhatsApp Business", "Instagram"…), de todas as
 * conversas nos 14 dias antes do fim do período: servem só para achar textos repetidos (respostas
 * prontas). Texto da empresa, nunca do cliente; não sai do navegador do administrador.
 */
function fetchChannelAuthoredTexts(range: StoreRange): Promise<BotText[]> {
  const upperIso = messagesUpperIso(rangeToInstants(range).toIso);
  // Chave por hora: trocar de seção ou de filtro reaproveita a mesma consulta.
  const key = upperIso.slice(0, 13);
  const hit = templateCache.get(key);
  if (hit && Date.now() - hit.at < TEMPLATE_CACHE_TTL_MS) return hit.promise;
  const sinceIso = new Date(Date.parse(upperIso) - TEMPLATE_LOOKBACK_MS).toISOString();
  const promise = fetchAllRows<BotText>((from, to) =>
    supabase
      .from('conversation_messages')
      .select('id, conversation_id, message')
      .eq('sender', 'bot')
      .neq('message_type', 'unavailable')
      .not('sender_name', 'in', '("Salesbot","Bot","Automação ou envio externo")')
      .gte('sent_at', sinceIso)
      .lt('sent_at', upperIso)
      .order('id')
      .range(from, to) as unknown as PromiseLike<{ data: BotText[] | null; error: { message: string } | null }>
  );
  templateCache.set(key, { at: Date.now(), promise });
  promise.catch(() => {
    if (templateCache.get(key)?.promise === promise) templateCache.delete(key);
  });
  return promise;
}

/** Texto das mensagens com o nome do canal como autor, pelos ids (poucas por período). */
async function fetchMessageTexts(ids: string[]): Promise<BotText[]> {
  const out: BotText[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id, conversation_id, message')
      .in('id', ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as BotText[]));
  }
  return out;
}

const RESPONSIBLES_TTL_MS = 5 * 60_000;
/** Sem resposta do Kommo nesse tempo a tela segue sem o sinal de distribuição. */
const RESPONSIBLES_TIMEOUT_MS = 12_000;
const responsiblesCache = new Map<string, { at: number; value: string | null }>();

/**
 * Responsável atual de cada lead no Kommo (Edge Function kommo-lead-responsibles, só administrador,
 * só leitura). null = lead não encontrado no Kommo. Guarda por 5 min para não repetir a consulta.
 */
export async function fetchLeadResponsibles(leadIds: string[]): Promise<Map<string, string | null>> {
  const now = Date.now();
  const out = new Map<string, string | null>();
  const missing: string[] = [];
  for (const id of new Set(leadIds.filter(Boolean))) {
    const hit = responsiblesCache.get(id);
    if (hit && now - hit.at < RESPONSIBLES_TTL_MS) out.set(id, hit.value);
    else missing.push(id);
  }
  // Um prazo só para todos os lotes: a tela nunca espera mais que RESPONSIBLES_TIMEOUT_MS.
  const deadline = now + RESPONSIBLES_TIMEOUT_MS;
  for (let i = 0; i < missing.length; i += 1000) {
    const chunk = missing.slice(i, i + 1000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('o Kommo demorou para responder')), Math.max(0, deadline - Date.now()));
    });
    const { data, error } = await Promise.race([
      supabase.functions.invoke('kommo-lead-responsibles', { body: { lead_ids: chunk } }),
      timeout,
    ]).finally(() => clearTimeout(timer));
    if (error || !data?.ok) throw new Error(data?.error ?? error?.message ?? 'falha ao consultar o Kommo');
    const found = (data.responsibles ?? {}) as Record<string, string>;
    for (const id of chunk) {
      const value = found[id] ?? null;
      responsiblesCache.set(id, { at: now, value });
      out.set(id, value);
    }
  }
  return out;
}

/** Tudo do período e canal; o filtro de vendedor é aplicado depois, sobre quem atendeu. */
interface PeriodBase {
  conversations: PeriodConversation[];
  messages: PeriodMessage[];
  attendance: Map<string, ConversationAttendance>;
  /** Usuário do Kommo → id do vendedor vinculado. */
  sellerByKommoUser: Map<string, string>;
  /**
   * O sinal "aguardando distribuição" depende do responsável ATUAL do lead: 'ok' | 'failed' |
   * 'none' (nada a consultar) | 'historical' (período que não inclui hoje — o Kommo só informa o
   * responsável de agora, que não prova a situação daquele dia; não é consultado nem exibido).
   */
  responsibles: 'ok' | 'failed' | 'none' | 'historical';
  /** "Conversas processadas" no critério do painel do Kommo (só mensagens do período). */
  kommoProcessed: KommoProcessed;
}

async function loadPeriodBase(f: SupervisorFilters): Promise<PeriodBase> {
  const { toIso } = rangeToInstants(f.range);
  const candidates = await fetchPeriodConversations(f);
  const [messages, lookbackTexts, sellers] = await Promise.all([
    fetchPeriodMessages(
      candidates.map((c) => c.id),
      f.range
    ),
    fetchChannelAuthoredTexts(f.range),
    fetchSellers(),
  ]);

  // Respostas prontas: textos repetidos nos últimos 14 dias OU dentro do próprio período.
  const channelIds = messages.filter((m) => m.id && isChannelAuthored(m)).map((m) => m.id as string);
  const periodTexts = channelIds.length ? await fetchMessageTexts(channelIds) : [];
  const repeated = templateTexts([...lookbackTexts, ...periodTexts]);
  const templateIds = new Set(periodTexts.filter((r) => repeated.has(normalizeTemplateText(r.message))).map((r) => r.id));
  for (const m of messages) if (m.id && templateIds.has(m.id)) m.template = true;

  // Depois das respostas prontas marcadas: resposta automática sozinha não põe a conversa no período.
  const conversations = conversationsInPeriod(candidates, messages, toIso);

  const sellerByKommoUser = new Map<string, string>();
  for (const s of sellers) if (s.kommo_user_id) sellerByKommoUser.set(String(s.kommo_user_id), s.id);
  // Lead com vendedor desativado também está "sem vendedor" para a distribuição.
  const linkedKommoUsers = new Set(sellers.filter((s) => s.active && s.kommo_user_id).map((s) => String(s.kommo_user_id)));
  // Status e atendentes só com mensagens DENTRO do período (classifyConversations): resposta do dia
  // seguinte não muda o histórico do dia; ela só entra no tempo de resposta, em summarize.
  const toMs = Date.parse(toIso);
  const kommoProcessed = kommoProcessedConversations(messages.filter((m) => Date.parse(m.sent_at) < toMs));

  // 1ª passada sem responsável: só as conversas sem resposta humana precisam dele (distribuição).
  const draft = classifyConversations(conversations, messages, toIso, { linkedKommoUsers });
  const needResponsible = conversations
    .filter((c) => c.kommo_lead_id && (draft.get(c.id)?.status === 'nao_atendida' || draft.get(c.id)?.status === 'automatico'))
    .map((c) => c.kommo_lead_id as string);

  let responsibleByLead: Map<string, string | null> | undefined;
  let responsibles: PeriodBase['responsibles'] = f.range.to < storeToday() ? 'historical' : 'none';
  if (needResponsible.length && responsibles !== 'historical') {
    try {
      responsibleByLead = await fetchLeadResponsibles(needResponsible);
      responsibles = 'ok';
    } catch {
      responsibles = 'failed';
    }
  }
  const attendance = responsibleByLead ? classifyConversations(conversations, messages, toIso, { linkedKommoUsers, responsibleByLead }) : draft;
  return { conversations, messages, attendance, sellerByKommoUser, responsibles, kommoProcessed };
}

export interface PeriodSummaryResult {
  /** Conversas do período depois do filtro de vendedor (por quem atendeu). */
  conversations: PeriodConversation[];
  summary: SupervisorSummary;
  attendance: Map<string, ConversationAttendance>;
  totals: AttendanceTotals;
  /** Chave do atendente a partir do usuário do Kommo (id do vendedor ou "kommo:<id>"). */
  attendantKeyOf: (kommoUserId: string) => string;
  responsibles: PeriodBase['responsibles'];
  /** Critério do painel do Kommo; sempre da equipe toda (não segue o filtro de atendente). */
  kommoProcessed: KommoProcessed;
  loadedAt: number;
}

const CACHE_TTL_MS = 60_000;
const baseCache = new Map<string, { at: number; promise: Promise<PeriodBase> }>();

function loadPeriodBaseCached(f: SupervisorFilters, force: boolean): { promise: Promise<PeriodBase>; at: number } {
  const key = `${f.range.from}|${f.range.to}|${f.channel}`;
  const hit = baseCache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;
  const entry = { at: Date.now(), promise: loadPeriodBase(f) };
  baseCache.set(key, entry);
  entry.promise.catch(() => {
    if (baseCache.get(key)?.promise === entry.promise) baseCache.delete(key);
  });
  return entry;
}

/**
 * Indicadores do período; reaproveita a consulta por 1 min ao trocar de seção ou de vendedor.
 * Filtro de vendedor = conversas em que ele RESPONDEU; "none" = sem atendente identificado.
 */
export async function loadPeriodSummary(f: SupervisorFilters, force = false): Promise<PeriodSummaryResult> {
  const entry = loadPeriodBaseCached(f, force);
  const base = await entry.promise;
  const keyOf = (id: string) => base.sellerByKommoUser.get(id) ?? `kommo:${id}`;
  const focus = f.seller === 'all' ? undefined : f.seller === 'none' ? null : f.seller;
  const conversations =
    focus === undefined ? base.conversations : base.conversations.filter((c) => attendantKeys(base.attendance.get(c.id), keyOf).includes(focus));
  const summary = summarize(conversations, base.messages, daysOf(f.range), {
    attendance: base.attendance,
    attendantKeyOf: keyOf,
    focus,
    periodEnd: rangeToInstants(f.range).toIso,
  });
  const totals = attendanceTotals(conversations.map((c) => base.attendance.get(c.id)).filter((a): a is ConversationAttendance => !!a));
  return { conversations, summary, attendance: base.attendance, totals, attendantKeyOf: keyOf, responsibles: base.responsibles, kommoProcessed: base.kommoProcessed, loadedAt: entry.at };
}

export type ConversationDetail = Omit<Conversation, 'raw_payload'> & { origin: string | null };

export async function fetchConversationDetail(id: string): Promise<ConversationDetail | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, external_id, seller_id, client_name, occurred_at, product, result, result_type, summary, key_points, duration_seconds, messages_count, sentiment, score, objections, strengths, improvements, kommo_lead_id, kommo_chat_id, kommo_contact_id, created_at, origin:raw_payload->>origin'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ConversationDetail) ?? null;
}

export type AnalyzedConversation = Pick<
  Conversation,
  'id' | 'client_name' | 'occurred_at' | 'score' | 'summary' | 'sentiment' | 'strengths' | 'improvements'
> & {
  /** Usuários do Kommo que enviaram mensagem humana na conversa (autores, não o responsável do lead). */
  attendantIds: string[];
};

/** Autores humanos identificados (sender_id de mensagens de vendedor) de cada conversa. */
async function fetchConversationAttendants(conversationIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < conversationIds.length; i += 100) {
    const rows = await fetchAllRows<{ conversation_id: string; sender_id: string | null }>((from, to) =>
      supabase
        .from('conversation_messages')
        .select('conversation_id, sender_id')
        .in('conversation_id', conversationIds.slice(i, i + 100))
        .eq('sender', 'seller')
        .not('sender_id', 'is', null)
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: { conversation_id: string; sender_id: string | null }[] | null; error: { message: string } | null }>
    );
    for (const r of rows) if (r.sender_id) out.set(r.conversation_id, (out.get(r.conversation_id) ?? new Set()).add(r.sender_id));
  }
  return new Map([...out].map(([id, set]) => [id, [...set]]));
}

/**
 * Avaliações já salvas (score ou resumo preenchidos). Hoje nenhuma conversa tem análise.
 * Filtro por AUTOR: `kommoUserId` = usuário do Kommo que enviou mensagem na conversa — nunca
 * conversations.seller_id (responsável do lead), que pode ser quem só distribuiu o lead.
 */
export async function fetchAnalyzedConversations(kommoUserId: string | null, limit = 50): Promise<AnalyzedConversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, client_name, occurred_at, score, summary, sentiment, strengths, improvements')
    .or('score.not.is.null,summary.not.is.null')
    .order('occurred_at', { ascending: false })
    .limit(kommoUserId ? 500 : limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Omit<AnalyzedConversation, 'attendantIds'>[];
  if (!rows.length) return [];
  const attendants = await fetchConversationAttendants(rows.map((r) => r.id));
  return rows
    .map((r) => ({ ...r, attendantIds: attendants.get(r.id) ?? [] }))
    .filter((r) => !kommoUserId || r.attendantIds.includes(kommoUserId))
    .slice(0, limit);
}

export interface IntegrationHealth {
  lastEventAt: string | null;
  /** null = a contagem não respondeu (ex.: tempo limite do banco); a tela mostra "—". */
  events24h: number | null;
  outgoing24h: number | null;
  errors24h: number | null;
  pending7d: number | null;
  recentErrors: { id: string; received_at: string; error: string }[] | null;
  kommoUsers: number | null;
  kommoUsersSyncedAt: string | null;
  conversationsTotal: number | null;
  conversationsWithoutSeller: number | null;
  /** Quantas consultas falharam — o painel mostra o resto em vez de travar. */
  failed: number;
}

async function count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Saúde da integração medida no banco. Só eventos da assinatura principal (kommo-webhook): os
 * capturados pela assinatura de teste têm result.probe = 'outgoing' e ficam de fora.
 * Erros olham só as últimas 24 h: `error` não tem índice e a tabela guarda o payload inteiro,
 * então janelas maiores estouram o statement timeout. Pendentes usam o índice parcial da 0007.
 */
export async function fetchIntegrationHealth(): Promise<IntegrationHealth> {
  const now = Date.now();
  const since24h = new Date(now - 24 * 3600_000).toISOString();
  const since7d = new Date(now - 7 * 24 * 3600_000).toISOString();
  const events = () => supabase.from('kommo_webhook_events').select('id', { count: 'exact', head: true }).is('result->>probe', null);

  // As consultas em kommo_webhook_events vão uma por vez: em paralelo, com o cache do banco frio,
  // elas disputam o statement timeout do usuário logado e falham juntas.
  const webhookQueries: Array<() => PromiseLike<unknown>> = [
    () => rows(supabase.from('kommo_webhook_events').select('received_at').is('result->>probe', null).order('received_at', { ascending: false }).limit(1)),
    () => count(events().gte('received_at', since24h)),
    () => count(events().gte('received_at', since24h).not('payload->outgoing_message', 'is', null)),
    () => count(supabase.from('kommo_webhook_events').select('id', { count: 'exact', head: true }).gte('received_at', since24h).not('error', 'is', null)),
    () => count(events().gte('received_at', since7d).eq('processed', false)),
    () =>
      rows(
        supabase
          .from('kommo_webhook_events')
          .select('id, received_at, error')
          .gte('received_at', since24h)
          .not('error', 'is', null)
          .order('received_at', { ascending: false })
          .limit(20)
      ),
  ];
  const others = Promise.allSettled([
    supabase.from('kommo_users').select('synced_at', { count: 'exact' }).order('synced_at', { ascending: false }).limit(1),
    count(supabase.from('conversations').select('id', { count: 'exact', head: true })),
    count(supabase.from('conversations').select('id', { count: 'exact', head: true }).is('seller_id', null)),
  ]);
  const webhookResults: PromiseSettledResult<unknown>[] = [];
  for (const run of webhookQueries) {
    try {
      webhookResults.push({ status: 'fulfilled', value: await run() });
    } catch (reason) {
      webhookResults.push({ status: 'rejected', reason });
    }
  }
  const results = [...webhookResults, ...(await others)];
  const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);
  const [last, events24h, outgoing24h, errors24h, pending7d, recent, users, conversationsTotal, conversationsWithoutSeller] = results;
  const usersRes = val(users as PromiseSettledResult<{ data: { synced_at: string }[] | null; count: number | null; error: unknown }>);
  const usersOk = usersRes && !usersRes.error ? usersRes : null;
  const recentRows = val(recent as PromiseSettledResult<{ id: string; received_at: string; error: string | null }[]>);

  return {
    lastEventAt: val(last as PromiseSettledResult<{ received_at: string }[]>)?.[0]?.received_at ?? null,
    events24h: val(events24h as PromiseSettledResult<number>),
    outgoing24h: val(outgoing24h as PromiseSettledResult<number>),
    errors24h: val(errors24h as PromiseSettledResult<number>),
    pending7d: val(pending7d as PromiseSettledResult<number>),
    // Mensagem de erro técnica, cortada: não carrega o conteúdo das conversas.
    recentErrors: recentRows ? recentRows.map((r) => ({ id: r.id, received_at: r.received_at, error: String(r.error ?? '').slice(0, 220) })) : null,
    kommoUsers: usersOk?.count ?? null,
    kommoUsersSyncedAt: usersOk?.data?.[0]?.synced_at ?? null,
    conversationsTotal: val(conversationsTotal as PromiseSettledResult<number>),
    conversationsWithoutSeller: val(conversationsWithoutSeller as PromiseSettledResult<number>),
    failed: results.filter((r) => r.status === 'rejected').length + (usersRes && usersRes.error ? 1 : 0),
  };
}

/** Dispara a sincronização de usuários do Kommo (Edge Function kommo-sync; só administrador). */
export async function syncKommoUsersNow(): Promise<number> {
  const { data, error } = await supabase.functions.invoke('kommo-sync', { body: {} });
  if (error) {
    let detail = error.message;
    try {
      const payload = await (error as { context?: Response }).context?.json();
      if (payload?.error) detail = payload.error;
    } catch {
      // resposta sem corpo JSON
    }
    throw new Error(detail);
  }
  if (!data?.ok) throw new Error(data?.error ?? 'resposta inválida da sincronização');
  return Number(data.users) || 0;
}
