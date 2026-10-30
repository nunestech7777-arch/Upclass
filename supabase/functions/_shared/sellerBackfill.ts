/**
 * Preenche o vendedor de conversas que ficaram sem (seller_id nulo) porque o responsável do lead
 * no Kommo ainda não estava vinculado a um vendedor quando a conversa foi gravada. Mesma regra da
 * ingestão (kommoIngest.resolveSellerId): vendedor = sellers.kommo_user_id do responsável do lead.
 * Só planeja — quem grava decide; conversa que já tem vendedor nunca entra aqui.
 */

export interface UnassignedConversation {
  id: string;
  kommo_lead_id: string | null;
}

export interface BackfillPlan {
  assignments: Array<{ id: string; seller_id: string }>;
  bySeller: Record<string, number>;
  /** Responsável do lead existe no Kommo, mas não está vinculado a nenhum vendedor. */
  unlinkedResponsible: Record<string, number>;
  /** Lead não voltou do Kommo (apagado/mesclado) ou conversa sem lead. */
  leadNotFound: number;
}

export function planSellerBackfill(
  conversations: UnassignedConversation[],
  responsibleByLead: Map<string, string>,
  sellerByKommoUser: Map<string, string>
): BackfillPlan {
  const plan: BackfillPlan = { assignments: [], bySeller: {}, unlinkedResponsible: {}, leadNotFound: 0 };
  for (const c of conversations) {
    const responsible = c.kommo_lead_id ? responsibleByLead.get(c.kommo_lead_id) : undefined;
    if (!responsible) {
      plan.leadNotFound += 1;
      continue;
    }
    const sellerId = sellerByKommoUser.get(responsible);
    if (!sellerId) {
      plan.unlinkedResponsible[responsible] = (plan.unlinkedResponsible[responsible] ?? 0) + 1;
      continue;
    }
    plan.assignments.push({ id: c.id, seller_id: sellerId });
    plan.bySeller[sellerId] = (plan.bySeller[sellerId] ?? 0) + 1;
  }
  return plan;
}
