import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchAllUsers } from '../_shared/kommo.ts';
import { getCaller, isActiveAdmin } from '../_shared/access.ts';
import { syncKommoUsers } from '../_shared/kommoUsers.ts';

/**
 * Sincroniza os usuários do Kommo em kommo_users (lista do vínculo vendedor ↔ usuário Kommo).
 * Chamado pelo botão em Meu Supervisor → Configurações (administrador) ou com a service role.
 * O kommo-sync-events também atualiza a lista sozinho quando ela fica velha (ver kommoUsers.ts).
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function jwtRole(req: Request): string | null {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // O gateway já validou a assinatura do JWT (verify_jwt padrão); aqui só entra service role ou
  // administrador ativo — antes qualquer token do projeto (até a chave anon) podia disparar.
  if (jwtRole(req) !== 'service_role') {
    try {
      const caller = await getCaller(supabase, req);
      if (!isActiveAdmin(caller)) return json({ ok: false, error: 'apenas administradores sincronizam usuários' }, 403);
    } catch (err) {
      console.error('kommo-sync: papel', err);
      return json({ ok: false, error: 'falha ao verificar o acesso' }, 500);
    }
  }

  try {
    const { users } = await syncKommoUsers(supabase, fetchAllUsers);
    return json({ ok: true, users });
  } catch (err) {
    console.error('kommo-sync', String(err).slice(0, 300));
    return json({ ok: false, error: String(err).slice(0, 300) }, 500);
  }
});
