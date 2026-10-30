/**
 * Quem realmente atendeu cada conversa — pelo AUTOR das mensagens, nunca pelo responsável do lead.
 *
 * Evidências usadas (todas gravadas pela integração Kommo em conversation_messages):
 * - Vendedor (sender = seller) traz sender_id = id do usuário do Kommo que enviou → atendente identificado.
 *   Vale também para os marcadores sem texto (created_by do evento do Kommo).
 * - Salesbot / Bot → automação.
 * - Autor com o nome do canal ("WhatsApp Business", "WhatsApp Lite", "Instagram"): mensagem enviada
 *   fora do Kommo, direto pelo aparelho. Se o mesmo texto se repete em 3+ conversas é resposta
 *   automática do canal (saudação/ausência); senão foi digitada por alguém → humano sem identificação.
 * - "Automação ou envio externo" (marcador sem texto e sem autor, comum antes de 27/10) → não dá para
 *   saber se foi pessoa ou automação.
 *
 * O responsável atual do lead só serve para o sinal "aguardando distribuição": lead nas mãos de um
 * usuário do Kommo que não é vendedor vinculado (ex.: a conta do supervisor) e sem resposta humana.
 */

export type AttendanceStatus = 'atendida' | 'nao_atendida' | 'atendente_nao_identificado' | 'automatico' | 'nao_determinado';

/** Ordem de exibição dos status (indicadores e filtros). */
export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'atendida',
  'nao_atendida',
  'atendente_nao_identificado',
  'automatico',
  'nao_determinado',
];

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  atendida: 'Atendida',
  nao_atendida: 'Não atendida',
  atendente_nao_identificado: 'Atendente não identificado',
  automatico: 'Atendimento automático',
  nao_determinado: 'Status não determinado',
};

/** Filtro de status da lista de conversas (?status=). Inclui o sinal de distribuição. */
export type AttendanceFilter = AttendanceStatus | 'aguardando_distribuicao';

export function filterLabel(f: AttendanceFilter): string {
  return f === 'aguardando_distribuicao' ? 'Aguardando distribuição' : ATTENDANCE_LABEL[f];
}

export function isAttendanceFilter(v: string | null): v is AttendanceFilter {
  return v === 'aguardando_distribuicao' || (ATTENDANCE_STATUSES as string[]).includes(v ?? '');
}

/** Tipo de uma mensagem que não é do cliente. */
export type OutgoingKind = 'human' | 'external' | 'automatic' | 'unknown';

export interface AuthoredMessage {
  sender: 'client' | 'seller' | 'bot' | 'system';
  sender_id?: string | null;
  sender_name?: string | null;
  message_type?: string | null;
  /** O texto desta mensagem se repete em várias conversas (ver templateTexts). */
  template?: boolean;
}

const AUTOMATION_NAMES = new Set(['salesbot', 'bot']);
const UNKNOWN_AUTHOR_NAMES = new Set(['automação ou envio externo']);

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function outgoingKind(m: AuthoredMessage): OutgoingKind | null {
  if (m.sender === 'client' || m.sender === 'system') return null;
  if (m.sender === 'seller') return m.sender_id ? 'human' : 'external';
  const name = norm(m.sender_name);
  if (AUTOMATION_NAMES.has(name)) return 'automatic';
  if (UNKNOWN_AUTHOR_NAMES.has(name) || m.message_type === 'unavailable' || !name) return 'unknown';
  return m.template ? 'automatic' : 'external';
}

/** Quantas conversas diferentes precisam ter o mesmo texto para ele contar como resposta pronta. */
export const TEMPLATE_MIN_CONVERSATIONS = 3;

export interface BotText {
  id: string;
  conversation_id: string;
  message: string | null;
}

export const normalizeTemplateText = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Textos (normalizados) que aparecem em 3+ conversas diferentes — respostas prontas do canal. */
export function templateTexts(rows: BotText[], minConversations = TEMPLATE_MIN_CONVERSATIONS): Set<string> {
  const convsByText = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const t = normalizeTemplateText(r.message);
    if (!t) continue;
    const set = convsByText.get(t) ?? new Set<string>();
    set.add(r.conversation_id);
    convsByText.set(t, set);
  }
  return new Set([...convsByText].filter(([, convs]) => convs.size >= minConversations).map(([t]) => t));
}

/** Ids das mensagens cujo texto é resposta pronta (ver templateTexts). */
export function templateMessageIds(rows: BotText[], minConversations = TEMPLATE_MIN_CONVERSATIONS): Set<string> {
  const texts = templateTexts(rows, minConversations);
  return new Set(rows.filter((r) => texts.has(normalizeTemplateText(r.message))).map((r) => r.id));
}

/** Mensagem com o nome do canal como autor e com texto — a única que pode ser resposta pronta. */
export function isChannelAuthored(m: AuthoredMessage): boolean {
  const name = norm(m.sender_name);
  return m.sender === 'bot' && !!name && !AUTOMATION_NAMES.has(name) && !UNKNOWN_AUTHOR_NAMES.has(name) && m.message_type !== 'unavailable';
}

export interface MessageCounts {
  client: number;
  human: number;
  external: number;
  automatic: number;
  unknown: number;
}

export interface ConversationAttendance {
  status: AttendanceStatus;
  /** Usuários do Kommo que responderam, na ordem da primeira resposta, com quantas mensagens. */
  attendants: { kommoUserId: string; messages: number }[];
  /** Sem resposta humana e o lead está com quem não é vendedor vinculado. */
  awaitingDistribution: boolean;
  /** Responsável atual do lead no Kommo; undefined = não consultado, null = lead não encontrado. */
  responsibleId: string | null | undefined;
  counts: MessageCounts;
  reason: string;
}

export interface AttendanceContext {
  /** Responsável atual por lead (ausente = não consultado). */
  responsibleByLead?: Map<string, string | null>;
  /** Usuários do Kommo vinculados a um vendedor (sellers.kommo_user_id). */
  linkedKommoUsers: Set<string>;
}

export function countMessages<T extends AuthoredMessage>(messages: T[]): MessageCounts {
  const counts: MessageCounts = { client: 0, human: 0, external: 0, automatic: 0, unknown: 0 };
  for (const m of messages) {
    if (m.sender === 'client') counts.client += 1;
    else {
      const kind = outgoingKind(m);
      if (kind) counts[kind] += 1;
    }
  }
  return counts;
}

/**
 * Status de uma conversa a partir das mensagens (já em ordem cronológica) e do responsável do lead.
 * Um único status por conversa — os totais nunca contam a mesma conversa duas vezes; "aguardando
 * distribuição" é um sinal à parte que pode acompanhar "não atendida" ou "atendimento automático".
 */
export function classifyAttendance<T extends AuthoredMessage>(
  messages: T[],
  leadId: string | null,
  ctx: AttendanceContext
): ConversationAttendance {
  const counts = countMessages(messages);
  const attendantOrder: string[] = [];
  const perUser = new Map<string, number>();
  for (const m of messages) {
    if (outgoingKind(m) !== 'human' || !m.sender_id) continue;
    if (!perUser.has(m.sender_id)) attendantOrder.push(m.sender_id);
    perUser.set(m.sender_id, (perUser.get(m.sender_id) ?? 0) + 1);
  }
  const attendants = attendantOrder.map((kommoUserId) => ({ kommoUserId, messages: perUser.get(kommoUserId) ?? 0 }));

  let status: AttendanceStatus;
  let reason: string;
  if (attendants.length) {
    status = 'atendida';
    reason =
      attendants.length > 1
        ? 'Mais de um atendente respondeu; cada um foi identificado pelo usuário do Kommo que enviou a mensagem.'
        : 'Atendente identificado pelo usuário do Kommo que enviou a resposta.';
    if (counts.external) reason += ' Também houve envio pelo aparelho, sem identificação.';
  } else if (counts.external) {
    status = 'atendente_nao_identificado';
    reason = 'Houve resposta humana enviada direto pelo WhatsApp/Instagram, fora do Kommo; o Kommo não informa quem digitou.';
  } else if (counts.unknown) {
    status = 'nao_determinado';
    reason = 'Há resposta registrada sem autor e sem texto no Kommo; não dá para saber se foi uma pessoa ou automação.';
  } else if (counts.automatic) {
    status = 'automatico';
    reason = 'Somente o Salesbot ou respostas automáticas do canal responderam.';
  } else if (counts.client) {
    status = 'nao_atendida';
    reason = 'O cliente enviou mensagem e nenhuma resposta humana foi encontrada.';
  } else {
    status = 'nao_determinado';
    reason = 'Não há mensagens suficientes no período para classificar.';
  }

  const responsibleId = leadId && ctx.responsibleByLead?.has(leadId) ? (ctx.responsibleByLead.get(leadId) ?? null) : undefined;
  const awaitingDistribution =
    (status === 'nao_atendida' || status === 'automatico') && !!responsibleId && !ctx.linkedKommoUsers.has(responsibleId);
  if (awaitingDistribution) reason += ' O lead está com um usuário do Kommo que não é vendedor vinculado: aguardando distribuição.';

  return { status, attendants, awaitingDistribution, responsibleId, counts, reason };
}

export type AttendanceTotals = Record<AttendanceStatus, number> & { aguardando_distribuicao: number; total: number };

export function attendanceTotals(items: Iterable<ConversationAttendance>): AttendanceTotals {
  const totals: AttendanceTotals = {
    atendida: 0,
    nao_atendida: 0,
    atendente_nao_identificado: 0,
    automatico: 0,
    nao_determinado: 0,
    aguardando_distribuicao: 0,
    total: 0,
  };
  for (const a of items) {
    totals[a.status] += 1;
    totals.total += 1;
    if (a.awaitingDistribution) totals.aguardando_distribuicao += 1;
  }
  return totals;
}

export function matchesAttendanceFilter(a: ConversationAttendance, f: AttendanceFilter): boolean {
  return f === 'aguardando_distribuicao' ? a.awaitingDistribution : a.status === f;
}

/**
 * "Conversas processadas" como o painel do Kommo conta (conferido com o painel de 28/10/2026):
 * para cada autor, quantos atendimentos (talks) diferentes receberam pelo menos uma mensagem dele
 * no período. "Robô" = autores que não são usuários (Salesbot e envios com o nome do canal), cada
 * um contado à parte e somado — um atendimento com Salesbot e envio pelo Instagram conta 2. O total
 * é a soma das linhas, não o número de conversas diferentes. Marcadores sem autor ficam de fora.
 */
export interface KommoProcessed {
  users: { kommoUserId: string; talks: number }[];
  robot: { total: number; uniqueTalks: number; byAuthor: { name: string; talks: number }[] };
  total: number;
  /** Atendimentos diferentes com mensagem enviada (usuário ou robô). */
  uniqueTalks: number;
  withoutAuthor: { messages: number; talks: number };
}

export interface TalkMessage extends AuthoredMessage {
  conversation_id: string;
  kommo_talk_id?: string | null;
}

export function kommoProcessedConversations(messages: TalkMessage[]): KommoProcessed {
  const users = new Map<string, Set<string>>();
  const robots = new Map<string, Set<string>>();
  const robotTalks = new Set<string>();
  const allTalks = new Set<string>();
  const noAuthorTalks = new Set<string>();
  let noAuthorMessages = 0;
  for (const m of messages) {
    if (m.sender !== 'seller' && m.sender !== 'bot') continue;
    const talk = m.kommo_talk_id || `conv:${m.conversation_id}`;
    const name = (m.sender_name ?? '').trim();
    if (m.sender === 'seller' && m.sender_id) {
      const set = users.get(m.sender_id) ?? new Set<string>();
      set.add(talk);
      users.set(m.sender_id, set);
      allTalks.add(talk);
    } else if (m.sender === 'bot' && name && !UNKNOWN_AUTHOR_NAMES.has(norm(name))) {
      const set = robots.get(name) ?? new Set<string>();
      set.add(talk);
      robots.set(name, set);
      robotTalks.add(talk);
      allTalks.add(talk);
    } else {
      noAuthorMessages += 1;
      noAuthorTalks.add(talk);
    }
  }
  const byAuthor = [...robots].map(([name, set]) => ({ name, talks: set.size })).sort((a, b) => b.talks - a.talks);
  const robotTotal = byAuthor.reduce((n, r) => n + r.talks, 0);
  const userRows = [...users].map(([kommoUserId, set]) => ({ kommoUserId, talks: set.size })).sort((a, b) => b.talks - a.talks);
  return {
    users: userRows,
    robot: { total: robotTotal, uniqueTalks: robotTalks.size, byAuthor },
    total: userRows.reduce((n, r) => n + r.talks, 0) + robotTotal,
    uniqueTalks: allTalks.size,
    withoutAuthor: { messages: noAuthorMessages, talks: noAuthorTalks.size },
  };
}
