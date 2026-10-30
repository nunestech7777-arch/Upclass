import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchChatEventsBetween, fetchTalkMessages, fetchWebhooks, KommoApiError } from '../_shared/kommo.ts';
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
 * GET ?chat_events_day=AAAA-MM-DD[&type=incoming|outgoing] → eventos de mensagem do dia (fuso da loja,
 *     UTC−3) no Kommo × conversation_messages: contagens e só os ids/horários das que faltam no banco.
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
  const day = new URL(req.url).searchParams.get('chat_events_day');
  if (day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ ok: false, error: 'chat_events_day = AAAA-MM-DD' }, 400);
    const type = new URL(req.url).searchParams.get('type') === 'outgoing' ? 'outgoing_chat_message' : 'incoming_chat_message';
    const fromUnix = Date.parse(`${day}T00:00:00-03:00`) / 1000;
    try {
      const { events, truncated } = await fetchChatEventsBetween(fromUnix, fromUnix + 86400 - 1, [type]);
      const found: Array<{ message_id: string; talk_id: string | null; created_at: number; entity_type: string | null; entity_id: string | null; event_id: string }> = [];
      for (const ev of events) {
        for (const v of Array.isArray(ev?.value_after) ? ev.value_after : []) {
          const id = v?.message?.id ? String(v.message.id) : null;
          if (!id) continue;
          found.push({
            message_id: id,
            talk_id: v?.message?.talk_id ? String(v.message.talk_id) : null,
            created_at: Number(ev?.created_at ?? 0),
            entity_type: ev?.entity_type ?? null,
            entity_id: ev?.entity_id != null ? String(ev.entity_id) : null,
            event_id: String(ev?.id ?? ''),
          });
        }
      }
      const ids = [...new Set(found.map((f) => f.message_id))];
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const stored = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('conversation_messages').select('external_id').in('external_id', ids.slice(i, i + 200));
        for (const r of data ?? []) stored.add(String(r.external_id));
      }
      const missing = found.filter((f) => !stored.has(f.message_id));
      // Mesma mensagem em mais de um evento: o painel do Kommo conta eventos, o banco conta mensagens.
      const byId = new Map<string, typeof found>();
      for (const f of found) byId.set(f.message_id, [...(byId.get(f.message_id) ?? []), f]);
      const repeated = [...byId.values()].filter((list) => list.length > 1);
      const repeatedIds = repeated.map((list) => list[0].message_id);
      const repeatedOrigin = new Map<string, { origin: string | null; sent_at: string | null; conversation_id: string | null }>();
      if (repeatedIds.length) {
        const { data } = await supabase.from('conversation_messages').select('external_id, sent_at, conversation_id, origin:raw_payload->>origin').in('external_id', repeatedIds);
        for (const r of data ?? []) repeatedOrigin.set(String(r.external_id), { origin: r.origin ?? null, sent_at: r.sent_at ?? null, conversation_id: r.conversation_id ?? null });
      }
      // Para cada ausente: o talk existe no banco? Em qual canal (origin da conversa)?
      const talks = [...new Set(missing.map((f) => f.talk_id).filter((t): t is string => !!t))];
      const talkInfo = new Map<string, { conversation_id: string; origin: string | null }>();
      if (talks.length) {
        const { data } = await supabase.from('conversation_messages').select('kommo_talk_id, conversation_id').in('kommo_talk_id', talks).limit(1000);
        const convIds = [...new Set((data ?? []).map((r) => String(r.conversation_id)))];
        const { data: convs } = convIds.length
          ? await supabase.from('conversations').select('id, origin:raw_payload->>origin').in('id', convIds)
          : { data: [] };
        const originOf = new Map((convs ?? []).map((c: { id: string; origin: string | null }) => [c.id, c.origin]));
        for (const r of data ?? []) talkInfo.set(String(r.kommo_talk_id), { conversation_id: String(r.conversation_id), origin: originOf.get(String(r.conversation_id)) ?? null });
      }
      return json({
        ok: true,
        type,
        truncated,
        events: events.length,
        message_ids: ids.length,
        stored: ids.length - new Set(missing.map((f) => f.message_id)).size,
        repeated_in_events: repeated.map((list) => ({
          message_id: list[0].message_id,
          events: list.map((f) => ({ event_id: f.event_id, created_at_iso: new Date(f.created_at * 1000).toISOString(), entity_type: f.entity_type, entity_id: f.entity_id, talk_id: f.talk_id })),
          in_db: repeatedOrigin.get(list[0].message_id) ?? null,
        })),
        missing: missing.map((f) => ({ ...f, created_at_iso: new Date(f.created_at * 1000).toISOString(), talk_in_db: f.talk_id ? talkInfo.get(f.talk_id) ?? null : null })),
      });
    } catch (err) {
      return json({ ok: false, http_status: err instanceof KommoApiError ? err.status : null, error: String(err).replace(/events\?[^:]*/g, 'events?…').slice(0, 300) });
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
