import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchLeadResponsibles } from '../_shared/kommo.ts';
import { getCaller, isActiveAdmin } from '../_shared/access.ts';

/**
 * Responsável ATUAL de cada lead no Kommo — usado pelo Meu Supervisor para mostrar com quem o lead
 * está e para marcar conversas "aguardando distribuição". Só leitura no Kommo; não grava nada.
 * Só administrador ativo (ou service role). Chamado sob demanda pela tela, sem agendamento.
 *
 *   POST { "lead_ids": ["123", ...] } → { ok, responsibles: { "123": "<id do usuário Kommo>" }, not_found: [...] }
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_LEADS = 3000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * Papel escrito no token. Só é confiável porque o gateway valida a assinatura antes
 * (verify_jwt = true em supabase/config.toml) — não publique esta função com --no-verify-jwt.
 */
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
  if (req.method !== 'POST') return json({ ok: false, error: 'use POST' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (jwtRole(req) !== 'service_role') {
    try {
      const caller = await getCaller(supabase, req);
      if (!isActiveAdmin(caller)) return json({ ok: false, error: 'apenas administradores' }, 403);
    } catch (err) {
      console.error('kommo-lead-responsibles: papel', String(err).slice(0, 200));
      return json({ ok: false, error: 'falha ao verificar o acesso' }, 500);
    }
  }

  const body = await req.json().catch(() => ({}));
  const ids = [...new Set((Array.isArray(body?.lead_ids) ? body.lead_ids : []).map((x: unknown) => String(x ?? '').trim()))].filter(
    (x): x is string => /^\d{1,15}$/.test(x as string)
  );
  if (ids.length > MAX_LEADS) return json({ ok: false, error: `no máximo ${MAX_LEADS} leads por chamada` }, 400);

  try {
    const found = await fetchLeadResponsibles(ids);
    return json({ ok: true, responsibles: Object.fromEntries(found), not_found: ids.filter((id) => !found.has(id)) });
  } catch (err) {
    // Sem os ids dos leads (vêm na URL da mensagem de erro); fica o código HTTP do Kommo.
    console.error('kommo-lead-responsibles', String(err).replace(/leads\?[^:]*/g, 'leads?…').slice(0, 300));
    return json({ ok: false, error: 'falha ao consultar o Kommo' }, 502);
  }
});
