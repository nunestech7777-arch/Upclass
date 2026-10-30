import { outgoingKind } from './attendance.ts';

/**
 * Base do Supervisor IA (ainda NÃO ativado: nenhuma chamada de IA é feita a partir daqui).
 * Define os critérios de avaliação e prepara a transcrição que um futuro avaliador receberá —
 * sempre a partir das mensagens reais gravadas pela integração Kommo.
 */

export interface SupervisorCriterion {
  key: string;
  label: string;
  description: string;
}

export const SUPERVISOR_CRITERIA: readonly SupervisorCriterion[] = [
  { key: 'approach', label: 'Abordagem comercial', description: 'Abertura, apresentação do produto e condução para a compra.' },
  { key: 'courtesy', label: 'Educação e profissionalismo', description: 'Cordialidade, linguagem adequada e postura com o cliente.' },
  { key: 'clarity', label: 'Clareza das respostas', description: 'Respostas objetivas, completas e sem ambiguidade.' },
  { key: 'response_time', label: 'Tempo de resposta', description: 'Agilidade entre a mensagem do cliente e o retorno do vendedor.' },
  { key: 'needs', label: 'Entendimento da necessidade', description: 'Perguntas certas para entender o que o cliente procura.' },
  { key: 'follow_up', label: 'Acompanhamento comercial', description: 'Retorno ao cliente que parou de responder e próximos passos combinados.' },
  { key: 'missed', label: 'Oportunidades perdidas', description: 'Pedidos sem resposta, objeções não tratadas e vendas adicionais não oferecidas.' },
  { key: 'negotiation', label: 'Qualidade da negociação', description: 'Tratamento de preço, formas de pagamento, troca e garantia.' },
  { key: 'strengths', label: 'Pontos fortes e de melhoria', description: 'Síntese do que o vendedor fez bem e do que pode melhorar.' },
];

/** Avaliação que o Supervisor IA vai produzir — cada nota precisa citar trechos reais. */
export interface CriterionEvaluation {
  score: number;
  evidence: string[];
}

/**
 * Uma avaliação por PARTICIPANTE (ver buildEvaluationTargets em aiEvaluation.ts): conversa com
 * Caroline e Yasmin gera duas, cada uma sobre as mensagens da própria pessoa. Chave única futura:
 * (conversationId, kommoUserId, hash de messageIds, ruleVersion) — pelas mensagens avaliadas, não
 * pelo período: as mesmas mensagens vistas no filtro "dia" e "semana" não são avaliadas (e pagas) duas vezes.
 */
export interface ConversationEvaluation {
  conversationId: string;
  kommoUserId: string;
  sellerId: string;
  /** Mensagens do avaliado usadas como base (EvaluationTarget.ownMessageIds). */
  messageIds: string[];
  period: { from: string; to: string };
  otherParticipants: string[];
  attribution: 'autor_da_mensagem';
  ruleVersion: string;
  criteria: Record<string, CriterionEvaluation>;
  strengths: string[];
  improvements: string[];
  opportunities: string[];
  model: string;
  evaluatedAt: string;
}

export interface TranscriptInputMessage {
  sender: 'client' | 'seller' | 'bot' | 'system';
  sender_id?: string | null;
  sender_name: string | null;
  message: string;
  message_type: string | null;
  sent_at: string;
  /** Resposta pronta do canal (texto repetido, ver templateTexts). */
  template?: boolean;
}

export interface TranscriptOptions {
  /** Usuário do Kommo avaliado: as mensagens dele saem como "Vendedor avaliado", as dos outros como "Outro atendente". */
  evaluatedKommoUserId?: string;
  /** Nome a mostrar para um usuário do Kommo (em vez do sender_name gravado). */
  nameOf?: (kommoUserId: string) => string;
}

/**
 * Transcrição em texto para o avaliador: horário da loja, papel e texto. Mensagens que o Kommo não
 * entregou com texto ficam marcadas como indisponíveis — o avaliador não pode presumir o conteúdo.
 * O papel vem do AUTOR (outgoingKind): robô e envio sem autor nunca aparecem como vendedor, e com
 * `evaluatedKommoUserId` as mensagens de outro atendente ficam separadas das do avaliado.
 */
export function buildAnalysisTranscript(messages: TranscriptInputMessage[], options: TranscriptOptions = {}): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const { evaluatedKommoUserId, nameOf } = options;
  const roleOf = (m: TranscriptInputMessage): string => {
    if (m.sender === 'client') return 'Cliente';
    const kind = outgoingKind(m);
    if (kind === 'human' && m.sender_id) {
      const name = nameOf?.(m.sender_id) || m.sender_name?.trim() || m.sender_id;
      if (!evaluatedKommoUserId) return `Vendedor (${name})`;
      return m.sender_id === evaluatedKommoUserId ? `Vendedor avaliado (${name})` : `Outro atendente (${name})`;
    }
    if (kind === 'external') return 'Atendente não identificado (enviado pelo aparelho)';
    if (kind === 'automatic') return m.sender === 'bot' && /^(salesbot|bot)$/i.test(m.sender_name?.trim() ?? '') ? 'Robô (Salesbot)' : 'Resposta automática do canal';
    return 'Autor desconhecido';
  };
  return [...messages]
    .sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at))
    .filter((m) => m.sender !== 'system')
    .map((m) => {
      const who = roleOf(m);
      const type = m.message_type ?? 'text';
      const body =
        type === 'unavailable'
          ? '[mensagem sem texto disponível]'
          : type !== 'text'
            ? `[${type}]${m.message.trim() ? ` ${m.message.trim()}` : ''}`
            : m.message.trim();
      return `[${fmt.format(new Date(m.sent_at))}] ${who}: ${body}`;
    })
    .join('\n');
}
