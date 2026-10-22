import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCaller, isActiveAdmin } from '../_shared/access.ts';
import { fetchHistoricoVendas } from '../_shared/mercadophone.ts';
import { toTurnoverLines, type HistoricoGiroRow } from '../_shared/turnoverLines.ts';

/**
 * Giro de estoque (aba Estoque): itens vendidos no período, ao vivo do histórico do MercadoPhone,
 * com a data de entrada do produto. Só administrador; somente leitura; sem cliente, custo ou lucro.
 * POST { from: 'AAAA-MM-DD', to: 'AAAA-MM-DD' } (até 400 dias).
 */
const MAX_DAYS = 400;
/** Páginas do histórico buscadas em paralelo (6 meses: ~50 s em sequência → ~11 s). */
const PAGE_CONCURRENCY = 6;
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
  let caller;
  try {
    caller = await getCaller(supabase, req);
  } catch (err) {
    console.error('giro: papel do usuário', err);
    return json({ ok: false, error: 'falha ao verificar o acesso' }, 500);
  }
  if (!caller) return json({ ok: false, error: 'não autenticado' }, 401);
  if (!isActiveAdmin(caller)) return json({ ok: false, error: 'acesso não autorizado' }, 403);

  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'corpo JSON inválido' }, 400);
  }
  const from = String(body.from ?? '');
  const to = String(body.to ?? '');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(days) || days < 1 || days > MAX_DAYS) {
    return json({ ok: false, error: `período inválido (1 a ${MAX_DAYS} dias, AAAA-MM-DD)` }, 400);
  }

  try {
    const rows = await fetchHistoricoVendas(`${from} 00:00:00`, `${to} 23:59:59`, PAGE_CONCURRENCY);
    return json({ ok: true, from, to, fetched_at: new Date().toISOString(), lines: toTurnoverLines(rows as unknown as HistoricoGiroRow[]) });
  } catch (err) {
    console.error('giro failed', err);
    return json({ ok: false, error: 'falha ao consultar o histórico de vendas no Mercado Phone' }, 502);
  }
});
