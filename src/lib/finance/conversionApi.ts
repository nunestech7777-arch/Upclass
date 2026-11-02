import { supabase } from '../supabaseClient';
import { storeToday } from './dates';
import { attendanceCacheKey, isMissingFunctionError } from './conversionRanking';
import { periodTtlMs } from '../supervisor/cachePolicy';
import { createSwrStore } from '../supervisor/swrStore';
import { rangeToInstants, type StoreRange } from '../supervisor/filters';

/*
 * Conversas atendidas por usuário do Kommo no período (Ranking de Conversão), contadas no banco pela
 * função da migração 0021. Só contagens, só na memória desta aba; a chave leva a conta logada e o
 * cache some no logout ou na troca de conta.
 */
const store = createSwrStore<Map<string, number>>(Date.now, 12);
let scope = 'anon';

supabase.auth.onAuthStateChange((_event, session) => {
  const next = session?.user.id ?? 'anon';
  if (next === scope) return;
  scope = next;
  store.clear();
});

/** A migração 0021 ainda não foi aplicada no banco. */
export class AttendanceCountPendingError extends Error {}

async function countAttended(range: StoreRange): Promise<Map<string, number>> {
  const { fromIso, toIso } = rangeToInstants(range);
  const { data, error } = await supabase.rpc('kommo_attended_conversations', { p_from: fromIso, p_to: toIso });
  if (error) {
    // Contar no navegador não serve de alternativa: a consulta sem o índice da 0021 estoura o tempo limite.
    if (isMissingFunctionError(error)) throw new AttendanceCountPendingError(error.message);
    throw new Error(error.message);
  }
  return new Map((data ?? []).map((r) => [String(r.kommo_user_id), Number(r.conversations)]));
}

/** Atendimentos do período, em cache (2 min com hoje no período; 30 min só com dias passados). */
export function loadAttendedConversations(range: StoreRange, opts: { force?: boolean } = {}): Promise<Map<string, number>> {
  const today = storeToday();
  return store.load(attendanceCacheKey(scope, range, today), () => countAttended(range), { ttlMs: periodTtlMs(range, today), force: opts.force });
}

/** Valor já em cache para o período (mesmo vencido): trocar de período não pisca o card. */
export function peekAttendedConversations(range: StoreRange): Map<string, number> | undefined {
  return store.peek(attendanceCacheKey(scope, range, storeToday()))?.data;
}
