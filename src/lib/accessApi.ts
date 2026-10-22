import { supabase } from './supabaseClient';
import type { PortalGoal, PortalSale } from './sellerPortal';
import type { DateRange } from './finance/dashboard';

/**
 * Papel da conta logada e chamadas do Painel do Vendedor. O vendedor é sempre resolvido NO BANCO
 * pelo token (funções seller_portal_*): nenhuma chamada daqui envia id de vendedor.
 */
export interface MyAccess {
  role: 'admin' | 'seller' | null;
  enabled: boolean;
  sellerId: string | null;
  sellerName: string | null;
  photoUrl: string | null;
  mpSellerId: string | null;
  /** Banco sem a migração 0017: comportamento anterior (todo logado é gestor). */
  legacy?: boolean;
}

const NO_ACCESS: MyAccess = { role: null, enabled: false, sellerId: null, sellerName: null, photoUrl: null, mpSellerId: null };

/** Função inexistente no banco (migração 0017 pendente). */
const isMissingFunction = (code: string | undefined) => code === 'PGRST202' || code === '42883';

export async function fetchMyAccess(): Promise<MyAccess> {
  const { data, error } = await supabase.rpc('my_access');
  if (error) {
    if (isMissingFunction(error.code)) return { ...NO_ACCESS, role: 'admin', enabled: true, legacy: true };
    throw new Error(`Não foi possível verificar seu acesso: ${error.message}`);
  }
  const row = (data ?? [])[0];
  if (!row) return NO_ACCESS;
  return {
    role: row.role,
    enabled: row.enabled,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    photoUrl: row.seller_photo_url,
    mpSellerId: row.mp_seller_id,
  };
}

export async function fetchMySales(range: DateRange): Promise<PortalSale[]> {
  const { data, error } = await supabase.rpc('seller_portal_sales', { p_from: range.from, p_to: range.to });
  if (error) throw new Error(error.code === '42501' ? 'Seu acesso de vendedor não está ativo.' : `Não foi possível carregar suas vendas: ${error.message}`);
  return (data ?? []) as PortalSale[];
}

export async function fetchMyWeeklyGoals(range: DateRange): Promise<PortalGoal[]> {
  const { data, error } = await supabase.rpc('seller_portal_weekly_goals', { p_from: range.from, p_to: range.to });
  if (error) throw new Error(error.code === '42501' ? 'Seu acesso de vendedor não está ativo.' : `Não foi possível carregar sua meta: ${error.message}`);
  return (data ?? []) as PortalGoal[];
}

// ---------------------------------------------------------------------------
// Administração de acessos (function seller-access; só administrador)
// ---------------------------------------------------------------------------

export type AccessStatus = 'none' | 'invited' | 'active' | 'disabled';

export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  none: 'Sem acesso',
  invited: 'Convite pendente',
  active: 'Ativo',
  disabled: 'Desativado',
};

export interface SellerLogin {
  seller_id: string;
  user_id: string;
  email: string | null;
  enabled: boolean;
  status: AccessStatus;
  invited_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  created_by_email: string | null;
  updated_at: string;
  updated_by_email: string | null;
  disabled_at: string | null;
}

export function accessStatusOf(login: SellerLogin | undefined): AccessStatus {
  return login?.status ?? 'none';
}

export class AccessApiError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function callSellerAccess<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('seller-access', { body });
  if (error) {
    let detail = error.message;
    let code = 'error';
    try {
      const payload = await (error as { context?: Response }).context?.json();
      if (payload?.error) detail = payload.error;
      if (payload?.code) code = payload.code;
    } catch {
      // resposta sem corpo JSON (ex.: function não publicada)
      if (/not found|404/i.test(detail)) code = 'not_deployed';
    }
    throw new AccessApiError(detail, code);
  }
  if (!data?.ok) throw new AccessApiError(data?.error ?? 'resposta inválida', data?.code ?? 'error');
  return data as T;
}

const redirectTo = () => `${window.location.origin}/definir-senha`;

export const sellerAccessApi = {
  list: () => callSellerAccess<{ links: SellerLogin[] }>({ action: 'list' }).then((r) => r.links),
  create: (sellerId: string, email: string, password: string) => callSellerAccess({ action: 'create', seller_id: sellerId, email, password }),
  setPassword: (sellerId: string, password: string) => callSellerAccess({ action: 'set_password', seller_id: sellerId, password }),
  invite: (sellerId: string, email: string) => callSellerAccess({ action: 'invite', seller_id: sellerId, email, redirect_to: redirectTo() }),
  link: (sellerId: string, email: string, replace = false) => callSellerAccess({ action: 'link', seller_id: sellerId, email, replace }),
  unlink: (sellerId: string) => callSellerAccess({ action: 'unlink', seller_id: sellerId }),
  setEnabled: (sellerId: string, enabled: boolean) => callSellerAccess({ action: 'set_enabled', seller_id: sellerId, enabled }),
  resend: (sellerId: string) => callSellerAccess<{ kind: 'invite' | 'recovery' }>({ action: 'resend', seller_id: sellerId, redirect_to: redirectTo() }),
};
