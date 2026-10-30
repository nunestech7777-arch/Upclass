import type { KommoUser } from './kommo.ts';

/**
 * Sincronização de usuários do Kommo → kommo_users (lista do vínculo vendedor ↔ usuário Kommo).
 * Só insere/atualiza (upsert por id): usuário que sumiu do Kommo continua na tabela — o vínculo
 * existente de um vendedor nunca é desfeito pela sincronização. Funções puras ficam testáveis.
 */

export interface KommoUserRow {
  id: string;
  name: string;
  email: string | null;
  synced_at: string;
}

export function toKommoUserRows(users: KommoUser[], now: Date): KommoUserRow[] {
  const seen = new Set<string>();
  const rows: KommoUserRow[] = [];
  for (const u of users) {
    const id = String(u.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name: String(u.name ?? '').trim() || `Usuário ${id}`, email: u.email ?? null, synced_at: now.toISOString() });
  }
  return rows;
}

/** Usuários atualizados há mais que isso são buscados de novo pelo kommo-sync-events. */
export const USERS_MAX_AGE_MS = 6 * 3600_000;

export function usersAreStale(lastSyncedAt: string | null | undefined, now: Date, maxAgeMs = USERS_MAX_AGE_MS): boolean {
  if (!lastSyncedAt) return true;
  const t = Date.parse(lastSyncedAt);
  return !Number.isFinite(t) || now.getTime() - t > maxAgeMs;
}

interface UpsertClient {
  from(table: 'kommo_users'): {
    upsert(rows: KommoUserRow[], opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
}

export async function syncKommoUsers(
  supabase: UpsertClient,
  fetchUsers: () => Promise<KommoUser[]>,
  now = new Date()
): Promise<{ users: number }> {
  const rows = toKommoUserRows(await fetchUsers(), now);
  if (rows.length > 0) {
    const { error } = await supabase.from('kommo_users').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`upsert kommo_users: ${error.message}`);
  }
  return { users: rows.length };
}
