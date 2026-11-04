/**
 * Leituras da Central de Avisos (só administrador: `sales`, `financial_sync_runs` e
 * `financial_reconcile_attempts` têm RLS `admin_read`). Nada é gravado.
 *
 * - `fetchNotices`: monta os avisos a partir dos dados atuais (uma consulta por tipo de aviso; hoje
 *   nenhum tipo global — pendências de conciliação ficam só no botão do Dashboard).
 * - `fetchNoticeSignature`: duas leituras de 1 linha (índices em started_at/created_at) que mudam a
 *   cada sincronização ou conciliação — os avisos só são relidos quando a assinatura muda.
 */
import { supabase } from '../supabaseClient';
import { sortNotices, type Notice } from './notices';

/**
 * Avisos globais do sino. Pendências de conciliação (inclusive "sem custo no Mercado Phone") NÃO
 * entram: no Dashboard o único sinal delas é o botão "Atualizar dados" amarelo. Novos tipos de aviso
 * (integrações, falhas que exigem ação) entram aqui.
 */
export async function fetchNotices(): Promise<Notice[]> {
  return sortNotices([]);
}

export async function fetchNoticeSignature(): Promise<string> {
  const [run, attempt] = await Promise.all([
    supabase.from('financial_sync_runs').select('id, status, finished_at').order('started_at', { ascending: false }).limit(1),
    supabase.from('financial_reconcile_attempts').select('id').order('created_at', { ascending: false }).limit(1),
  ]);
  if (run.error) throw new Error(run.error.message);
  if (attempt.error) throw new Error(attempt.error.message);
  return JSON.stringify([run.data?.[0] ?? null, (attempt.data as { id: string }[] | null)?.[0]?.id ?? null]);
}

/** Evento disparado depois de uma conciliação manual: a central relê na hora. */
export const FINANCIAL_UPDATED_EVENT = 'upclass:financial-updated';

export function notifyFinancialUpdated() {
  window.dispatchEvent(new Event(FINANCIAL_UPDATED_EVENT));
}
