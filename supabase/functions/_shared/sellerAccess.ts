/**
 * Regras do vínculo login ↔ vendedor (function seller-access). Módulo puro (sem Deno) — testado
 * em sellerAccess.test.ts. O vínculo usa ids estáveis: auth.users.id ↔ sellers.id (o id do
 * MercadoPhone fica em sellers.external_id). E-mail serve só para localizar a conta.
 */

export type AccessStatus = 'none' | 'invited' | 'active' | 'disabled';

export const STATUS_LABELS: Record<AccessStatus, string> = {
  none: 'Sem acesso',
  invited: 'Convite pendente',
  active: 'Ativo',
  disabled: 'Desativado',
};

export interface AccessRow {
  user_id: string;
  role: 'admin' | 'seller';
  seller_id: string | null;
  enabled: boolean;
}

export interface AuthUserLike {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  invited_at?: string | null;
}

/**
 * Desativado manda; depois, convite ainda não aceito (e-mail não confirmado) = pendente. Conta
 * criada pelo administrador com senha já nasce confirmada = ativa.
 */
export function accessStatus(row: AccessRow | null, user: AuthUserLike | null): AccessStatus {
  if (!row || !user) return 'none';
  if (!row.enabled) return 'disabled';
  if (!user.email_confirmed_at) return 'invited';
  return 'active';
}

export const MIN_PASSWORD_LENGTH = 8;

/** Senha definida pelo administrador: mínimo de caracteres, sem espaços nas pontas, até 72 (limite do Auth). */
export function passwordProblem(v: unknown): string | null {
  if (typeof v !== 'string') return 'Informe a senha.';
  if (v.length < MIN_PASSWORD_LENGTH) return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (v.length > 72) return 'A senha pode ter no máximo 72 caracteres.';
  if (v.trim() !== v) return 'A senha não pode começar nem terminar com espaço.';
  return null;
}

export type Conflict =
  | { code: 'admin_account'; message: string }
  | { code: 'account_linked_elsewhere'; message: string; sellerId: string }
  | { code: 'seller_has_login'; message: string; userId: string };

export type LinkPlan =
  | { ok: true; noop: boolean; replaceUserId: string | null }
  | { ok: false; conflict: Conflict };

/**
 * Pode vincular a conta `userId` ao vendedor `sellerId`?
 * - conta de administrador nunca vira vendedor (rebaixaria o gestor);
 * - conta já vinculada a OUTRO vendedor: bloqueia (sem vínculo duplicado/conflitante);
 * - vendedor que já tem OUTRA conta: só com `replace` (Alterar vínculo), que desvincula a anterior.
 */
export function planLink(
  sellerId: string,
  userId: string,
  accountAccess: AccessRow | null,
  sellerAccess: AccessRow | null,
  replace: boolean,
  sellerNameOf: (id: string) => string = (id) => id
): LinkPlan {
  if (accountAccess?.role === 'admin') {
    return { ok: false, conflict: { code: 'admin_account', message: 'Esta conta é de administrador e não pode ser vinculada a um vendedor.' } };
  }
  if (accountAccess?.seller_id && accountAccess.seller_id !== sellerId) {
    return {
      ok: false,
      conflict: {
        code: 'account_linked_elsewhere',
        message: `Esta conta já está vinculada ao vendedor ${sellerNameOf(accountAccess.seller_id)}. Desvincule-a lá antes.`,
        sellerId: accountAccess.seller_id,
      },
    };
  }
  if (sellerAccess && sellerAccess.user_id === userId) return { ok: true, noop: true, replaceUserId: null };
  if (sellerAccess) {
    if (!replace) {
      return {
        ok: false,
        conflict: { code: 'seller_has_login', message: 'Este vendedor já tem um login vinculado. Use "Alterar vínculo" para trocar a conta.', userId: sellerAccess.user_id },
      };
    }
    return { ok: true, noop: false, replaceUserId: sellerAccess.user_id };
  }
  return { ok: true, noop: false, replaceUserId: null };
}

export function normalizeEmail(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Só aceita redirecionar o convite para a própria origem do painel que fez o pedido. */
export function safeRedirect(requested: unknown, origin: string | null): string | undefined {
  if (!origin || typeof requested !== 'string') return undefined;
  try {
    const url = new URL(requested);
    return url.origin === new URL(origin).origin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
