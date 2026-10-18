/**
 * Teste de integração da ingestão do Kommo contra um Postgres real (PGlite, em memória):
 * aplica as migrações do projeto e executa o código real de _shared/kommoIngest.ts
 * (o mesmo do webhook), com Deno, fetch da API do Kommo e cliente Supabase simulados.
 *
 * Rodar com: npm test
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { buildTranscript } from '../../src/lib/transcript.ts';
import type { KommoWebhookMessage } from '../functions/_shared/kommoMessage.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// ---------------------------------------------------------------------------
// Ambiente simulado: Deno.env, API do Kommo (leads/{id}) e cliente Supabase mínimo
// ---------------------------------------------------------------------------
const LEAD_RESPONSIBLE: Record<string, number> = { '1001': 11, '1002': 22, '1003': 11, '77': 11 };
let kommoApiCalls = 0;

(globalThis as Record<string, unknown>).Deno = {
  env: { get: (k: string) => ({ KOMMO_SUBDOMAIN: 'loja', KOMMO_API_TOKEN: 't', KOMMO_DEBUG: 'false' })[k] },
};
globalThis.fetch = (async (url: string) => {
  kommoApiCalls += 1;
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
      assert.equal(name, 'kommo_ingest_message');
      try {
        const res = await pg.query<{ r: Record<string, unknown> }>(
          'select kommo_ingest_message($1, $2, $3, $4::jsonb, $5) as r',
          [p.p_conversation_key, p.p_seller_id, p.p_client_name, JSON.stringify(p.p_message), p.p_event_id]
        );
        return { data: res.rows[0].r, error: null };
      } catch (err) {
        return { data: null, error: { message: String(err) } };
      }
    },
  };
}

// deno-lint-ignore no-explicit-any
let ingest: any;
let ctxFactory: () => unknown;

async function deliver(messages: KommoWebhookMessage[], receivedAt = new Date('2026-09-26T12:00:00Z')) {
  const payload = { message: { add: messages } };
  const ev = await db.query<{ id: string }>('insert into kommo_webhook_events (payload) values ($1::jsonb) returning id', [
    JSON.stringify(payload),
  ]);
  return ingest.ingestWebhookPayload(ctxFactory(), payload, ev.rows[0].id, receivedAt);
}

let seq = 0;
function km(over: Partial<KommoWebhookMessage> & { id: string }): KommoWebhookMessage {
  seq += 1;
  return {
    chat_id: 'chat-1',
    talk_id: '1',
    contact_id: '500',
    text: `texto ${over.id}`,
    created_at: String(1790000000 + seq * 10),
    entity_type: 'lead',
    entity_id: '1001',
    type: 'incoming',
    author: { id: 'ext', type: 'external', name: 'Cliente Maria' },
    ...over,
  };
}

async function timeline(key: string) {
  const conv = await db.query<{ id: string; client_name: string; seller_id: string | null; messages_count: number }>(
    'select id, client_name, seller_id, messages_count from conversations where external_id = $1',
    [key]
  );
  if (!conv.rows[0]) return null;
  const msgs = await db.query<Record<string, unknown>>(
    'select * from conversation_messages where conversation_id = $1 order by sent_at, received_seq, id',
    [conv.rows[0].id]
  );
  return { conv: conv.rows[0], msgs: msgs.rows };
}

function toTranscriptRows(rows: Record<string, unknown>[]) {
  return rows.map((r) => ({
    ...r,
    sent_at: new Date(r.sent_at as string).toISOString(),
    received_seq: Number(r.received_seq),
  })) as never[];
}

let SELLER_A = '';
let SELLER_B = '';

before(async () => {
  // Stubs do ambiente Supabase que as migrações referenciam.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  `);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (f.startsWith('0006')) {
      // Dado legado (formato antigo: agrupado só por chat_id, sem external_id na mensagem)
      // para validar a migração de chave.
      await db.exec(`
        insert into conversations (external_id, client_name, occurred_at, raw_payload)
        values ('kommo:chat-legacy', 'Cliente', '2026-09-01T10:00:00Z',
                '{"entity_type":"lead","entity_id":"77","chat_id":"chat-legacy","contact_id":"900"}');
      `);
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/create extension[^;]*;/gi, '');
    await db.exec(sql);
  }
  await db.exec(`
    insert into kommo_users (id, name) values ('11', 'Vendedor A'), ('22', 'Vendedor B');
    insert into sellers (name, kommo_user_id) values ('Vendedor A', '11'), ('Vendedor B', '22');
  `);
  SELLER_A = (await db.query<{ id: string }>(`select id from sellers where kommo_user_id = '11'`)).rows[0].id;
  SELLER_B = (await db.query<{ id: string }>(`select id from sellers where kommo_user_id = '22'`)).rows[0].id;

  ingest = await import('../functions/_shared/kommoIngest.ts');
  ctxFactory = () => ingest.createIngestContext(fakeSupabase(db));
});

test('migração: conversa legada agrupada só por chat é rechaveada para lead + chat', async () => {
  const t = await timeline('kommo:lead:77:chat:chat-legacy');
  assert.ok(t, 'conversa legada deveria ter nova chave');
  const row = (await db.query<Record<string, string>>(`select kommo_lead_id, kommo_chat_id, kommo_contact_id from conversations where external_id = 'kommo:lead:77:chat:chat-legacy'`)).rows[0];
  assert.deepEqual(row, { kommo_lead_id: '77', kommo_chat_id: 'chat-legacy', kommo_contact_id: '900' });
});

test('conversa simples cliente ↔ atendente: ordem, autores, vendedor e raw_payload', async () => {
  const original = [
    km({ id: 's1', chat_id: 'simple', text: 'Oi, tem iPhone 16?' }),
    km({ id: 's2', chat_id: 'simple', type: 'outgoing', author: { id: 'u11', type: 'user', name: 'Ana Atendente' }, text: 'Temos sim!' }),
    km({ id: 's3', chat_id: 'simple', text: 'Qual o valor?' }),
    km({ id: 's4', chat_id: 'simple', type: 'outgoing', author: { id: 'u11', type: 'user', name: 'Ana Atendente' }, text: 'R$ 6.000' }),
  ];
  const out = await deliver(original);
  assert.deepEqual(out.map((o: { status: string }) => o.status), ['inserted', 'inserted', 'inserted', 'inserted']);

  const t = (await timeline('kommo:lead:1001:chat:simple'))!;
  assert.equal(t.conv.seller_id, SELLER_A);
  assert.equal(t.conv.client_name, 'Cliente Maria');
  assert.equal(t.conv.messages_count, 4);
  assert.deepEqual(t.msgs.map((m) => m.external_id), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(t.msgs.map((m) => m.sender), ['client', 'seller', 'client', 'seller']);
  assert.deepEqual(t.msgs.map((m) => m.sender_name), ['Cliente Maria', 'Ana Atendente', 'Cliente Maria', 'Ana Atendente']);
  // raw_payload idêntico ao recebido e horário original preservado
  assert.deepEqual(t.msgs[1].raw_payload, original[1]);
  assert.equal(t.msgs[0].created_at_original, original[0].created_at);
  assert.equal(new Date(t.msgs[0].sent_at as string).getTime(), Number(original[0].created_at) * 1000);

  // Comparação final: o que a tela mostra == conversa original do Kommo
  const shown = buildTranscript(toTranscriptRows(t.msgs), { clientName: t.conv.client_name }, 'UTC');
  assert.deepEqual(
    shown.map((m) => [m.sender, m.senderName, m.text]),
    original.map((o) => [o.type === 'incoming' ? 'client' : 'seller', o.author!.name, o.text])
  );
});

test('webhooks fora de ordem: timeline reconstruída pelo horário original do Kommo', async () => {
  const [a, b, c, d] = [
    km({ id: 'o1', chat_id: 'ooo' }),
    km({ id: 'o2', chat_id: 'ooo', type: 'outgoing', author: { type: 'user', name: 'Ana' } }),
    km({ id: 'o3', chat_id: 'ooo' }),
    km({ id: 'o4', chat_id: 'ooo', type: 'outgoing', author: { type: 'user', name: 'Ana' } }),
  ];
  await deliver([d]);
  await deliver([b]);
  await deliver([c, a]);
  const t = (await timeline('kommo:lead:1001:chat:ooo'))!;
  assert.deepEqual(t.msgs.map((m) => m.external_id), ['o1', 'o2', 'o3', 'o4']);
  // client_name corrigido quando a 1ª mensagem que chegou era do atendente
  assert.equal(t.conv.client_name, 'Cliente Maria');
});

test('webhook duplicado: nenhuma mensagem repetida e contagem estável', async () => {
  const batch = [km({ id: 'd1', chat_id: 'dup' }), km({ id: 'd2', chat_id: 'dup', type: 'outgoing', author: { type: 'user', name: 'Ana' } })];
  await deliver(batch);
  const again = await deliver(batch);
  const third = await deliver([batch[1]]);
  assert.deepEqual(again.map((o: { status: string }) => o.status), ['duplicate_ignored', 'duplicate_ignored']);
  assert.equal(third[0].status, 'duplicate_ignored');
  const t = (await timeline('kommo:lead:1001:chat:dup'))!;
  assert.equal(t.msgs.length, 2);
  assert.equal(t.conv.messages_count, 2);
});

test('bot e sistema: identificados separadamente do atendente', async () => {
  await deliver([
    km({ id: 'b1', chat_id: 'bot', text: 'Oi' }),
    km({ id: 'b2', chat_id: 'bot', type: 'outgoing', author: { id: 'sb', type: 'bot', name: 'SalesBot' }, text: 'Olá! Sou o assistente.' }),
    km({ id: 'b3', chat_id: 'bot', type: 'outgoing', author: { type: 'system' }, text: 'Conversa transferida' }),
    km({ id: 'b4', chat_id: 'bot', type: 'outgoing', author: { type: 'user', name: 'Ana' }, text: 'Assumi aqui' }),
  ]);
  const t = (await timeline('kommo:lead:1001:chat:bot'))!;
  assert.deepEqual(t.msgs.map((m) => [m.sender, m.sender_name]), [
    ['client', 'Cliente Maria'],
    ['bot', 'SalesBot'],
    ['system', 'Sistema'],
    ['seller', 'Ana'],
  ]);
});

test('mensagens no mesmo segundo: ordem estável de chegada', async () => {
  const sameSecond = '1790009999';
  await deliver([
    km({ id: 'ss1', chat_id: 'same', created_at: sameSecond, text: 'primeira' }),
    km({ id: 'ss2', chat_id: 'same', created_at: sameSecond, text: 'segunda' }),
    km({ id: 'ss3', chat_id: 'same', created_at: sameSecond, text: 'terceira' }),
  ]);
  const t = (await timeline('kommo:lead:1001:chat:same'))!;
  assert.deepEqual(t.msgs.map((m) => m.text ?? m.message), ['primeira', 'segunda', 'terceira']);
  // e a tela mantém a mesma ordem mesmo se o array vier embaralhado
  const shown = buildTranscript(toTranscriptRows([...t.msgs].reverse()), { clientName: 'B' }, 'UTC');
  assert.deepEqual(shown.map((m) => m.text), ['primeira', 'segunda', 'terceira']);
});

test('leads diferentes simultâneos (e no mesmo chat) não se misturam', async () => {
  const interleaved = [
    km({ id: 'x1', entity_id: '1001', chat_id: 'shared' }),
    km({ id: 'y1', entity_id: '1002', chat_id: 'other', author: { type: 'external', name: 'João' } }),
    km({ id: 'x2', entity_id: '1001', chat_id: 'shared', type: 'outgoing', author: { type: 'user', name: 'Ana' } }),
    km({ id: 'y2', entity_id: '1002', chat_id: 'other', type: 'outgoing', author: { type: 'user', name: 'Bruno' } }),
    // mesmo chat "shared", mas agora num lead novo do mesmo contato
    km({ id: 'z1', entity_id: '1003', chat_id: 'shared' }),
  ];
  await Promise.all(interleaved.map((m) => deliver([m])));

  const x = (await timeline('kommo:lead:1001:chat:shared'))!;
  const y = (await timeline('kommo:lead:1002:chat:other'))!;
  const z = (await timeline('kommo:lead:1003:chat:shared'))!;
  assert.deepEqual(x.msgs.map((m) => m.external_id), ['x1', 'x2']);
  assert.deepEqual(y.msgs.map((m) => m.external_id), ['y1', 'y2']);
  assert.deepEqual(z.msgs.map((m) => m.external_id), ['z1']);
  assert.equal(x.conv.seller_id, SELLER_A);
  assert.equal(y.conv.seller_id, SELLER_B);
  assert.equal(y.conv.client_name, 'João');
});

test('lead com mais de um contato/chat: cada chat é uma transcrição do mesmo lead', async () => {
  await deliver([
    km({ id: 'c1', entity_id: '1002', chat_id: 'wa-pai', contact_id: '1', author: { type: 'external', name: 'Pai' } }),
    km({ id: 'c2', entity_id: '1002', chat_id: 'wa-filho', contact_id: '2', author: { type: 'external', name: 'Filho' } }),
  ]);
  const pai = (await timeline('kommo:lead:1002:chat:wa-pai'))!;
  const filho = (await timeline('kommo:lead:1002:chat:wa-filho'))!;
  assert.deepEqual(pai.msgs.map((m) => m.sender_name), ['Pai']);
  assert.deepEqual(filho.msgs.map((m) => m.sender_name), ['Filho']);
  assert.equal(pai.conv.seller_id, SELLER_B);
  assert.equal(filho.conv.seller_id, SELLER_B);
});

test('anexo sem texto é gravado; mensagem inválida no lote não derruba as demais', async () => {
  const out = await deliver([
    km({ id: 'a1', chat_id: 'att', text: '', attachment: { type: 'picture', link: 'https://img' } }),
    km({ id: 'a2', chat_id: '' }),
    km({ id: 'a3', chat_id: 'att', text: 'depois do inválido' }),
  ]);
  assert.deepEqual(out.map((o: { status: string }) => o.status), ['inserted', 'skipped', 'inserted']);
  const t = (await timeline('kommo:lead:1001:chat:att'))!;
  assert.deepEqual(t.msgs.map((m) => [m.external_id, m.message_type]), [['a1', 'picture'], ['a3', 'text']]);
});

test('timestamp inválido usa hora de recebimento; reentrega com horário válido corrige, o contrário não estraga', async () => {
  const receivedAt = new Date('2026-09-26T12:00:00Z');
  await deliver([km({ id: 'ts1', chat_id: 'ts', created_at: '' })], receivedAt);
  let row = (await timeline('kommo:lead:1001:chat:ts'))!.msgs[0];
  assert.equal(row.timestamp_valid, false);
  assert.equal(new Date(row.sent_at as string).toISOString(), receivedAt.toISOString());

  await deliver([km({ id: 'ts1', chat_id: 'ts', created_at: '1790000000' })]);
  row = (await timeline('kommo:lead:1001:chat:ts'))!.msgs[0];
  assert.equal(row.timestamp_valid, true);
  assert.equal(new Date(row.sent_at as string).toISOString(), '2026-09-21T14:13:20.000Z');
  assert.equal(row.created_at_original, '1790000000', 'horário original acompanha o sent_at corrigido');

  await deliver([km({ id: 'ts1', chat_id: 'ts', created_at: 'lixo' })], new Date('2027-01-01T00:00:00Z'));
  row = (await timeline('kommo:lead:1001:chat:ts'))!.msgs[0];
  assert.equal(new Date(row.sent_at as string).toISOString(), '2026-09-21T14:13:20.000Z');
});

test('reentrega com outro horário válido: created_at_original acompanha sent_at', async () => {
  await deliver([km({ id: 'tv1', chat_id: 'tv', created_at: '1790000000' })]);
  await deliver([km({ id: 'tv1', chat_id: 'tv', created_at: '1790000100' })]);
  const row = (await db.query<{ ok: boolean }>(
    `select extract(epoch from sent_at) = created_at_original::numeric as ok from conversation_messages where external_id = 'tv1'`
  )).rows[0];
  assert.equal(row.ok, true);
});

test('duas entregas sem horário válido: a mensagem não "anda" para o recebimento mais recente', async () => {
  await deliver([km({ id: 'ff1', chat_id: 'ff', created_at: '' })], new Date('2026-09-26T12:00:00Z'));
  await deliver(
    [km({ id: 'ff1', chat_id: 'ff', created_at: '', author: { type: 'external', name: 'Nome Atualizado' } })],
    new Date('2026-09-26T15:00:00Z')
  );
  const row = (await timeline('kommo:lead:1001:chat:ff'))!.msgs[0];
  assert.equal(row.sender_name, 'Nome Atualizado');
  assert.equal(new Date(row.sent_at as string).toISOString(), '2026-09-26T12:00:00.000Z');
});

test('limpeza de conversas vazias usa mensagens reais, não messages_count desatualizado', async () => {
  const stale = (await db.query<{ id: string }>(
    `insert into conversations (external_id, client_name, messages_count) values ('kommo:lead:5:chat:stale', 'X', 0) returning id`
  )).rows[0].id;
  await db.query(`insert into conversation_messages (conversation_id, sender, message) values ($1, 'client', 'oi')`, [stale]);
  await db.query(`insert into conversations (external_id, client_name, messages_count) values ('kommo:lead:6:chat:empty', 'Y', 3)`);
  await db.query(`insert into conversations (external_id, client_name, summary) values ('kommo:lead:7:chat:analisada', 'Z', 'resumo')`);
  await db.query(`insert into conversations (external_id, client_name, result_type) values ('kommo:lead:8:chat:resultado', 'W', 'success')`);
  const removed = (await db.query<{ n: number }>('select kommo_delete_empty_conversations() as n')).rows[0].n;
  const left = (await db.query<{ external_id: string }>(
    `select external_id from conversations where external_id in ('kommo:lead:5:chat:stale','kommo:lead:6:chat:empty','kommo:lead:7:chat:analisada','kommo:lead:8:chat:resultado') order by 1`
  )).rows.map((r) => r.external_id);
  assert.ok(removed >= 1);
  assert.deepEqual(left, ['kommo:lead:5:chat:stale', 'kommo:lead:7:chat:analisada', 'kommo:lead:8:chat:resultado']);
  // remove os fixtures artificiais (contagem propositalmente divergente) para não afetar a checagem global
  await db.query(`delete from conversations where external_id in ('kommo:lead:5:chat:stale', 'kommo:lead:7:chat:analisada', 'kommo:lead:8:chat:resultado')`);
});

test('reprocessamento: corrige remetente e agrupamento de mensagens gravadas pela lógica antiga', async () => {
  // Simula o estado antigo: mensagem do bot gravada como "seller" na conversa agrupada só por chat.
  const legacyConv = (await db.query<{ id: string }>(
    `insert into conversations (external_id, client_name) values ('kommo:reproc', 'Cliente') returning id`
  )).rows[0].id;
  await db.query(
    `insert into conversation_messages (conversation_id, external_id, sender, message, sent_at)
     values ($1, 'r1', 'seller', 'Olá! Sou o bot', to_timestamp(1790000100))`,
    [legacyConv]
  );
  await db.query(`update conversations set messages_count = 1 where id = $1`, [legacyConv]);

  // Replay do payload bruto guardado (o que o kommo-reprocess faz)
  const out = await deliver([km({ id: 'r1', chat_id: 'reproc', created_at: '1790000100', type: 'outgoing', author: { type: 'bot', name: 'SalesBot' }, text: 'Olá! Sou o bot' })]);
  assert.equal(out[0].status, 'updated');

  const t = (await timeline('kommo:lead:1001:chat:reproc'))!;
  assert.deepEqual(t.msgs.map((m) => [m.external_id, m.sender, m.sender_name]), [['r1', 'bot', 'SalesBot']]);
  assert.ok(t.msgs[0].raw_payload, 'raw_payload preenchido no reprocessamento');
  const old = (await db.query<{ messages_count: number }>(`select messages_count from conversations where id = $1`, [legacyConv])).rows[0];
  assert.equal(old.messages_count, 0, 'conversa antiga recontada após a mensagem ser movida');

  // Replay idempotente
  const again = await deliver([km({ id: 'r1', chat_id: 'reproc', created_at: '1790000100', type: 'outgoing', author: { type: 'bot', name: 'SalesBot' }, text: 'Olá! Sou o bot' })]);
  assert.equal(again[0].status, 'duplicate_ignored');
});

test('vendedor do lead é resolvido uma vez por conversa (cache + conversa existente)', async () => {
  const before = kommoApiCalls;
  await deliver([km({ id: 'k1', chat_id: 'cache' }), km({ id: 'k2', chat_id: 'cache' }), km({ id: 'k3', chat_id: 'cache' })]);
  await deliver([km({ id: 'k4', chat_id: 'cache' })]);
  assert.equal(kommoApiCalls - before, 1);
});

test('marcador da events API: entra na ordem certa e é substituído pelo texto real se o webhook chegar depois', async () => {
  await deliver([km({ id: 'p1', chat_id: 'ph', created_at: '1790000000', talk_id: '55' })]);
  const conv = (await timeline('kommo:lead:1001:chat:ph'))!.conv.id;
  const place = async (m: Record<string, unknown>) =>
    (await db.query<{ r: string }>('select kommo_insert_event_placeholder($1::jsonb) as r', [JSON.stringify(m)])).rows[0].r;
  const base = { conversation_id: conv, kommo_talk_id: '55', source_event: { type: 'x' } };
  assert.equal(await place({ ...base, kommo_message_id: 'p2', direction: 'outgoing', sender_type: 'seller', sender_id: '11', sender_name: 'Ana', sent_at: '2026-09-21T14:13:30Z', created_at_original: '1790000010' }), 'inserted');
  assert.equal(await place({ ...base, kommo_message_id: 'p3', direction: 'incoming', sender_type: 'client', sender_id: null, sender_name: null, sent_at: '2026-09-21T14:13:40Z', created_at_original: '1790000020' }), 'inserted');
  // idempotente
  assert.equal(await place({ ...base, kommo_message_id: 'p2', direction: 'outgoing', sender_type: 'seller', sender_id: '11', sender_name: 'Ana', sent_at: '2026-09-21T14:13:30Z', created_at_original: '1790000010' }), 'exists');

  let t = (await timeline('kommo:lead:1001:chat:ph'))!;
  assert.deepEqual(t.msgs.map((m) => [m.external_id, m.sender, m.message_type]), [
    ['p1', 'client', 'text'], ['p2', 'seller', 'unavailable'], ['p3', 'client', 'unavailable'],
  ]);
  assert.equal(t.conv.messages_count, 3);

  // o texto real de p3 chega depois pelo webhook: substitui o marcador, sem duplicar
  const out = await deliver([km({ id: 'p3', chat_id: 'ph', created_at: '1790000020', talk_id: '55', text: 'chegou atrasada' })]);
  assert.equal(out[0].status, 'updated');
  t = (await timeline('kommo:lead:1001:chat:ph'))!;
  assert.deepEqual(t.msgs.map((m) => [m.external_id, m.message_type, m.message]), [
    ['p1', 'text', 'texto p1'], ['p2', 'unavailable', ''], ['p3', 'text', 'chegou atrasada'],
  ]);
  assert.ok(t.msgs[2].raw_payload, 'payload do webhook gravado ao substituir o marcador');
  assert.equal(t.conv.messages_count, 3);
});

test('marcadores em lote: mesma semântica da inserção unitária (idempotente, conversa inexistente)', async () => {
  await deliver([km({ id: 'bt1', chat_id: 'batch', created_at: '1790000000', talk_id: '77' })]);
  const conv = (await timeline('kommo:lead:1001:chat:batch'))!.conv.id;
  const item = (id: string, at: string, conversation_id = conv) => ({
    conversation_id, kommo_message_id: id, direction: 'outgoing', sender_type: 'seller', sender_id: '11',
    sender_name: 'Ana', sent_at: at, created_at_original: null, kommo_talk_id: '77', source_event: {},
  });
  const run = async (items: unknown[]) =>
    (await db.query<{ r: Record<string, number> }>('select kommo_insert_event_placeholders($1::jsonb) as r', [JSON.stringify(items)])).rows[0].r;
  assert.deepEqual(
    await run([item('bt2', '2026-09-21T14:13:30Z'), item('bt3', '2026-09-21T14:13:40Z'), item('bt4', '2026-09-21T14:13:50Z', '00000000-0000-0000-0000-000000000000')]),
    { inserted: 2, exists: 0, not_found: 1, failed: 0 }
  );
  assert.deepEqual(await run([item('bt2', '2026-09-21T14:13:30Z')]), { inserted: 0, exists: 1, not_found: 0, failed: 0 });
  // item malformado não derruba o lote
  assert.deepEqual(
    await run([
      item('bt5', 'data-invalida'),
      item('bt6', '2026-09-21T14:14:00Z'),
      { ...item('bt7', '2026-09-21T14:14:10Z'), conversation_id: 'lixo' },
      { ...item('bt8', '2026-09-21T14:14:20Z'), conversation_id: null },
      { ...item('bt9', '2026-09-21T14:14:30Z'), conversation_id: '------------------------------------' },
    ]),
    { inserted: 1, exists: 0, not_found: 3, failed: 1 }
  );
  const t = (await timeline('kommo:lead:1001:chat:batch'))!;
  assert.deepEqual(t.msgs.map((m) => m.external_id), ['bt1', 'bt2', 'bt3', 'bt6']);
  assert.equal(t.conv.messages_count, 4);
});

test('segurança: papel authenticated não pode chamar a função de ingestão', async () => {
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query(`select kommo_ingest_message('k', null, null, '{}'::jsonb, null)`), /permission denied/);
    await assert.rejects(db.query(`select kommo_delete_empty_conversations()`), /permission denied/);
    await assert.rejects(db.query(`select kommo_insert_event_placeholder('{}'::jsonb)`), /permission denied/);
    await assert.rejects(db.query(`select kommo_insert_event_placeholders('[]'::jsonb)`), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('nenhuma mensagem duplicada em todo o banco', async () => {
  const dup = await db.query(`select external_id, count(*) from conversation_messages where external_id is not null group by 1 having count(*) > 1`);
  assert.equal(dup.rows.length, 0);
  const counts = await db.query(
    `select c.id from conversations c where c.messages_count is distinct from (select count(*) from conversation_messages m where m.conversation_id = c.id) and c.external_id like 'kommo:lead:%' and c.external_id <> 'kommo:lead:77:chat:chat-legacy'`
  );
  assert.equal(counts.rows.length, 0, 'messages_count sempre igual ao número real de mensagens');
});
