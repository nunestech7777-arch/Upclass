import type { AttendanceStatus, ConversationAttendance } from './attendance.ts';
import type { AwaitingConversation } from './metrics.ts';

/**
 * Conciliação de "Clientes sem resposta" (conversas que terminaram o período com mensagem do cliente
 * pendente, `awaitingList` de summarize) pela situação de atendimento da conversa no período
 * (classifyAttendance). Só agrupa: não recalcula nada, então a soma é sempre a mesma lista do total.
 */
export type AwaitingCategory = 'nunca_atendida' | 'atendida_pendente' | 'nao_determinada' | 'automatica' | 'nao_identificado';

export const AWAITING_CATEGORIES: readonly AwaitingCategory[] = ['nunca_atendida', 'atendida_pendente', 'nao_determinada', 'automatica', 'nao_identificado'];

export const AWAITING_CATEGORY_LABEL: Record<AwaitingCategory, string> = {
  nunca_atendida: 'Nunca atendidas',
  atendida_pendente: 'Atendidas, com nova mensagem pendente',
  nao_determinada: 'Não determinadas',
  automatica: 'Somente automáticas',
  nao_identificado: 'Atendente não identificado',
};

const BY_STATUS: Record<AttendanceStatus, AwaitingCategory> = {
  nao_atendida: 'nunca_atendida',
  atendida: 'atendida_pendente',
  nao_determinado: 'nao_determinada',
  automatico: 'automatica',
  atendente_nao_identificado: 'nao_identificado',
};

export function isAwaitingCategory(v: string | null): v is AwaitingCategory {
  return !!v && (AWAITING_CATEGORIES as readonly string[]).includes(v);
}

export interface AwaitingBreakdown {
  total: number;
  counts: Record<AwaitingCategory, number>;
  /** Conversas de cada categoria (ids), para a lista ao clicar. */
  ids: Record<AwaitingCategory, Set<string>>;
  /** Conversas sem status no período (não deveria acontecer): impedem o selo "Conferida". */
  unclassified: number;
  /**
   * Conferida: a lista tem exatamente o total de "Clientes sem resposta" (sem conversa repetida) e
   * todas as conversas têm status no período — então as cinco categorias somam o total.
   */
  reconciled: boolean;
}

export function awaitingBreakdown(list: AwaitingConversation[], attendance: Map<string, ConversationAttendance>, expectedTotal: number): AwaitingBreakdown {
  const counts = Object.fromEntries(AWAITING_CATEGORIES.map((c) => [c, 0])) as Record<AwaitingCategory, number>;
  const ids = Object.fromEntries(AWAITING_CATEGORIES.map((c) => [c, new Set<string>()])) as Record<AwaitingCategory, Set<string>>;
  let unclassified = 0;
  const seen = new Set<string>();
  for (const { conversation } of list) {
    if (seen.has(conversation.id)) continue;
    seen.add(conversation.id);
    const status = attendance.get(conversation.id)?.status;
    const cat = status ? BY_STATUS[status] : undefined;
    if (!cat) {
      unclassified += 1;
      continue;
    }
    counts[cat] += 1;
    ids[cat].add(conversation.id);
  }
  return { total: seen.size, counts, ids, unclassified, reconciled: unclassified === 0 && list.length === seen.size && seen.size === expectedTotal };
}
