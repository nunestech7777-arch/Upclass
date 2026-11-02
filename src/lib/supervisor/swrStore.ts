/**
 * Cache em memória no estilo stale-while-revalidate, sem dependência externa.
 *
 * - `peek` devolve o último valor guardado (mesmo vencido) para a tela aparecer na hora.
 * - `load` reaproveita a busca em andamento da mesma chave e só busca de novo quando o valor venceu
 *   (ou com `force`). Falha numa atualização mantém o valor anterior e guarda o erro à parte.
 * - `set` troca o valor sem nova busca (complementos que chegam depois, como os responsáveis do Kommo).
 * - Nada vai para localStorage/IndexedDB: some ao fechar a aba e em `clear` (logout/troca de conta).
 */
export interface SwrEntry<T> {
  data?: T;
  /** Quando `data` foi buscado (ms). */
  at?: number;
  /** Erro da última tentativa (a tela continua com `data`, se houver). */
  error?: string;
  inflight?: Promise<T>;
  /** Invalidado: continua exibível, mas a próxima visita busca de novo. */
  stale?: boolean;
}

export interface SwrStore<T> {
  peek(key: string): SwrEntry<T> | undefined;
  isFresh(key: string, ttlMs: number): boolean;
  load(key: string, loader: () => Promise<T>, opts: { ttlMs: number; force?: boolean }): Promise<T>;
  set(key: string, data: T, at?: number): void;
  subscribe(key: string, listener: () => void): () => void;
  invalidate(predicate?: (key: string) => boolean): void;
  clear(): void;
}

export function createSwrStore<T>(now: () => number = Date.now, maxEntries = 40): SwrStore<T> {
  const entries = new Map<string, SwrEntry<T>>();
  const listeners = new Map<string, Set<() => void>>();
  // Cada `clear` muda a geração: resposta de uma busca iniciada antes (outra conta) é descartada.
  let generation = 0;
  let invalidations = 0;

  const notify = (key: string) => listeners.get(key)?.forEach((fn) => fn());
  const update = (key: string, patch: Partial<SwrEntry<T>>) => {
    const next = { ...entries.get(key), ...patch };
    // Mais recente no fim; descarta as chaves mais antigas além do limite (períodos visitados há tempo).
    entries.delete(key);
    entries.set(key, next);
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value as string;
      if (oldest === key) break;
      entries.delete(oldest);
    }
    notify(key);
  };

  const isFresh = (key: string, ttlMs: number) => {
    const e = entries.get(key);
    return !!e && !e.stale && e.data !== undefined && e.at !== undefined && now() - e.at < ttlMs;
  };

  return {
    peek: (key) => entries.get(key),
    isFresh,
    load(key, loader, { ttlMs, force }) {
      const e = entries.get(key);
      if (e?.inflight) return e.inflight;
      if (!force && isFresh(key, ttlMs)) return Promise.resolve(e!.data as T);
      const gen = generation;
      const inv = invalidations;
      const startedAt = now();
      const inflight = loader().then(
        (data) => {
          // Invalidado durante a busca (ex.: vínculo mudou): guarda, mas a próxima visita busca de novo.
          if (gen === generation && entries.get(key)?.inflight === inflight)
            update(key, { data, at: startedAt, error: undefined, inflight: undefined, stale: inv !== invalidations ? true : undefined });
          return data;
        },
        (err: unknown) => {
          if (gen === generation && entries.get(key)?.inflight === inflight)
            update(key, { error: err instanceof Error ? err.message : String(err), inflight: undefined });
          throw err;
        }
      );
      update(key, { inflight });
      return inflight;
    },
    set(key, data, at) {
      update(key, { data, at: at ?? entries.get(key)?.at ?? now(), error: undefined });
    },
    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },
    invalidate(predicate) {
      invalidations += 1;
      for (const [key, e] of entries) if (!predicate || predicate(key)) entries.set(key, { ...e, stale: true });
    },
    clear() {
      generation += 1;
      const keys = [...entries.keys()];
      entries.clear();
      // Avisa depois: `clear` pode ser chamado durante a renderização (troca de conta).
      queueMicrotask(() => keys.forEach(notify));
    },
  };
}
