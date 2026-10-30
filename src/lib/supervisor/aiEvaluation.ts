import { classifyAttendance, outgoingKind, type AuthoredMessage } from './attendance.ts';
import { byTimeline } from './metrics.ts';

/**
 * Quem o Supervisor IA vai avaliar em cada conversa (ainda DESATIVADO: nada aqui chama IA, rede ou
 * banco). Mesma regra auditada do Meu Supervisor (classifyAttendance): avaliado = usuário do Kommo
 * que ENVIOU mensagem humana no período, nunca o responsável do lead. Cada participante identificado
 * gera um alvo próprio, com só as mensagens dele como "dele"; o resto da conversa é contexto.
 */

/** Versão da regra de atribuição gravada junto de cada avaliação futura. Mude ao mudar a regra. */
export const ATTRIBUTION_RULE_VERSION = 'autor-da-mensagem-v1';

export interface EvaluationMessage extends AuthoredMessage {
  id: string;
  conversation_id: string;
  sent_at: string;
  received_seq?: number | null;
}

export interface EvaluationParticipant {
  kommoUserId: string;
  /** Vendedor vinculado a esse usuário do Kommo (sellers.kommo_user_id); null = não vinculado. */
  sellerId: string | null;
  messages: number;
}

export interface EvaluationTarget {
  conversationId: string;
  /** Usuário do Kommo avaliado (autor das mensagens). */
  kommoUserId: string;
  sellerId: string | null;
  /** Só vendedor vinculado recebe avaliação individual; os demais ficam registrados como participantes. */
  eligible: boolean;
  ineligibleReason: string | null;
  /** Mensagens enviadas pelo avaliado no período — a base da avaliação dele. */
  ownMessageIds: string[];
  /** Todas as mensagens do período na ordem real (contexto: cliente, outros atendentes, robô). */
  contextMessageIds: string[];
  otherParticipants: EvaluationParticipant[];
  /** Respostas humanas sem autor identificável (envio pelo aparelho) — nunca contam para ninguém. */
  unidentifiedHumanMessages: number;
  /** Salesbot e respostas prontas do canal. */
  automaticMessages: number;
  /** Marcadores sem autor e sem texto: não dá para saber se foi pessoa ou automação. */
  unknownAuthorMessages: number;
  period: { from: string; to: string };
  attribution: 'autor_da_mensagem';
  ruleVersion: string;
}

/**
 * Alvos de avaliação de uma conversa no período [from, to). Conversa sem atendente identificado
 * (só cliente, só robô ou só envio pelo aparelho) não gera alvo: não há quem avaliar com segurança.
 * Quem chama deve: passar em `sellerByKommoUser` só vendedores ATIVOS (inativo fica não elegível,
 * como no Meu Supervisor) e marcar `template` nas mensagens (respostas prontas, ver templateTexts em
 * loadPeriodBase) — sem isso respostas prontas contam como envio pelo aparelho (os alvos não mudam).
 */
export function buildEvaluationTargets(
  conversationId: string,
  messages: EvaluationMessage[],
  period: { from: string; to: string },
  sellerByKommoUser: Map<string, string>
): EvaluationTarget[] {
  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(period.to);
  const seen = new Set<string>();
  const inPeriod = messages
    .filter((m) => m.conversation_id === conversationId)
    .filter((m) => {
      const t = Date.parse(m.sent_at);
      if (Number.isNaN(t) || t < fromMs || t >= toMs || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .sort(byTimeline);

  const { attendants, counts } = classifyAttendance(inPeriod, null, { linkedKommoUsers: new Set(sellerByKommoUser.keys()) });
  const participants: EvaluationParticipant[] = attendants.map((a) => ({
    kommoUserId: a.kommoUserId,
    sellerId: sellerByKommoUser.get(a.kommoUserId) ?? null,
    messages: a.messages,
  }));
  const contextMessageIds = inPeriod.map((m) => m.id);

  return participants.map((p) => ({
    conversationId,
    kommoUserId: p.kommoUserId,
    sellerId: p.sellerId,
    eligible: p.sellerId != null,
    ineligibleReason: p.sellerId != null ? null : 'Usuário do Kommo sem vendedor vinculado',
    ownMessageIds: inPeriod.filter((m) => outgoingKind(m) === 'human' && m.sender_id === p.kommoUserId).map((m) => m.id),
    contextMessageIds,
    otherParticipants: participants.filter((o) => o.kommoUserId !== p.kommoUserId),
    unidentifiedHumanMessages: counts.external,
    automaticMessages: counts.automatic,
    unknownAuthorMessages: counts.unknown,
    period,
    attribution: 'autor_da_mensagem',
    ruleVersion: ATTRIBUTION_RULE_VERSION,
  }));
}
