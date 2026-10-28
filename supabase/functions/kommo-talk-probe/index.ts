import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchTalkMessages, fetchWebhooks, KommoApiError } from '../_shared/kommo.ts';
import { summarizeTalkProbe } from '../_shared/kommoTalkMessages.ts';

/**
 * Diagnóstico do endpoint oficial GET /api/v4/talks/{talk_id}/messages contra um talk real.
 * Devolve só evidências sanitizadas: contagens, tipos, ids de usuário Kommo, tamanho do texto e
 * casamento de ids com o banco — nunca o texto, nomes ou telefones.
 *
 * verify_jwt = true no gateway + exige role service_role no token.
 * GET ?talk_id=123
 * GET ?token_info=1  → integração, escopos e validade do token (sem o token)
 * GET ?webhooks=1    → webhooks da conta e eventos assinados (destino sem a query string)
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

function jwtRole(req: Request): string | null {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch {
    return null;
  }
}

/**
 * Claims não secretos do KOMMO_API_TOKEN (JWT): de qual integração veio (aud), escopos e validade.
 * Só campos da lista saem — nunca o token ou a assinatura.
 */
function kommoTokenInfo() {
  const token = Deno.env.get('KOMMO_API_TOKEN') ?? '';
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const date = (s: unknown) => (typeof s === 'number' ? new Date(s * 1000).toISOString() : null);
    return {
      ok: true,
      integration_id: p.aud ?? null,
      scopes: p.scopes ?? null,
      user_id: p.sub ?? null,
      account_id: p.account_id ?? null,
      issued_at: date(p.iat),
      expires_at: date(p.exp),
      claim_keys: Object.keys(p).sort(),
    };
  } catch {
    return { ok: false, error: 'token não é um JWT legível' };
  }
}

Deno.serve(async (req) => {
  if (jwtRole(req) !== 'service_role') return new Response('Unauthorized', { status: 401 });
  if (new URL(req.url).searchParams.get('token_info') === '1') return json(kommoTokenInfo());
  if (new URL(req.url).searchParams.get('webhooks') === '1') {
    try {
      // Só host/caminho do destino: a query string carrega o secret do webhook.
      const hooks = (await fetchWebhooks()).map((h) => ({
        destination: String(h.destination ?? '').split('?')[0],
        settings: h.settings ?? [],
        disabled: h.disabled ?? null,
      }));
      return json({ ok: true, webhooks: hooks });
    } catch (err) {
      return json({ ok: false, http_status: err instanceof KommoApiError ? err.status : null, error: String(err).slice(0, 300) });
    }
  }
  const talkId = new URL(req.url).searchParams.get('talk_id');
  if (!talkId || !/^\d+$/.test(talkId)) return json({ ok: false, error: 'informe talk_id numérico' }, 400);

  let result;
  try {
    result = await fetchTalkMessages(talkId);
  } catch (err) {
    if (err instanceof KommoApiError) {
      return json({ ok: false, http_status: err.status, error: err.message.replace(/talks\/\d+/, 'talks/{id}') });
    }
    return json({ ok: false, error: String(err) }, 500);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: stored } = await supabase
    .from('conversation_messages')
    .select('external_id, direction, sender, sender_id, message_type')
    .eq('kommo_talk_id', talkId);

  return json({ ok: true, http_status: 200, pages: result.pages, truncated: result.truncated, ...summarizeTalkProbe(result.messages, stored ?? []) });
});
