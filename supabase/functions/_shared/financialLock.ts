/**
 * Trava compartilhada da conciliação financeira (migração 0022): uma conciliação por vez entre o
 * botão "Atualizar dados", a conciliação manual por período e a rotina de 30 min, mesmo em instâncias
 * diferentes das Edge Functions. Sem dependência de Deno (cliente Supabase injetado; testável).
 *
 * Falha ao consultar a trava (ex.: migração não aplicada) NÃO concilia: o erro sobe para quem chamou
 * registrar — conciliar sem trava poderia gravar as mesmas linhas em paralelo.
 */

/** Prazo da trava: cobre a execução mais longa (rotina ≈ 60 s de orçamento + consultas em andamento). */
export const FINANCIAL_LOCK_TTL_S = 180;

// deno-lint-ignore no-explicit-any
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { message: string } | null }> };

export async function tryFinancialLock(supabase: Rpc, holder: string, ttlSeconds = FINANCIAL_LOCK_TTL_S): Promise<boolean> {
  const { data, error } = await supabase.rpc('try_financial_sync_lock', { p_holder: holder, p_ttl_seconds: ttlSeconds });
  if (error) throw new Error(`trava da conciliação indisponível: ${error.message}`);
  return data === true;
}

export async function releaseFinancialLock(supabase: Rpc, holder: string): Promise<void> {
  const { error } = await supabase.rpc('release_financial_sync_lock', { p_holder: holder });
  // Não liberar só atrasa a próxima conciliação até o prazo da trava; não desfaz nada.
  if (error) console.error('liberar trava da conciliação', error.message);
}

/** Dono único por execução (função + gatilho + id aleatório). */
export function lockHolder(trigger: string): string {
  return `${trigger}#${crypto.randomUUID()}`;
}

export type LockedResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Roda `fn` com a trava. Ocupada: tenta de novo a cada `pollMs` até `waitMs` (0 = não espera) e
 * desiste com `{ acquired: false }`. A trava é liberada mesmo quando `fn` falha.
 */
export async function withFinancialLock<T>(
  supabase: Rpc,
  holder: string,
  fn: () => Promise<T>,
  { waitMs = 0, pollMs = 5_000, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now = Date.now }: { waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
): Promise<LockedResult<T>> {
  const deadline = now() + waitMs;
  while (!(await tryFinancialLock(supabase, holder))) {
    if (now() + pollMs > deadline) return { acquired: false };
    await sleep(pollMs);
  }
  try {
    return { acquired: true, value: await fn() };
  } finally {
    await releaseFinancialLock(supabase, holder);
  }
}
