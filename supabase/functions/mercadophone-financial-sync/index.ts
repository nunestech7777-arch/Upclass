import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCaller, isActiveAdmin } from '../_shared/access.ts';
import { fetchHistoricoVendas } from '../_shared/mercadophone.ts';
import { runFinancialSync } from '../_shared/financialSync.ts';

/**
 * Recupera custo e lucro por item do histórico do MercadoPhone para um período e concilia com
 * `sales`. Chamada pelo painel (usuário autenticado) — corpo JSON:
 *   { "start": "2026-10-01", "end": "2026-10-17", "mode": "preview" | "apply" }
 * `preview` só conta correspondências, pendências, ambiguidades e linhas obsoletas; `apply` grava.
 * Se o tempo acabar, a resposta traz `next_start` para continuar.
 */
const MAX_DAYS = 120;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'use POST' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Só administradores (custos e lucro; conta de vendedor não concilia nada).
  let caller;
  try {
    caller = await getCaller(supabase, req);
  } catch (err) {
    console.error('financial sync: papel do usuário', err);
    return json({ ok: false, error: 'falha ao verificar o acesso' }, 500);
  }
  if (!caller) return json({ ok: false, error: 'não autenticado' }, 401);
  if (!isActiveAdmin(caller)) return json({ ok: false, error: 'acesso não autorizado' }, 403);
  const auth = { user: caller.user };

  let body: { start?: string; end?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'corpo JSON inválido' }, 400);
  }
  const mode = body.mode === 'apply' ? 'apply' : 'preview';
  const start = String(body.start ?? '');
  const end = String(body.end ?? '');
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) {
    return json({ ok: false, error: `período inválido (1 a ${MAX_DAYS} dias, AAAA-MM-DD)` }, 400);
  }

  try {
    const result = await runFinancialSync(supabase, fetchHistoricoVendas, {
      start,
      end,
      mode,
      trigger: `manual:${auth.user.email ?? auth.user.id}`,
    });
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('financial sync failed', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
