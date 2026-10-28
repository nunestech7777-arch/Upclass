/**
 * Webhook add_outgoing_message (mensagens enviadas por vendedor/bot) contra Postgres real (PGlite):
 * aplica as migrações e executa o código real de _shared/kommoIngest.ts. Os payloads seguem o formato
 * recebido de verdade em 27/10/2026 (form-urlencoded, outgoing_message[add][0][...]), com dados FICTÍCIOS.
 *
 * Rodar com: npm test
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const LEAD_RESPONSIBLE: Record<string, number> = { '2001': 11, '2002': 22 };

(globalThis as Record<string, unknown>).Deno = {
  env: { get: (k: string) => ({ KOMMO_SUBDOMAIN: 'loja', KOMMO_API_TOKEN: 't', KOMMO_DEBUG: 'false' })[k] },
};
globalThis.fetch = (async (url: string) => {
  const id = String(url).match(/leads\/(\d+)/)?.[1];
  if (!id || !(id in LEAD_RESPONSIBLE)) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify({ id: Number(id), name: 'Lead', responsible_user_id: LEAD_RESPONSIBLE[id] }), { status: 200 });
}) as typeof fetch;

const db = new PGlite();

function fakeSupabase(pg: PGlite) {
  return {
    from(table: string) {
      let cols = '*';
      const filters: Array<[string, unknown]> = [];
      const builder = {
        select(c: string) {
          cols = c;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        async maybeSingle() {
          const where = filters.map(([c], i) => `${c} = $${i + 1}`).join(' and ');
          const res = await pg.query(`select ${cols} from ${table} where ${where} limit 1`, filters.map(([, v]) => v));
          return { data: res.rows[0] ?? null, error: null };
        },
      };
      return builder;
    },
    async rpc(name: string, p: Record<string, unknown>) {
      try {
        if (name === 'kommo_ingest_message') {
          const res = await pg.query<{ r: Record<string, unknown> }>(
            'select kommo_ingest_message($1, $2, $3, $4::jsonb, $5) as r',
            [p.p_conversation_key, p.p_seller_id, p.p_client_name, JSON.stringify(p.p_message), p.p_event_id]
          );
          return { data: res.rows[0].r, error: null };
        }
        assert.equal(name, 'kommo_fill_talk_messages');
        const res = await pg.query<{ r: Record<string, unknown> }>('select kommo_fill_talk_messages($1, $2::jsonb) as r', [
          p.p_conversation_id,
          JSON.stringify(p.p_messages),
        ]);
        return { data: res.rows[0].r, error: null };
      } catch (err) {
        return { data: null, error: { message: String(err) } };
      }
    },
  };
}

// deno-lint-ignore no-explicit-any
let ingest: any;
// deno-lint-ignore no-explicit-any
let parseBracketForm: any;

/** Monta o corpo form-urlencoded como o Kommo envia (account[...] + outgoing_message[add][i][...]). */
function formBody(groups: Record<string, Array<Record<string, unknown>>>): string {
  const params = new URLSearchParams();
  params.set('account[id]', '32921047');
  params.set('account[subdomain]', 'loja');
  const put = (prefix: string, v: unknown) => {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) put(`${prefix}[${k}]`, x);
    else if (v !== undefined) params.set(prefix, String(v));
  };
  for (const [group, items] of Object.entries(groups)) items.forEach((it, i) => put(`${group}[add][${i}]`, it));
  return params.toString();
}

async function deliver(groups: Record<string, Array<Record<string, unknown>>>) {
  const payload = parseBracketForm(formBody(groups));
  const ev = await db.query<{ id: string }>('insert into kommo_webhook_events (payload) values ($1::jsonb) returning id', [JSON.stringify(payload)]);
  return ingest.ingestWebhookPayload(ingest.createIngestContext(fakeSupabase(db)), payload, ev.rows[0].id, new Date('2026-10-27T18:45:00Z'));
}

const T0 = 1793126400;
function out(over: Record<string, unknown> & { id: string }) {
  return {
    chat_id: 'chat-w',
    talk_id: '900',
    contact_id: '700',
    text: `resposta ${over.id}`,
    created_at: String(T0),
    message_type: 'text',
    element_type: '2',
    element_id: '2001',
    entity_type: 'lead',
    entity_id: '2001',
    type: 'outgoing',
    origin: 'waba',
    author: { id: 'amojo-u11', type: 'internal', name: 'Vendedor A', avatar_url: '', user_id: '11' },
    recipient: { id: 'amojo-c', type: 'external', name: 'Cliente', avatar_url: '' },
    ...over,
  };
}
function incoming(over: Record<string, unknown> & { id: string }) {
  return {
    chat_id: 'chat-w',
    talk_id: '900',
    contact_id: '700',
    text: `pergunta ${over.id}`,
    created_at: String(T0 - 60),
    entity_type: 'lead',
    entity_id: '2001',
    type: 'incoming',
    origin: 'waba',
    author: { id: 'amojo-c', type: 'external', name: 'Cliente' },
    ...over,
  };
}

async function convId(key: string): Promise<string | null> {
  return (await db.query<{ id: string }>('select id from conversations where external_id = $1', [key])).rows[0]?.id ?? null;
}
async function msg(id: string) {
  return (await db.query<Record<string, unknown>>('select * from conversation_messages where external_id = $1', [id])).rows;
}
async function placeholder(conversationId: string, id: string, at: number, sender = 'seller', senderId: string | null = '11') {
  const r = await db.query<{ r: string }>('select kommo_insert_event_placeholder($1::jsonb) as r', [
    JSON.stringify({
      conversation_id: conversationId,
      kommo_message_id: id,
      kommo_talk_id: '900',
      direction: 'outgoing',
      sender_type: sender,
      sender_id: senderId,
      sender_name: null,
      sent_at: new Date(at * 1000).toISOString(),
      created_at_original: String(at),
      source_event: { type: 'outgoing_chat_message' },
    }),
  ]);
  return r.rows[0].r;
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  `);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/create extension[^;]*;/gi, ''));
  }
  await db.exec(`
    insert into kommo_users (id, name) values ('11', 'Vendedor A'), ('22', 'Vendedor B');
    insert into sellers (name, kommo_user_id) values ('Vendedor A', '11'), ('Vendedor B', '22');
  `);
  ingest = await import('../functions/_shared/kommoIngest.ts');
  parseBracketForm = (await import('../functions/_shared/kommoMessage.ts')).parseBracketForm;
  // Conversa já existente (o cliente escreveu antes, pelo webhook de entrada).
  await deliver({ message: [incoming({ id: 'in-1' })] });
});

const KEY = 'kommo:lead:2001:chat:chat-w';

test('resposta do vendedor preenche o marcador da events API: texto, vendedor (user_id), sem duplicar', async () => {
  const conv = (await convId(KEY))!;
  assert.equal(await placeholder(conv, 'o-1', T0, 'seller', '11'), 'inserted');
  const res = await deliver({ outgoing_message: [out({ id: 'o-1', text: 'Temos sim, R$ 4.000' })] });
  assert.deepEqual(res.map((r: { status: string }) => r.status), ['updated']);
  const [row] = await msg('o-1');
  assert.equal(row.message, 'Temos sim, R$ 4.000');
  assert.equal(row.message_type, 'text');
  assert.equal(row.sender, 'seller');
  assert.equal(row.sender_id, '11');
  assert.equal(row.direction, 'outgoing');
  assert.equal(row.conversation_id, conv);
  assert.equal((row.raw_payload as Record<string, unknown>)._source, 'outgoing_webhook');
  assert.equal((row.raw_payload as Record<string, unknown>).origin, 'waba');
  assert.equal((await msg('o-1')).length, 1);
});

test('webhook antes do marcador: grava a mensagem real e o marcador posterior não duplica', async () => {
  const res = await deliver({ outgoing_message: [out({ id: 'o-2', created_at: String(T0 + 10) })] });
  assert.equal(res[0].status, 'inserted');
  assert.equal(await placeholder((await convId(KEY))!, 'o-2', T0 + 10), 'exists');
  const rows = await msg('o-2');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].message_type, 'text');
  assert.equal(rows[0].sender_id, '11');
  assert.equal(rows[0].kommo_lead_id, '2001');
});

test('reentrega do webhook não reescreve a mensagem já gravada', async () => {
  const res = await deliver({ outgoing_message: [out({ id: 'o-2', created_at: String(T0 + 10), text: 'outro texto' })] });
  assert.equal(res[0].status, 'duplicate_ignored');
  assert.equal((await msg('o-2'))[0].message, 'resposta o-2');
});

test('bot (user_id "0") vira bot, nunca vendedor', async () => {
  const res = await deliver({
    outgoing_message: [out({ id: 'o-bot', created_at: String(T0 + 20), author: { id: 'amojo-bot', type: 'bot', name: 'Salesbot', user_id: '0' } })],
  });
  assert.equal(res[0].status, 'inserted');
  const [row] = await msg('o-bot');
  assert.equal(row.sender, 'bot');
  assert.equal(row.sender_id, 'amojo-bot');
});

test('vendedor sem user_id não apaga o vendedor do marcador; sem autor não vira vendedor', async () => {
  const conv = (await convId(KEY))!;
  await placeholder(conv, 'o-3', T0 + 30, 'seller', '22');
  await deliver({ outgoing_message: [out({ id: 'o-3', created_at: String(T0 + 30), author: { id: 'amojo-x', type: 'internal', name: 'Alguém' } })] });
  const [kept] = await msg('o-3');
  assert.equal(kept.sender, 'seller');
  assert.equal(kept.sender_id, '22');
  assert.equal(kept.message, 'resposta o-3');

  await deliver({ outgoing_message: [out({ id: 'o-4', created_at: String(T0 + 40), author: undefined })] });
  const [unknown] = await msg('o-4');
  assert.notEqual(unknown.sender, 'seller');
  assert.equal(unknown.sender_name, 'Autor não identificado');
});

test('áudio sem texto entra com o tipo do anexo; Instagram mantém a origem', async () => {
  await deliver({
    outgoing_message: [
      out({ id: 'o-voice', created_at: String(T0 + 50), text: '', message_type: 'voice', attachment: { type: 'voice', link: 'https://x/a.ogg', file_name: 'a.ogg' } }),
      out({ id: 'o-ig', created_at: String(T0 + 60), origin: 'instagram_business', chat_id: 'chat-ig', entity_id: '2002' }),
    ],
  });
  const [voice] = await msg('o-voice');
  assert.equal(voice.message_type, 'voice');
  assert.equal(voice.message, '');
  const [ig] = await msg('o-ig');
  assert.equal((ig.raw_payload as Record<string, unknown>).origin, 'instagram_business');
});

test('sem conversa existente: cria pelo caminho do webhook, com o vendedor do lead', async () => {
  const id = await convId('kommo:lead:2002:chat:chat-ig');
  assert.ok(id, 'conversa criada');
  const seller = (await db.query<{ seller_id: string; kommo_user_id: string }>(
    'select c.seller_id, s.kommo_user_id from conversations c join sellers s on s.id = c.seller_id where c.id = $1',
    [id]
  )).rows[0];
  assert.equal(seller.kommo_user_id, '22');
  const [row] = await msg('o-ig');
  assert.equal(row.sender, 'seller');
  assert.equal(row.sender_id, '11');
});

test('payload com entrada e saída: as duas direções gravadas em ordem; message[add] segue igual', async () => {
  const res = await deliver({
    message: [incoming({ id: 'in-2', created_at: String(T0 + 70) })],
    outgoing_message: [out({ id: 'o-5', created_at: String(T0 + 80) })],
  });
  assert.deepEqual(res.map((r: { status: string }) => r.status), ['inserted', 'inserted']);
  const rows = (await db.query<{ external_id: string; sender: string }>(
    'select external_id, sender from conversation_messages where conversation_id = $1 order by sent_at, received_seq',
    [(await convId(KEY))!]
  )).rows;
  assert.deepEqual(rows.slice(-2), [
    { external_id: 'in-2', sender: 'client' },
    { external_id: 'o-5', sender: 'seller' },
  ]);
  const count = (await db.query<{ n: number }>('select messages_count n from conversations where external_id = $1', [KEY])).rows[0].n;
  const real = (await db.query<{ n: number }>('select count(*)::int n from conversation_messages where conversation_id = $1', [(await convId(KEY))!])).rows[0].n;
  assert.equal(count, real);
});

test('nenhuma mensagem duplicada no banco', async () => {
  const dup = await db.query('select external_id from conversation_messages group by external_id having count(*) > 1');
  assert.equal(dup.rows.length, 0);
});
