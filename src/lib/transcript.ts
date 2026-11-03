import type { ConversationMessage } from './database.types';

export type TranscriptSender = 'client' | 'seller' | 'bot' | 'system';

export interface TranscriptMessage {
  id: string;
  sender: TranscriptSender;
  senderName: string;
  text: string;
  /** Tipo do anexo do Kommo quando não é texto (picture, file, voice...). */
  attachmentType: string | null;
  /** Mensagem conhecida só pela events API do Kommo: autor e horário reais, texto indisponível. */
  unavailable: boolean;
  /** Horário para exibição — derivado de sent_at (UTC) uma única vez, no fuso do navegador. */
  time: string;
  /** Data completa, preenchida só quando o dia muda em relação à mensagem anterior. */
  dayLabel: string | null;
  /** Instante original (UTC), para comparar com o período escolhido. */
  sentAt: string;
}

type TimelineRow = Pick<ConversationMessage, 'id' | 'sender' | 'message' | 'sent_at'> &
  Partial<Pick<ConversationMessage, 'sender_name' | 'message_type' | 'received_seq'>>;

/**
 * Ordem cronológica estável: horário original do Kommo (sent_at, UTC), depois a ordem de
 * chegada no banco (received_seq) para mensagens do mesmo segundo, e por fim o id.
 */
export function compareTimeline(a: TimelineRow, b: TimelineRow): number {
  const ta = Date.parse(a.sent_at);
  const tb = Date.parse(b.sent_at);
  if (ta !== tb) return ta - tb;
  const sa = a.received_seq ?? Number.MAX_SAFE_INTEGER;
  const sb = b.received_seq ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const SENDERS: readonly TranscriptSender[] = ['client', 'seller', 'bot', 'system'];

/**
 * Monta a transcrição exibida. O nome mostrado é o autor gravado na mensagem; quando o Kommo não
 * informou o autor de uma mensagem da empresa, mostra "Atendente" em vez de presumir que foi o
 * vendedor responsável pelo lead (a mensagem pode ter vindo de outro usuário ou do app do WhatsApp).
 */
export function buildTranscript(
  rows: TimelineRow[],
  names: { clientName: string },
  timeZone?: string
): TranscriptMessage[] {
  const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone });
  const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone });

  let previousDay: string | null = null;
  return [...rows].sort(compareTimeline).map((m) => {
    // O remetente vem do banco já classificado pela integração — nunca é inferido aqui.
    const sender: TranscriptSender = SENDERS.includes(m.sender as TranscriptSender)
      ? (m.sender as TranscriptSender)
      : 'system';
    const fallbackName =
      sender === 'seller' ? 'Atendente' : sender === 'client' ? names.clientName : sender === 'bot' ? 'Bot' : 'Sistema';
    const date = new Date(m.sent_at);
    const day = dayFmt.format(date);
    const dayLabel = day !== previousDay ? day : null;
    previousDay = day;
    const messageType = m.message_type ?? 'text';
    return {
      id: m.id,
      sender,
      senderName: m.sender_name?.trim() || fallbackName,
      text: m.message,
      attachmentType: messageType !== 'text' && messageType !== 'unavailable' ? messageType : null,
      unavailable: messageType === 'unavailable',
      time: timeFmt.format(date),
      dayLabel,
      sentAt: m.sent_at,
    };
  });
}

export type PeriodPosition = 'before' | 'in' | 'after';

export interface TranscriptCounts {
  client: number;
  seller: number;
  bot: number;
}

export interface TranscriptPeriodView {
  /** Posição de cada mensagem (mesma ordem da transcrição) em relação a [início, fim) do período. */
  positions: PeriodPosition[];
  /** Contagens só das mensagens dentro do período (as que definem o status) e de todo o histórico exibido. */
  inPeriod: TranscriptCounts;
  all: TranscriptCounts;
  /** Índice da primeira mensagem depois do fim do período (−1 = nenhuma). */
  firstAfter: number;
  /** Índice da primeira mensagem do período quando há histórico anterior a ele (−1 = não há). */
  firstInAfterBefore: number;
}

/**
 * Situa cada mensagem da transcrição no período escolhido no Meu Supervisor. Só exibição: o status
 * do atendimento continua calculado apenas com as mensagens do período (classifyConversations);
 * resposta posterior aparece no histórico, marcada, e não muda o status daquele período.
 */
export function transcriptPeriodView(transcript: Pick<TranscriptMessage, 'sender' | 'sentAt'>[], fromIso: string, toIso: string): TranscriptPeriodView {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const inPeriod: TranscriptCounts = { client: 0, seller: 0, bot: 0 };
  const all: TranscriptCounts = { client: 0, seller: 0, bot: 0 };
  let firstAfter = -1;
  let firstIn = -1;
  let hasBefore = false;
  const positions = transcript.map((m, i): PeriodPosition => {
    const t = Date.parse(m.sentAt);
    const pos: PeriodPosition = t < from ? 'before' : t >= to ? 'after' : 'in';
    if (m.sender === 'client' || m.sender === 'seller' || m.sender === 'bot') {
      all[m.sender] += 1;
      if (pos === 'in') inPeriod[m.sender] += 1;
    }
    if (pos === 'after' && firstAfter < 0) firstAfter = i;
    if (pos === 'in' && firstIn < 0) firstIn = i;
    if (pos === 'before') hasBefore = true;
    return pos;
  });
  return { positions, inPeriod, all, firstAfter, firstInAfterBefore: hasBefore ? firstIn : -1 };
}
