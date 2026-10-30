import { channelOf, type Channel } from './channels.ts';
import { classifyAttendance, outgoingKind, type AttendanceContext, type AuthoredMessage, type ConversationAttendance } from './attendance.ts';

/**
 * Indicadores do Meu Supervisor calculados só com dados reais do banco: conversas do Kommo e os
 * horários das mensagens. Marcadores sem texto (message_type = 'unavailable') têm autor e horário
 * reais, então entram no tempo de resposta. Nada aqui inventa nota, resultado ou oportunidade.
 * O vendedor de cada número é quem RESPONDEU (autor da mensagem, ver attendance.ts), não o
 * responsável do lead.
 */

export type MessageSender = 'client' | 'seller' | 'bot' | 'system';

export interface PeriodMessage extends AuthoredMessage {
  id?: string;
  conversation_id: string;
  /** Atendimento (talk) do Kommo — unidade do "conversas processadas" do painel do Kommo. */
  kommo_talk_id?: string | null;
  sender: MessageSender;
  sent_at: string;
  received_seq?: number | null;
}

export interface PeriodConversation {
  id: string;
  seller_id: string | null;
  client_name: string;
  occurred_at: string;
  messages_count: number | null;
  origin: string | null;
  score: number | null;
  summary: string | null;
  kommo_lead_id: string | null;
  /** Última mensagem dentro do período (occurred_at é a última de todas, pode ser depois dele). */
  period_last_at?: string;
}

/** Uma rodada respondida: cliente escreveu e uma pessoa respondeu. */
export interface ResponseRound {
  seconds: number;
  /** Horário da resposta. */
  at: string;
  /** Primeira mensagem do cliente da rodada (o dia da rodada nos gráficos). */
  openedAt: string;
  /** Respondida antes do fim do período (as de depois só entram no tempo de resposta). */
  inPeriod: boolean;
  /** Usuário do Kommo que respondeu; null = resposta humana sem identificação (enviada pelo aparelho). */
  responderId: string | null;
}

export interface ConversationStats {
  /** Segundos entre a primeira mensagem do cliente de uma rodada e a resposta humana. */
  responseSeconds: number[];
  rounds: ResponseRound[];
  /** A última mensagem do cliente ainda não teve resposta humana. */
  awaitingReply: boolean;
  awaitingSince: string | null;
  /** Quem respondeu por último (null = ninguém identificado). */
  lastResponderId: string | null;
  /** Já houve alguma resposta humana (identificada ou pelo aparelho). */
  hadHumanReply: boolean;
  clientMessages: number;
  sellerMessages: number;
  botMessages: number;
}

const EMPTY_STATS: ConversationStats = {
  responseSeconds: [],
  rounds: [],
  awaitingReply: false,
  awaitingSince: null,
  lastResponderId: null,
  hadHumanReply: false,
  clientMessages: 0,
  sellerMessages: 0,
  botMessages: 0,
};

export function byTimeline(a: PeriodMessage, b: PeriodMessage): number {
  const d = Date.parse(a.sent_at) - Date.parse(b.sent_at);
  if (d !== 0) return d;
  return (a.received_seq ?? Number.MAX_SAFE_INTEGER) - (b.received_seq ?? Number.MAX_SAFE_INTEGER);
}

/**
 * Rodadas de atendimento de uma conversa: a primeira mensagem do cliente abre a espera e a primeira
 * resposta humana depois dela fecha (vendedor identificado ou envio pelo aparelho). Resposta
 * automática não conta como atendimento. Com `periodEnd`, mensagens depois do fim do período só
 * servem para fechar rodadas abertas dentro dele (tempo de resposta a uma mensagem do fim do dia):
 * não entram nas contagens nem mudam quem atendeu.
 */
export function conversationStats(messages: PeriodMessage[], periodEnd?: string): ConversationStats {
  const stats: ConversationStats = { ...EMPTY_STATS, responseSeconds: [], rounds: [] };
  const endMs = periodEnd ? Date.parse(periodEnd) : Number.POSITIVE_INFINITY;
  let waitingSince: string | null = null;
  // Espera no FIM do período: "sem resposta" é histórico do período, não muda com a resposta do dia seguinte.
  let waitingAtEnd: string | null = null;
  for (const m of [...messages].sort(byTimeline)) {
    const inPeriod = Date.parse(m.sent_at) < endMs;
    if (!inPeriod && waitingAtEnd === null) waitingAtEnd = waitingSince ?? '';
    if (m.sender === 'client') {
      if (!inPeriod) continue;
      stats.clientMessages += 1;
      if (waitingSince == null) waitingSince = m.sent_at;
      continue;
    }
    const kind = outgoingKind(m);
    if (kind === 'human' || kind === 'external') {
      if (inPeriod) stats.sellerMessages += 1;
      const responderId = kind === 'human' ? (m.sender_id ?? null) : null;
      if (waitingSince != null) {
        const seconds = Math.round((Date.parse(m.sent_at) - Date.parse(waitingSince)) / 1000);
        if (seconds >= 0) {
          stats.responseSeconds.push(seconds);
          stats.rounds.push({ seconds, at: m.sent_at, openedAt: waitingSince, responderId, inPeriod });
        }
        waitingSince = null;
      }
      // Quem atendeu é histórico do período: resposta do dia seguinte só fecha a rodada (tempo de resposta).
      if (inPeriod) {
        stats.hadHumanReply = true;
        if (responderId) stats.lastResponderId = responderId;
      }
    } else if ((kind === 'automatic' || kind === 'unknown') && inPeriod) {
      stats.botMessages += 1;
    }
  }
  const atEnd = waitingAtEnd === null ? waitingSince : waitingAtEnd || null;
  stats.awaitingReply = atEnd != null;
  stats.awaitingSince = atEnd;
  return stats;
}

export function groupMessages(messages: PeriodMessage[]): Map<string, PeriodMessage[]> {
  const grouped = new Map<string, PeriodMessage[]>();
  for (const m of messages) {
    const list = grouped.get(m.conversation_id);
    if (list) list.push(m);
    else grouped.set(m.conversation_id, [m]);
  }
  for (const list of grouped.values()) list.sort(byTimeline);
  return grouped;
}

export function statsByConversation(messages: PeriodMessage[], periodEnd?: string): Map<string, ConversationStats> {
  const out = new Map<string, ConversationStats>();
  for (const [id, list] of groupMessages(messages)) out.set(id, conversationStats(list, periodEnd));
  return out;
}

/**
 * Conversas com atendimento no período: mensagem do cliente ou resposta de uma pessoa antes do fim
 * dele (as mensagens já vêm a partir do início). Disparo só de robô (ex.: Salesbot para lead antigo)
 * não conta. period_last_at = a última dessas mensagens.
 */
export function conversationsInPeriod(candidates: PeriodConversation[], messages: PeriodMessage[], periodEnd: string): PeriodConversation[] {
  const endMs = Date.parse(periodEnd);
  const last = new Map<string, string>();
  for (const m of messages) {
    if (Date.parse(m.sent_at) >= endMs) continue;
    if (m.sender !== 'client') {
      const kind = outgoingKind(m);
      if (kind !== 'human' && kind !== 'external') continue;
    }
    const prev = last.get(m.conversation_id);
    if (!prev || Date.parse(m.sent_at) > Date.parse(prev)) last.set(m.conversation_id, m.sent_at);
  }
  return candidates.filter((c) => last.has(c.id)).map((c) => ({ ...c, period_last_at: last.get(c.id) }));
}

/**
 * Status e atendentes das conversas usando SÓ as mensagens antes do fim do período: resposta do
 * dia seguinte não aumenta os atendimentos nem muda o status do dia (ela só conta no tempo de
 * resposta, via conversationStats).
 */
export function classifyConversations(
  convs: PeriodConversation[],
  messages: PeriodMessage[],
  periodEnd: string,
  ctx: AttendanceContext
): Map<string, ConversationAttendance> {
  const endMs = Date.parse(periodEnd);
  const grouped = groupMessages(messages.filter((m) => Date.parse(m.sent_at) < endMs));
  return new Map(convs.map((c) => [c.id, classifyAttendance(grouped.get(c.id) ?? [], c.kommo_lead_id, ctx)]));
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function isAnalyzed(c: Pick<PeriodConversation, 'score' | 'summary'>): boolean {
  return c.score != null || !!c.summary?.trim();
}

export interface GroupMetrics {
  conversations: number;
  analyzed: number;
  pending: number;
  avgScore: number | null;
  responses: number;
  /** Rodadas respondidas dentro do período — base da taxa de resposta com `awaiting`. */
  answeredInPeriod: number;
  avgResponseSeconds: number | null;
  medianResponseSeconds: number | null;
  awaiting: number;
  clientMessages: number;
  sellerMessages: number;
  botMessages: number;
}

export interface SellerMetrics extends GroupMetrics {
  /**
   * Quem atendeu: id do vendedor, "kommo:<id>" para usuário do Kommo sem vendedor vinculado,
   * ou null = conversas sem atendente identificado.
   */
  sellerId: string | null;
}

export interface DayMetrics {
  date: string;
  conversations: number;
  avgResponseSeconds: number | null;
}

export interface AwaitingConversation {
  conversation: PeriodConversation;
  since: string;
  /** Quem respondeu por último (mesma chave de SellerMetrics.sellerId). */
  attendantKey: string | null;
  /** Já teve resposta humana, mesmo sem atendente identificado (envio pelo aparelho). */
  answered: boolean;
}

export interface SupervisorSummary extends GroupMetrics {
  bySeller: SellerMetrics[];
  byChannel: Record<Channel, number>;
  byDay: DayMetrics[];
  awaitingList: AwaitingConversation[];
}

export interface SummarizeOptions {
  /** Status de atendimento por conversa (attendance.ts). Sem ele, ninguém é atendente identificado. */
  attendance?: Map<string, ConversationAttendance>;
  /** Usuário do Kommo → chave do atendente (id do vendedor vinculado ou "kommo:<id>"). */
  attendantKeyOf?: (kommoUserId: string) => string;
  /** Mostra só os números deste atendente (filtro de vendedor). null = sem atendente identificado. */
  focus?: string | null;
  /** Fim do período (exclusivo); mensagens depois dele só fecham rodadas. */
  periodEnd?: string;
}

const defaultKey = (id: string) => `kommo:${id}`;

/** Chaves dos atendentes de uma conversa; [null] quando ninguém foi identificado. */
export function attendantKeys(attendance: ConversationAttendance | undefined, keyOf: (id: string) => string = defaultKey): (string | null)[] {
  const keys = [...new Set((attendance?.attendants ?? []).map((a) => keyOf(a.kommoUserId)))];
  return keys.length ? keys : [null];
}

function groupMetrics(
  convs: PeriodConversation[],
  stats: Map<string, ConversationStats>,
  attendance: Map<string, ConversationAttendance> | undefined,
  keyOf: (id: string) => string,
  focus: string | null | undefined
): GroupMetrics {
  const scores: number[] = [];
  const responses: number[] = [];
  let answeredInPeriod = 0;
  const all = focus === undefined;
  const responderKey = (id: string | null) => (id ? keyOf(id) : null);
  let analyzed = 0;
  let awaiting = 0;
  let clientMessages = 0;
  let sellerMessages = 0;
  let botMessages = 0;
  for (const c of convs) {
    if (isAnalyzed(c)) analyzed += 1;
    if (c.score != null) scores.push(c.score);
    const s = stats.get(c.id) ?? EMPTY_STATS;
    for (const r of s.rounds) {
      if (!all && responderKey(r.responderId) !== focus) continue;
      responses.push(r.seconds);
      if (r.inPeriod) answeredInPeriod += 1;
    }
    if (s.awaitingReply && (all || responderKey(s.lastResponderId) === focus)) awaiting += 1;
    clientMessages += s.clientMessages;
    botMessages += s.botMessages;
    if (all) sellerMessages += s.sellerMessages;
    else if (focus === null) sellerMessages += attendance?.get(c.id)?.counts.external ?? 0;
    else for (const a of attendance?.get(c.id)?.attendants ?? []) if (keyOf(a.kommoUserId) === focus) sellerMessages += a.messages;
  }
  return {
    conversations: convs.length,
    analyzed,
    pending: convs.length - analyzed,
    avgScore: average(scores),
    responses: responses.length,
    answeredInPeriod,
    avgResponseSeconds: average(responses),
    medianResponseSeconds: median(responses),
    awaiting,
    clientMessages,
    sellerMessages,
    botMessages,
  };
}

/** Dia da loja (AAAA-MM-DD, America/Sao_Paulo) de um instante. */
export function storeDayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
}

/**
 * Resumo do período. Uma conversa com dois atendentes conta para cada um em `bySeller`, mas só uma
 * vez no total. Tempo de resposta e "sem resposta" ficam com quem respondeu aquela rodada / por último.
 */
export function summarize(
  convs: PeriodConversation[],
  messages: PeriodMessage[],
  days: string[] = [],
  options: SummarizeOptions = {}
): SupervisorSummary {
  const { attendance, focus, periodEnd } = options;
  const keyOf = options.attendantKeyOf ?? defaultKey;
  const stats = statsByConversation(messages, periodEnd);
  const responderKey = (id: string | null) => (id ? keyOf(id) : null);

  const bySellerMap = new Map<string | null, PeriodConversation[]>();
  for (const c of convs) {
    for (const key of attendantKeys(attendance?.get(c.id), keyOf)) {
      const list = bySellerMap.get(key);
      if (list) list.push(c);
      else bySellerMap.set(key, [c]);
    }
  }
  const bySeller: SellerMetrics[] = [...bySellerMap.entries()]
    .map(([sellerId, list]) => ({ sellerId, ...groupMetrics(list, stats, attendance, keyOf, sellerId) }))
    .sort((a, b) => Number(a.sellerId == null) - Number(b.sellerId == null) || b.conversations - a.conversations);

  const byChannel: Record<Channel, number> = { whatsapp: 0, instagram: 0, other: 0 };
  for (const c of convs) byChannel[channelOf(c.origin)] += 1;

  // Por dia: conversas pela última mensagem no período; respostas pelo dia em que o cliente escreveu.
  const convByDay = new Map<string, number>();
  for (const c of convs) {
    const d = storeDayOf(c.period_last_at ?? c.occurred_at);
    convByDay.set(d, (convByDay.get(d) ?? 0) + 1);
  }
  const respByDay = new Map<string, number[]>();
  for (const c of convs) {
    for (const r of stats.get(c.id)?.rounds ?? []) {
      if (focus !== undefined && responderKey(r.responderId) !== focus) continue;
      const d = storeDayOf(r.openedAt);
      const arr = respByDay.get(d) ?? [];
      arr.push(r.seconds);
      respByDay.set(d, arr);
    }
  }
  const allDays = days.length ? days : [...new Set([...convByDay.keys(), ...respByDay.keys()])].sort();
  const byDay = allDays.map((date) => ({
    date,
    conversations: convByDay.get(date) ?? 0,
    avgResponseSeconds: average(respByDay.get(date) ?? []),
  }));

  const awaitingList: AwaitingConversation[] = convs
    .map((conversation) => {
      const s = stats.get(conversation.id);
      return {
        conversation,
        since: s?.awaitingSince ?? null,
        attendantKey: responderKey(s?.lastResponderId ?? null),
        answered: !!s?.hadHumanReply,
      };
    })
    .filter((x): x is AwaitingConversation => x.since != null && (focus === undefined || x.attendantKey === focus))
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since));

  return { ...groupMetrics(convs, stats, attendance, keyOf, focus), bySeller, byChannel, byDay, awaitingList };
}

/** "4 min", "1 h 12 min", "2 d 3 h" — tempo de resposta legível. */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const restMin = min % 60;
  if (h < 24) return restMin ? `${h} h ${restMin} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const restH = h % 24;
  return restH ? `${d} d ${restH} h` : `${d} d`;
}

/** Variação percentual entre dois valores (null quando não há base de comparação). */
export function variation(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
