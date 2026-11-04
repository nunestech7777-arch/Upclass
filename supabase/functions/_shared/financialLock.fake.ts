/** Trava falsa em memória para os testes: mesmo critério de try_financial_sync_lock/release_financial_sync_lock (0022), com relógio controlado. */
export function fakeLockDb(clock = { now: 0 }) {
  const row: { holder: string | null; expires: number | null } = { holder: null, expires: null };
  const calls: string[] = [];
  return {
    row,
    clock,
    calls,
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push(fn);
      if (fn === 'try_financial_sync_lock') {
        const holder = args.p_holder as string;
        const free = row.holder == null || row.expires == null || row.expires < clock.now || row.holder === holder;
        if (!free) return { data: false, error: null };
        row.holder = holder;
        row.expires = clock.now + (args.p_ttl_seconds as number) * 1000;
        return { data: true, error: null };
      }
      if (fn === 'release_financial_sync_lock') {
        if (row.holder === args.p_holder) Object.assign(row, { holder: null, expires: null });
        return { data: null, error: null };
      }
      return { data: null, error: { message: `função ${fn} não existe` } };
    },
  };
}
