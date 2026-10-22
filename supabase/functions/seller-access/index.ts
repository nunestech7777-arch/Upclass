import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import { getCaller, isActiveAdmin, type Caller } from '../_shared/access.ts';
import { accessStatus, normalizeEmail, passwordProblem, planLink, safeRedirect, type AccessRow } from '../_shared/sellerAccess.ts';

/**
 * Gerenciamento de login dos vendedores (Configurações → Vendedores e Fotos de Perfil).
 * Só administrador ativo. Senhas vão direto ao Supabase Auth (com hash); nunca são gravadas em
 * tabela, auditoria ou log. Toda gravação em user_access passa por aqui (service_role, no servidor):
 * o navegador nunca recebe a chave de serviço nem escolhe papel.
 *
 * Ações (POST { action, ... }):
 *   list                                   → vínculos dos vendedores + status do login
 *   create   { seller_id, email, password }    → cria a conta com a senha definida pelo administrador
 *   invite   { seller_id, email, redirect_to } → convite do Supabase Auth (o vendedor define a senha)
 *   set_password { seller_id, password }       → administrador define uma nova senha
 *   link     { seller_id, email, replace? }    → vincula conta existente (replace = Alterar vínculo)
 *   unlink   { seller_id }                     → remove o vínculo (vendas/metas ficam intactas)
 *   set_enabled { seller_id, enabled }         → ativa/desativa o acesso (não mexe no ranking)
 *   resend   { seller_id, redirect_to }        → reenvia convite (ou link de nova senha se já entrou)
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, error: string) => json({ ok: false, code, error }, status);

/** Bloqueio do Auth: impede novo login e renovação de sessão (a RLS já corta os dados na hora). */
const BAN_FOREVER = '876000h';

async function findUserByEmail(sb: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listar contas: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function accessOfUser(sb: SupabaseClient, userId: string): Promise<AccessRow | null> {
  const { data, error } = await sb.from('user_access').select('user_id, role, seller_id, enabled').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`ler vínculo da conta: ${error.message}`);
  return data as AccessRow | null;
}

async function accessOfSeller(sb: SupabaseClient, sellerId: string): Promise<(AccessRow & { email: string | null }) | null> {
  const { data, error } = await sb.from('user_access').select('user_id, role, seller_id, enabled, email').eq('seller_id', sellerId).maybeSingle();
  if (error) throw new Error(`ler vínculo do vendedor: ${error.message}`);
  return data as (AccessRow & { email: string | null }) | null;
}

async function setBan(sb: SupabaseClient, userId: string, banned: boolean) {
  const { error } = await sb.auth.admin.updateUserById(userId, { ban_duration: banned ? BAN_FOREVER : 'none' });
  if (error) throw new Error(`${banned ? 'bloquear' : 'desbloquear'} conta: ${error.message}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method', 'use POST');

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let caller: Caller | null;
  try {
    caller = await getCaller(sb, req);
  } catch (err) {
    console.error('seller-access: papel', err);
    return fail(500, 'internal', 'falha ao verificar o acesso');
  }
  if (!caller) return fail(401, 'unauthenticated', 'não autenticado');
  if (!isActiveAdmin(caller)) return fail(403, 'forbidden', 'apenas administradores gerenciam acessos');
  const actor = caller.user;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'bad_request', 'corpo JSON inválido');
  }
  const action = String(body.action ?? '');

  const audit = async (act: string, sellerId: string | null, targetUserId: string | null, details: Record<string, unknown> = {}) => {
    const { error } = await sb.from('admin_audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email ?? null,
      action: act,
      seller_id: sellerId,
      target_user_id: targetUserId,
      details,
    });
    if (error) console.error('auditoria', act, error.message);
  };

  try {
    if (action === 'list') {
      const { data: rows, error } = await sb
        .from('user_access')
        .select('user_id, role, seller_id, enabled, email, created_at, created_by_email, updated_at, updated_by_email, disabled_at')
        .eq('role', 'seller');
      if (error) throw new Error(`listar vínculos: ${error.message}`);
      const links = await Promise.all(
        (rows ?? []).map(async (r) => {
          const { data } = await sb.auth.admin.getUserById(r.user_id as string);
          const u = data?.user ?? null;
          return {
            seller_id: r.seller_id,
            user_id: r.user_id,
            email: u?.email ?? r.email ?? null,
            enabled: r.enabled,
            status: accessStatus(r as AccessRow, u),
            invited_at: u?.invited_at ?? null,
            last_sign_in_at: u?.last_sign_in_at ?? null,
            created_at: r.created_at,
            created_by_email: r.created_by_email,
            updated_at: r.updated_at,
            updated_by_email: r.updated_by_email,
            disabled_at: r.disabled_at,
          };
        })
      );
      return json({ ok: true, links });
    }

    const sellerId = String(body.seller_id ?? '');
    const { data: seller, error: sellerError } = await sb.from('sellers').select('id, name, external_id').eq('id', sellerId).maybeSingle();
    if (sellerError) throw new Error(`ler vendedor: ${sellerError.message}`);
    if (!seller) return fail(404, 'seller_not_found', 'vendedor não encontrado');
    const sellerName = async (id: string) => {
      const { data } = await sb.from('sellers').select('name').eq('id', id).maybeSingle();
      return (data?.name as string) ?? 'outro vendedor';
    };
    const redirectTo = safeRedirect(body.redirect_to, req.headers.get('origin'));
    const stamp = { updated_by: actor.id, updated_by_email: actor.email ?? null, updated_at: new Date().toISOString() };

    if (action === 'create') {
      const email = normalizeEmail(body.email);
      if (!email) return fail(400, 'invalid_email', 'e-mail inválido');
      const problem = passwordProblem(body.password);
      if (problem) return fail(400, 'invalid_password', problem);
      const current = await accessOfSeller(sb, sellerId);
      if (current) return fail(409, 'seller_has_login', 'Este vendedor já tem um login vinculado. Use "Alterar vínculo".');
      if (await findUserByEmail(sb, email)) {
        return fail(409, 'account_exists', 'Já existe uma conta com este e-mail. Use "Vincular conta existente".');
      }
      const { data: created, error } = await sb.auth.admin.createUser({ email, password: body.password as string, email_confirm: true });
      if (error || !created?.user) return fail(400, 'create_failed', `Não foi possível criar a conta: ${error?.message ?? 'sem resposta'}`);
      const { error: insertError } = await sb.from('user_access').insert({
        user_id: created.user.id,
        role: 'seller',
        seller_id: sellerId,
        enabled: true,
        email,
        created_by: actor.id,
        created_by_email: actor.email ?? null,
        ...stamp,
      });
      if (insertError) {
        // Conta criada agora por esta requisição e sem outro uso — desfaz.
        await sb.auth.admin.deleteUser(created.user.id);
        return fail(409, 'conflict', `Não foi possível vincular: ${insertError.message}`);
      }
      await audit('access_create', sellerId, created.user.id, { email, mp_seller_id: seller.external_id, password_set_by_admin: true });
      return json({ ok: true });
    }

    if (action === 'invite') {
      const email = normalizeEmail(body.email);
      if (!email) return fail(400, 'invalid_email', 'e-mail inválido');
      const current = await accessOfSeller(sb, sellerId);
      if (current) return fail(409, 'seller_has_login', 'Este vendedor já tem um login vinculado. Use "Alterar vínculo".');
      const existing = await findUserByEmail(sb, email);
      if (existing) {
        return fail(409, 'account_exists', 'Já existe uma conta com este e-mail. Use "Vincular conta existente".');
      }
      const { data: invited, error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error || !invited?.user) return fail(502, 'invite_failed', `Não foi possível enviar o convite: ${error?.message ?? 'sem resposta'}`);
      const { error: insertError } = await sb.from('user_access').insert({
        user_id: invited.user.id,
        role: 'seller',
        seller_id: sellerId,
        enabled: true,
        email,
        created_by: actor.id,
        created_by_email: actor.email ?? null,
        ...stamp,
      });
      if (insertError) {
        // Vínculo concorrente: a conta recém-convidada não tem outro uso — desfaz.
        await sb.auth.admin.deleteUser(invited.user.id);
        return fail(409, 'conflict', `Não foi possível vincular: ${insertError.message}`);
      }
      await audit('access_invite', sellerId, invited.user.id, { email, mp_seller_id: seller.external_id });
      return json({ ok: true });
    }

    if (action === 'link') {
      const email = normalizeEmail(body.email);
      if (!email) return fail(400, 'invalid_email', 'e-mail inválido');
      const user = await findUserByEmail(sb, email);
      if (!user) return fail(404, 'account_not_found', 'Nenhuma conta com este e-mail. Use "Criar acesso" para convidar.');
      const accountAccess = await accessOfUser(sb, user.id);
      const sellerAccess = await accessOfSeller(sb, sellerId);
      const names = new Map<string, string>();
      if (accountAccess?.seller_id) names.set(accountAccess.seller_id, await sellerName(accountAccess.seller_id));
      const plan = planLink(sellerId, user.id, accountAccess, sellerAccess, body.replace === true, (id) => names.get(id) ?? id);
      if (!plan.ok) return fail(409, plan.conflict.code, plan.conflict.message);
      if (plan.noop) return json({ ok: true });
      if (plan.replaceUserId) {
        const { error } = await sb.from('user_access').delete().eq('user_id', plan.replaceUserId).eq('seller_id', sellerId);
        if (error) throw new Error(`desvincular conta anterior: ${error.message}`);
        await setBan(sb, plan.replaceUserId, true);
      }
      // Conta sem papel (criada fora do painel) recebe o papel de vendedor; nunca uma de admin (planLink).
      const { error } = await sb.from('user_access').upsert(
        { user_id: user.id, role: 'seller', seller_id: sellerId, enabled: true, email, disabled_at: null, created_by: actor.id, created_by_email: actor.email ?? null, ...stamp },
        { onConflict: 'user_id' }
      );
      if (error) return fail(409, 'conflict', `Não foi possível vincular: ${error.message}`);
      await setBan(sb, user.id, false);
      await audit(plan.replaceUserId ? 'access_relink' : 'access_link', sellerId, user.id, {
        email,
        previous_user_id: plan.replaceUserId,
        mp_seller_id: seller.external_id,
      });
      return json({ ok: true });
    }

    const current = await accessOfSeller(sb, sellerId);
    if (!current) return fail(404, 'no_login', 'Nenhum login vinculado a este vendedor.');

    if (action === 'unlink') {
      const { error } = await sb.from('user_access').delete().eq('user_id', current.user_id).eq('seller_id', sellerId);
      if (error) throw new Error(`desvincular: ${error.message}`);
      // A conta continua existindo (sem acesso a nada); bloqueada para não manter sessão.
      await setBan(sb, current.user_id, true);
      await audit('access_unlink', sellerId, current.user_id, { email: current.email });
      return json({ ok: true });
    }

    if (action === 'set_enabled') {
      const enabled = body.enabled === true;
      const { error } = await sb
        .from('user_access')
        .update({ enabled, disabled_at: enabled ? null : new Date().toISOString(), ...stamp })
        .eq('user_id', current.user_id);
      if (error) throw new Error(`alterar acesso: ${error.message}`);
      await setBan(sb, current.user_id, !enabled);
      await audit(enabled ? 'access_enable' : 'access_disable', sellerId, current.user_id, { email: current.email });
      return json({ ok: true });
    }

    if (action === 'set_password') {
      const problem = passwordProblem(body.password);
      if (problem) return fail(400, 'invalid_password', problem);
      const { error } = await sb.auth.admin.updateUserById(current.user_id, { password: body.password as string });
      if (error) return fail(400, 'password_failed', `Não foi possível alterar a senha: ${error.message}`);
      await audit('access_set_password', sellerId, current.user_id, { email: current.email });
      return json({ ok: true });
    }

    if (action === 'resend') {
      if (!current.enabled) return fail(409, 'disabled', 'Ative o acesso antes de reenviar o convite.');
      const { data } = await sb.auth.admin.getUserById(current.user_id);
      const user = data?.user;
      if (!user?.email) return fail(404, 'account_not_found', 'Conta do vendedor não encontrada no Auth.');
      let kind: 'invite' | 'recovery' = 'invite';
      if (!user.email_confirmed_at) {
        const { error } = await sb.auth.admin.inviteUserByEmail(user.email, { redirectTo });
        if (error) return fail(502, 'invite_failed', `Não foi possível reenviar o convite: ${error.message}`);
      } else {
        // Conta já confirmada: o "convite" é um link para definir uma nova senha.
        kind = 'recovery';
        const { error } = await sb.auth.resetPasswordForEmail(user.email, { redirectTo });
        if (error) return fail(502, 'invite_failed', `Não foi possível enviar o link: ${error.message}`);
      }
      await audit('access_resend', sellerId, current.user_id, { email: user.email, kind });
      return json({ ok: true, kind });
    }

    return fail(400, 'bad_action', 'ação desconhecida');
  } catch (err) {
    console.error('seller-access', action, err);
    return fail(500, 'internal', 'Falha ao processar a operação. Tente novamente.');
  }
});
