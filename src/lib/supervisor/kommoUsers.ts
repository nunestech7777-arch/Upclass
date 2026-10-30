/**
 * Opções do vínculo vendedor ↔ usuário Kommo. Vínculo é sempre por id do Kommo (nunca por nome);
 * um usuário Kommo só pode estar ligado a um vendedor (índice único idx_sellers_kommo_user_id).
 */

export interface KommoUserLike {
  id: string;
  name: string;
  synced_at: string;
}

export interface SellerLike {
  id: string;
  name: string;
  kommo_user_id: string | null;
}

export interface KommoUserOption {
  id: string;
  label: string;
  /** Já vinculado a outro vendedor — fica visível, mas não selecionável. */
  takenBy: string | null;
  /** Não veio na última sincronização: provavelmente removido ou desativado no Kommo. */
  missing: boolean;
}

/** Sem acento e em minúsculas, para a busca achar "Caroline" digitando "carolíne" ou "CAROL". */
export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function lastSyncOf(users: KommoUserLike[]): string | null {
  return users.reduce<string | null>((max, u) => (!max || u.synced_at > max ? u.synced_at : max), null);
}

/** Usuários que ficaram de fora da última sincronização (synced_at anterior ao da última rodada). */
export function missingUserIds(users: KommoUserLike[]): Set<string> {
  const last = lastSyncOf(users);
  if (!last) return new Set();
  const lastMs = Date.parse(last);
  // Mesma rodada grava o mesmo instante; folga de 1 min para não marcar ninguém à toa.
  return new Set(users.filter((u) => lastMs - Date.parse(u.synced_at) > 60_000).map((u) => u.id));
}

export function buildKommoUserOptions(users: KommoUserLike[], sellers: SellerLike[], forSellerId: string): KommoUserOption[] {
  const takenBy = new Map<string, string>();
  for (const s of sellers) if (s.kommo_user_id && s.id !== forSellerId) takenBy.set(s.kommo_user_id, s.name);
  const missing = missingUserIds(users);
  return [...users]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((u) => ({ id: u.id, label: u.name, takenBy: takenBy.get(u.id) ?? null, missing: missing.has(u.id) }));
}

/** Filtra vendedores pela busca: nome do vendedor ou nome do usuário Kommo vinculado. */
export function matchesSearch(seller: SellerLike, users: KommoUserLike[], term: string): boolean {
  const q = normalizeName(term);
  if (!q) return true;
  if (normalizeName(seller.name).includes(q)) return true;
  const linked = seller.kommo_user_id ? users.find((u) => u.id === seller.kommo_user_id) : undefined;
  return !!linked && normalizeName(linked.name).includes(q);
}
