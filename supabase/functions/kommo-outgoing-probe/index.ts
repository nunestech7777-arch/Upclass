import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchWebhooks, KommoApiError, setWebhook } from '../_shared/kommo.ts';
import { parseBracketForm } from '../_shared/kommoMessage.ts';
import { createIngestContext, ingestWebhookPayload, summarizeOutcomes } from '../_shared/kommoIngest.ts';

/**
 * TESTE do webhook oficial add_outgoing_message (mensagens enviadas pelo Kommo), numa assinatura
 * separada da do kommo-webhook. Ao receber, nada é ingerido em conversas: o payload bruto fica em
 * kommo_webhook_events (processed = true, result.probe = 'outgoing') e o resumo devolvido é
 * sanitizado — tamanho do texto, nunca o texto, nomes ou telefones.
 *
 * Kommo → POST ?secret=KOMMO_OUTGOING_PROBE_SECRET   (verify_jwt = false)
 * Admin (JWT service_role):
 *   GET ?action=subscribe        assina add_outgoing_message para esta função
 *   GET ?action=unsubscribe      remove a assinatura de teste
 *   GET ?action=summary          resumo sanitizado dos eventos recebidos
 *   GET ?action=add_to_main      acrescenta add_outgoing_message à assinatura do kommo-webhook
 *   GET ?action=inspect          como o Kommo lista a assinatura de teste
 *   GET ?action=ingest_captured  grava nas conversas o que só esta assinatura recebeu (idempotente)
 */

const EVENT = 'add_outgoing_message';

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

// deno-lint-ignore no-explicit-any
type Any = any;

/** Itens de mensagem em qualquer "<grupo>.add" do payload (a documentação mostra outgoing_message.add). */
function messageItems(payload: Any): Array<{ group: string; item: Any }> {
  const out: Array<{ group: string; item: Any }> = [];
  for (const [group, value] of Object.entries(payload ?? {})) {
    const add = (value as Any)?.add;
    if (!add || typeof add !== 'object') continue;
    for (const item of Array.isArray(add) ? add : Object.values(add)) out.push({ group, item });
  }
  return out;
}

function sanitize(item: Any) {
  const author = item?.author ?? {};
  return {
    keys: Object.keys(item ?? {}).sort(),
    author_keys: Object.keys(author).sort(),
    type: item?.type ?? null,
    author_type: author.type ?? null,
    user_id: author.user_id ?? null,
    has_author_name: !!author.name,
    message_type: item?.message_type ?? null,
    text_len: String(item?.text ?? '').length,
    origin: item?.origin ?? null,
    has_id: !!item?.id,
    has_talk_id: !!item?.talk_id,
    has_chat_id: !!item?.chat_id,
    has_contact_id: !!item?.contact_id,
    created_at: item?.created_at ?? null,
    attachment_type: item?.attachment?.type ?? null,
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const action = url.searchParams.get('action');

  if (action) {
    if (jwtRole(req) !== 'service_role') return new Response('Unauthorized', { status: 401 });
    const destination = `${Deno.env.get('SUPABASE_URL')}/functions/v1/kommo-outgoing-probe?secret=${Deno.env.get('KOMMO_OUTGOING_PROBE_SECRET')}`;

    if (action === 'subscribe' || action === 'unsubscribe') {
      try {
        const res = await setWebhook(action === 'subscribe' ? 'POST' : 'DELETE', destination, [EVENT]);
        // Resposta do Kommo sem o secret do destino.
        const kommo = JSON.parse(JSON.stringify(res).replaceAll(Deno.env.get('KOMMO_OUTGOING_PROBE_SECRET') ?? '\u0000', '***'));
        return json({ ok: true, action, kommo });
      } catch (err) {
        const msg = String(err).replaceAll(Deno.env.get('KOMMO_OUTGOING_PROBE_SECRET') ?? '\u0000', '***');
        return json({ ok: false, http_status: err instanceof KommoApiError ? err.status : null, error: msg.slice(0, 400) });
      }
    }

    // Acrescenta o evento à assinatura do kommo-webhook reenviando o destino exato já cadastrado
    // (com o mesmo secret) — reconstruir a URL poderia criar uma segunda assinatura e duplicar entregas.
    if (action === 'add_to_main') {
      try {
        const main = (await fetchWebhooks()).filter((h) => String(h.destination ?? '').split('?')[0].endsWith('/functions/v1/kommo-webhook'));
        if (main.length !== 1) return json({ ok: false, error: `esperava 1 assinatura do kommo-webhook, achei ${main.length}` });
        const settings = [...new Set([...(main[0].settings ?? []), EVENT])];
        const res = (await setWebhook('POST', String(main[0].destination), settings)) as Any;
        return json({ ok: true, destination: String(res?.destination ?? '').split('?')[0], settings: res?.settings ?? null });
      } catch (err) {
        return json({ ok: false, http_status: err instanceof KommoApiError ? err.status : null, error: String(err).split('?')[0].slice(0, 300) });
      }
    }

    // Diagnóstico: como o Kommo enxerga a assinatura de teste (filtro por destino) — sem o secret.
    if (action === 'inspect') {
      const secret = Deno.env.get('KOMMO_OUTGOING_PROBE_SECRET') ?? '\u0000';
      try {
        const hooks = await fetchWebhooks(destination);
        return json({ ok: true, found: JSON.parse(JSON.stringify(hooks).replaceAll(secret, '***')) });
      } catch (err) {
        return json({ ok: false, http_status: err instanceof KommoApiError ? err.status : null, error: String(err).replaceAll(secret, '***').slice(0, 300) });
      }
    }

    // Grava nas conversas as mensagens capturadas por esta assinatura, com o mesmo código do kommo-webhook
    // (idempotente: mensagem real já gravada não é reescrita). Marca result.ingested para não repetir.
    if (action === 'ingest_captured') {
      const { data: rows, error } = await supabase
        .from('kommo_webhook_events')
        .select('id, payload, received_at, result')
        .gte('received_at', new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString())
        .eq('result->>probe', 'outgoing')
        .is('result->>ingested', null)
        .order('received_at', { ascending: true })
        .limit(200);
      if (error) return json({ ok: false, error: error.message }, 500);
      const counts: Record<string, number> = {};
      const ctx = createIngestContext(supabase);
      for (const row of rows ?? []) {
        const outcomes = await ingestWebhookPayload(ctx, row.payload, row.id, new Date(row.received_at));
        for (const o of outcomes) counts[o.status] = (counts[o.status] ?? 0) + 1;
        await supabase
          .from('kommo_webhook_events')
          .update({ result: { ...row.result, ingested: summarizeOutcomes(outcomes).counts } })
          .eq('id', row.id);
      }
      return json({ ok: true, events: rows?.length ?? 0, counts });
    }

    if (action === 'summary') {
      const { data, error } = await supabase
        .from('kommo_webhook_events')
        .select('id, received_at, payload, result')
        // Janela recente usa o índice de received_at; sem ela o filtro em result varre a tabela toda.
        .gte('received_at', new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString())
        .eq('result->>probe', 'outgoing')
        .order('received_at', { ascending: false })
        .limit(20);
      if (error) return json({ ok: false, error: error.message }, 500);
      const events = [];
      for (const row of data ?? []) {
        const items = messageItems(row.payload);
        const ids = items.map(({ item }) => String(item?.id ?? '')).filter(Boolean);
        const { data: stored } = ids.length
          ? await supabase.from('conversation_messages').select('external_id, message_type, sender').in('external_id', ids)
          : { data: [] };
        const byId = new Map((stored ?? []).map((s: Any) => [s.external_id, s]));
        events.push({
          received_at: row.received_at,
          content_type: row.result?.content_type ?? null,
          top_keys: Object.keys(row.payload ?? {}).sort(),
          messages: items.map(({ group, item }) => ({
            group,
            ...sanitize(item),
            in_db: byId.has(String(item?.id)) ? byId.get(String(item?.id)) : null,
          })),
        });
      }
      return json({ ok: true, events });
    }
    return json({ ok: false, error: 'action inválida' }, 400);
  }

  const secret = url.searchParams.get('secret');
  if (!secret || secret !== Deno.env.get('KOMMO_OUTGOING_PROBE_SECRET')) return new Response('Unauthorized', { status: 401 });

  const rawText = await req.text();
  const contentType = req.headers.get('content-type') ?? '';
  let payload: unknown;
  try {
    payload = contentType.includes('application/json') ? JSON.parse(rawText) : parseBracketForm(rawText);
  } catch {
    payload = { raw: rawText };
  }

  // processed = true: o kommo-reprocess não tenta ingerir eventos de teste pendentes.
  const { error } = await supabase.from('kommo_webhook_events').insert({
    payload,
    raw_body: rawText,
    received_at: new Date().toISOString(),
    processed: true,
    processed_at: new Date().toISOString(),
    result: { probe: 'outgoing', content_type: contentType.split(';')[0] },
  });
  if (error) {
    console.error('kommo-outgoing-probe: falha ao gravar evento', error.message);
    return new Response('staging failed', { status: 500 });
  }
  console.log(JSON.stringify({ kommo_outgoing_probe: 'received', messages: messageItems(payload).length }));
  return new Response('ok', { status: 200 });
});
