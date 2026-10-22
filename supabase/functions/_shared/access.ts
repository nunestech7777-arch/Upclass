import type { SupabaseClient, User } from 'jsr:@supabase/supabase-js@2';

/**
 * Quem está chamando a function: conta do Supabase Auth validada pelo token + papel em
 * `user_access` (migração 0017). Nunca confia em papel ou vendedor enviados no corpo da requisição.
 */
export interface Caller {
  user: User;
  role: 'admin' | 'seller' | null;
  enabled: boolean;
  sellerId: string | null;
}

export async function getCaller(supabase: SupabaseClient, req: Request): Promise<Caller | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return null;
  const { data: auth } = await supabase.auth.getUser(token);
  if (!auth?.user) return null;
  const { data, error } = await supabase
    .from('user_access')
    .select('role, enabled, seller_id')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  // Falha fechada: sem conseguir ler o papel, ninguém recebe acesso (exige a migração 0017).
  if (error) throw new Error(`ler papel do usuário: ${error.message}`);
  return {
    user: auth.user,
    role: (data?.role as Caller['role']) ?? null,
    enabled: data?.enabled === true,
    sellerId: (data?.seller_id as string | null) ?? null,
  };
}

export const isActiveAdmin = (c: Caller | null): c is Caller => !!c && c.role === 'admin' && c.enabled;
export const isActiveSeller = (c: Caller | null): c is Caller => !!c && c.role === 'seller' && c.enabled && !!c.sellerId;
