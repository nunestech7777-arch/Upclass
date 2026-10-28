/**
 * Teste de integração do histórico oficial dos talks (GET /api/v4/talks/{id}/messages) contra um
 * Postgres real (PGlite, em memória) com as migrações do projeto. Executa o código real de
 * _shared/kommo.ts, kommoIngest.ts e kommoTalkSync.ts; a API do Kommo é SIMULADA no formato
 * documentado — estes testes não provam que a conta real devolve as mensagens.
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

// ---------------------------------------------------------------------------
// API do Kommo simulada
// ---------------------------------------------------------------------------
type ApiMsg = Record<string, unknown>;
const TALK_MESSAGES: Record<string, ApiMsg[]> = {};
const TALKS: Record<string, { chat_id: string; entity_id: number; entity_type: string }> = {};
const TALK_STATUS: Record<string, number> = {};
const requests: string[] = [];
let talkHistoryFlag = 'on';
/** Talks em que o servidor ignora `page` e devolve sempre a mesma página. */
const IGNORES_PAGE = new Set<string>();

(globalThis as Record<string, unknown>).Deno = {
  env: { get: (k: string) => ({ KOMMO_SUBDOMAIN: 'loja', KOMMO_API_TOKEN: 't', KOMMO_DEBUG: 'false', KOMMO_TALK_HISTORY: talkHistoryFlag })[k] },
};
globalThis.fetch = (async (input: string) => {
  const url = new URL(String(input));
  requests.push(url.pathname + url.search);
  const lead = url.pathname.match(/\/leads\/(\d+)$/)?.[1];
  if (lead) return Response.json({ id: Number(lead), name: 'Lead', responsible_user_id: 11 });
  const msgs = url.pathname.match(/\/talks\/(\d+)\/messages$/)?.[1];
  if (msgs) {
    if (TALK_STATUS[msgs]) return new Response(JSON.stringify({ detail: 'x' }), { status: TALK_STATUS[msgs] });
    const page = IGNORES_PAGE.has(msgs) ? 1 : Number(url.searchParams.get('page'));
    const limit = Number(url.searchParams.get('limit'));
    const from = Number(url.searchParams.get('filter[created_at][from]') ?? 0);
    // Mais novo primeiro, como a maioria das listas do Kommo: o sync não pode depender da ordem.
    const all = (TALK_MESSAGES[msgs] ?? []).filter((m) => Number(m.created_at) >= from).reverse();
    const slice = all.slice((page - 1) * limit, page * limit);
    if (!slice.length) return new Response(null, { status: 204 });
    return Response.json({ _page: page, _embedded: { messages: slice } });
  }
  const talk = url.pathname.match(/\/talks\/(\d+)$/)?.[1];
  if (talk && TALKS[talk]) return Response.json({ talk_id: Number(talk), ...TALKS[talk] });
  return new Response('not found', { status: 404 });
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Cliente Supabase mínimo (o suficiente para kommoIngest + kommoTalkSync)
// ---------------------------------------------------------------------------
const db = new PGlite();

function fakeSupabase(pg: PGlite) {
  return {
    from(table: string) {
      let cols = '*';
      let lim = '';
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: (n: string) => string, v: unknown) => {
        params.push(v);
        where.push(sql(`$${params.length}`));
        return builder;
      };
      const run = async () => {
        const sql = `select ${cols} from ${table}${where.length ? ` where ${where.join(' and ')}` : ''}${lim}`;
        return { data: (await pg.query(sql, params)).rows, error: null };
      };
      const builder = {
        select(c: string) {
          cols = c;
          return builder;
        },
        eq: (c: string, v: unknown) => add((p) => `${c} = ${p}`, v),
        neq: (c: string, v: unknown) => add((p) => `${c} <> ${p}`, v),
        gte: (c: string, v: unknown) => add((p) => `${c} >= ${p}`, v),
        lte: (c: string, v: unknown) => add((p) => `${c} <= ${p}`, v),
        in: (c: string, v: unknown[]) => add((p) => `${c}::text = any(${p}::text[])`, v),
        limit(n: number) {
          lim = ` limit ${n}`;
          return builder;
        },
        async maybeSingle() {
          const r = await run();
          return { data: r.data[0] ?? null, error: null };
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, p: Record<string, unknown>) {
      try {
        if (name === 'kommo_ingest_message') {
          const res = await pg.query<{ r: unknown }>('select kommo_ingest_message($1, $2, $3, $4::jsonb, $5) as r', [
            p.p_conversation_key,
            p.p_seller_id,
            p.p_client_name,
            JSON.stringify(p.p_message),
            p.p_event_id,
          ]);
          return { data: res.rows[0].r, error: null };
        }
        if (name === 'kommo_fill_talk_messages') {
          const res = await pg.query<{ r: unknown }>('select kommo_fill_talk_messages($1, $2::jsonb) as r', [p.p_conversation_id, JSON.stringify(p.p_messages)]);
          return { data: res.rows[0].r, error: null };
        }
        if (name === 'kommo_insert_event_placeholders') {
          const res = await pg.query<{ r: unknown }>('select kommo_insert_event_placeholders($1::jsonb) as r', [JSON.stringify(p.p_messages)]);
          return { data: res.rows[0].r, error: null };
        }
        throw new Error(`rpc inesperado ${name}`);
      } catch (err) {
        return { data: null, error: { message: String(err) } };
      }
    },
  };
}

// deno-lint-ignore no-explicit-any
let sync: any;
// deno-lint-ignore no-explicit-any
let kommo: any;
const supa = fakeSupabase(db);

const T0 = 1793000000;
const client = (id: string, at: number, text = `cliente ${id}`): ApiMsg => ({
  id,
  chat_id: 'chat-1',
  type: 'incoming',
  message_type: 'text',
  author: { id: 'amojo-ext', type: 'external', name: 'Cliente' },
  text,
  created_at: at,
});
const sellerMsg = (id: string, at: number, userId: number, text = `vendedor ${id}`): ApiMsg => ({
  id,
  chat_id: 'chat-1',
  type: 'outgoing',
  message_type: 'text',
  author: { id: `amojo-${userId}`, type: 'internal', name: `Vendedor ${userId}`, user_id: userId },
  text,
  created_at: at,
});

/** Simula o estado atual de produção: mensagem do cliente pelo webhook + resposta como marcador sem texto. */
async function seedConversation(leadId: string, talkId: string, chatId: string) {
  const key = `kommo:lead:${leadId}:chat:${chatId}`;
  const conv = await db.query<{ id: string }>(
    `insert into conversations (external_id, client_name, occurred_at, kommo_lead_id, kommo_chat_id, kommo_contact_id)
     values ($1, 'Cliente', now(), $2, $3, '500') returning id`,
    [key, leadId, chatId]
  );
  return { key, id: conv.rows[0].id, talkId };
}

async function rows(conversationId: string) {
  return (
    await db.query<Record<string, unknown>>(
      `select external_id, sender, sender_id, direction, message, message_type, sent_at from conversation_messages
       where conversation_id = $1 order by sent_at, received_seq, id`,
      [conversationId]
    )
  ).rows;
}

async function runSync(
  leadId: string,
  talkIds: string[],
  talkToConversation: Map<string, string>,
  sinceUnix?: number,
  chatToConversation = new Map<string, string>()
) {
  const state = sync.newTalkHistoryState();
  const written = await sync.syncTalkHistory(supa, state, leadId, talkIds, talkToConversation, chatToConversation, sinceUnix);
  return { state, written };
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  `);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/create extension[^;]*;/gi, ''));
  }
  await db.exec(`
    insert into kommo_users (id, name) values ('11', 'Vendedor A'), ('22', 'Vendedor B');
    insert into sellers (name, kommo_user_id) values ('Vendedor A', '11'), ('Vendedor B', '22');
  `);
  kommo = await import('../functions/_shared/kommo.ts');
  sync = await import('../functions/_shared/kommoTalkSync.ts');
});

test('marcadores existentes recebem o texto real do vendedor; webhook do cliente não é reescrito', async () => {
  const c = await seedConversation('2001', '301', 'chat-1');
  // cliente pelo webhook (texto real) + resposta do vendedor como marcador da events API
  await supa.rpc('kommo_ingest_message', {
    p_conversation_key: c.key,
    p_seller_id: null,
    p_client_name: 'Cliente',
    p_event_id: null,
    p_message: {
      kommo_message_id: 'm1', kommo_chat_id: 'chat-1', kommo_talk_id: '301', kommo_contact_id: '500', kommo_lead_id: '2001',
      kommo_entity_type: 'lead', kommo_entity_id: '2001', direction: 'incoming', sender_type: 'client', sender_id: 'amojo-ext',
      sender_name: 'Cliente', message_text: 'texto do webhook', message_type: 'text', created_at_original: String(T0),
      sent_at: new Date(T0 * 1000).toISOString(), timestamp_valid: true, raw_payload: { from: 'webhook' },
    },
  });
  await supa.rpc('kommo_insert_event_placeholders', {
    p_messages: [{ conversation_id: c.id, kommo_message_id: 'm2', direction: 'outgoing', sender_type: 'seller', sender_id: '11', sender_name: 'Vendedor A', sent_at: new Date((T0 + 60) * 1000).toISOString(), created_at_original: String(T0 + 60), kommo_talk_id: '301', source_event: {} }],
  });

  TALK_MESSAGES['301'] = [client('m1', T0, 'texto da API'), sellerMsg('m2', T0 + 60, 11, 'Temos sim, R$ 5.000'), client('m3', T0 + 120)];
  const { state } = await runSync('2001', ['301'], new Map([['301', c.id]]));

  assert.equal(state.blocked, null);
  assert.equal(state.totals.placeholders_filled, 1);
  assert.equal(state.totals.inserted, 1);
  assert.equal(state.totals.already_stored, 1);
  const r = await rows(c.id);
  assert.deepEqual(
    r.map((x) => [x.external_id, x.sender, x.sender_id, x.direction, x.message, x.message_type]),
    [
      ['m1', 'client', 'amojo-ext', 'incoming', 'texto do webhook', 'text'], // histórico preservado
      ['m2', 'seller', '11', 'outgoing', 'Temos sim, R$ 5.000', 'text'], // marcador preenchido
      ['m3', 'client', 'amojo-ext', 'incoming', 'cliente m3', 'text'], // faltava
    ]
  );
  const conv = (await db.query<{ messages_count: number; seller_id: string | null }>('select messages_count, seller_id from conversations where id = $1', [c.id])).rows[0];
  assert.equal(conv.messages_count, 3);
});

test('6 e 5. várias páginas (limite 250) e vários vendedores, em ordem cronológica', async () => {
  const c = await seedConversation('2002', '302', 'chat-2');
  const msgs: ApiMsg[] = [];
  for (let i = 0; i < 260; i++) {
    const at = T0 + i * 10;
    msgs.push(i % 3 === 0 ? client(`p${i}`, at) : sellerMsg(`p${i}`, at, i % 3 === 1 ? 11 : 22));
  }
  TALK_MESSAGES['302'] = msgs;
  requests.length = 0;
  const { state } = await runSync('2002', ['302'], new Map([['302', c.id]]));
  const pages = requests.filter((u) => u.startsWith('/api/v4/talks/302/messages'));
  assert.equal(pages.length, 2);
  assert.ok(pages.every((u) => u.includes('limit=250')));
  assert.equal(state.totals.fetched, 260);
  assert.equal(state.totals.inserted, 260);
  const r = await rows(c.id);
  assert.equal(r.length, 260);
  assert.deepEqual(r.map((x) => x.external_id), msgs.map((m) => m.id));
  assert.deepEqual([...new Set(r.filter((x) => x.sender === 'seller').map((x) => x.sender_id))].sort(), ['11', '22']);
});

test('7 e 11. reexecução não duplica; sync incremental só busca a janela e não perde mensagens', async () => {
  const c = await seedConversation('2003', '303', 'chat-3');
  TALK_MESSAGES['303'] = [client('i1', T0), sellerMsg('i2', T0 + 10, 11)];
  await runSync('2003', ['303'], new Map([['303', c.id]]));
  const again = await runSync('2003', ['303'], new Map([['303', c.id]]));
  assert.equal(again.state.totals.inserted, 0);
  assert.equal(again.state.totals.already_stored, 2);
  assert.equal((await rows(c.id)).length, 2);

  // novas mensagens depois da janela anterior
  TALK_MESSAGES['303'].push(client('i3', T0 + 3600), sellerMsg('i4', T0 + 3700, 22));
  requests.length = 0;
  const inc = await runSync('2003', ['303'], new Map([['303', c.id]]), T0 + 3000);
  assert.ok(requests.some((u) => u.includes(`filter[created_at][from]=${T0 + 3000}`)));
  assert.equal(inc.state.totals.fetched, 2);
  assert.equal(inc.state.totals.inserted, 2);
  assert.deepEqual((await rows(c.id)).map((x) => x.external_id), ['i1', 'i2', 'i3', 'i4']);
  const dup = await db.query<{ n: number }>('select count(*)::int as n from (select external_id from conversation_messages group by 1 having count(*) > 1) d');
  assert.equal(dup.rows[0].n, 0);
});

test('talk sem conversa conhecida: só grava se o talk for deste lead e o chat já tiver conversa (não cria conversa)', async () => {
  const c = await seedConversation('2004', '304', 'chat-4');
  TALKS['304'] = { chat_id: 'chat-4', entity_id: 2004, entity_type: 'lead' };
  TALKS['305'] = { chat_id: 'chat-5', entity_id: 9999, entity_type: 'lead' }; // de outro lead
  TALKS['312'] = { chat_id: 'chat-sem-conversa', entity_id: 2004, entity_type: 'lead' };
  TALK_MESSAGES['304'] = [client('n1', T0), sellerMsg('n2', T0 + 5, 11)];
  TALK_MESSAGES['305'] = [client('n3', T0)];
  TALK_MESSAGES['312'] = [client('n4', T0)];
  const before = (await db.query<{ n: number }>('select count(*)::int as n from conversations')).rows[0].n;
  const { state } = await runSync('2004', ['304', '305', '312'], new Map(), undefined, new Map([['chat-4', c.id]]));
  assert.equal(state.totals.inserted, 2);
  assert.equal(state.totals.skipped, 2);
  assert.equal((await rows(c.id)).length, 2);
  assert.equal((await db.query(`select 1 from conversation_messages where external_id in ('n3', 'n4')`)).rows.length, 0);
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from conversations')).rows[0].n, before);
  // contato/chat/lead da mensagem vêm da conversa
  const m = (await db.query<Record<string, string>>(`select kommo_contact_id, kommo_chat_id, kommo_lead_id from conversation_messages where external_id = 'n2'`)).rows[0];
  assert.deepEqual(m, { kommo_contact_id: '500', kommo_chat_id: 'chat-4', kommo_lead_id: '2004' });
});

test('ids da API de outro espaço: nada é gravado (evita duplicar a conversa)', async () => {
  const c = await seedConversation('2006', '306', 'chat-6');
  await supa.rpc('kommo_ingest_message', {
    p_conversation_key: c.key, p_seller_id: null, p_client_name: 'Cliente', p_event_id: null,
    p_message: {
      kommo_message_id: 'webhook-x', kommo_chat_id: 'chat-6', kommo_talk_id: '306', kommo_lead_id: '2006', kommo_entity_type: 'lead',
      kommo_entity_id: '2006', direction: 'incoming', sender_type: 'client', message_text: 'oi', message_type: 'text',
      sent_at: new Date(T0 * 1000).toISOString(), timestamp_valid: true,
    },
  });
  TALK_MESSAGES['306'] = [client('outro-espaco-1', T0), sellerMsg('outro-espaco-2', T0 + 5, 11)];
  const { state } = await runSync('2006', ['306'], new Map([['306', c.id]]));
  assert.equal(state.totals.id_mismatch, 1);
  assert.equal((await rows(c.id)).length, 1);
});

test('8 e 9. token expirado (401), 402 e 403 suspendem o histórico; 404 pula só o talk', async () => {
  const c = await seedConversation('2007', '307', 'chat-7');
  TALK_MESSAGES['308'] = [client('e1', T0)];
  for (const [status, kind] of [[401, 'token_invalid'], [402, 'payment_required'], [403, 'forbidden']] as const) {
    TALK_STATUS['307'] = status;
    const { state } = await runSync('2007', ['307', '308'], new Map([['307', c.id], ['308', c.id]]));
    assert.deepEqual(state.blocked, { status, kind });
    assert.equal(state.totals.talks, 1, 'para no primeiro bloqueio, sem martelar a API');
  }
  TALK_STATUS['307'] = 404;
  const { state } = await runSync('2007', ['307', '308'], new Map([['307', c.id], ['308', c.id]]));
  assert.equal(state.blocked, null);
  assert.equal(state.totals.talk_not_found, 1);
  assert.equal(state.totals.inserted, 1);
});

test('fetchTalkMessages: erro HTTP vira KommoApiError com o status; 204 = conversa vazia', async () => {
  TALK_STATUS['309'] = 403;
  await assert.rejects(kommo.fetchTalkMessages('309'), (e: { status: number }) => e instanceof kommo.KommoApiError && e.status === 403);
  const empty = await kommo.fetchTalkMessages('310');
  assert.deepEqual(empty, { messages: [], pages: 1, truncated: false });
});

test('10. anexos sem texto entram com o tipo; nenhuma mensagem duplicada no banco', async () => {
  const c = await seedConversation('2011', '311', 'chat-11');
  TALK_MESSAGES['311'] = [
    { ...client('a1', T0), message_type: 'voice', text: '', attachment: { type: 'voice', link: 'https://x/a.ogg', file_name: 'a.ogg' } },
    { ...sellerMsg('a2', T0 + 5, 11), message_type: 'picture', text: 'segue a foto', attachment: { type: 'picture', link: 'https://x/b.jpg' } },
  ];
  await runSync('2011', ['311'], new Map([['311', c.id]]));
  assert.deepEqual((await rows(c.id)).map((x) => [x.external_id, x.message_type, x.message]), [
    ['a1', 'voice', ''],
    ['a2', 'picture', 'segue a foto'],
  ]);
});

async function placeholder(c: { id: string }, id: string, at: number, sender = 'seller', senderId: string | null = '11', direction = 'outgoing') {
  await supa.rpc('kommo_insert_event_placeholders', {
    p_messages: [{ conversation_id: c.id, kommo_message_id: id, direction, sender_type: sender, sender_id: senderId, sender_name: senderId ? 'Vendedor A' : null, sent_at: new Date(at * 1000).toISOString(), created_at_original: String(at), kommo_talk_id: (c as { talkId?: string }).talkId, source_event: { e: 1 } }],
  });
}

test('4. autor não identificado pela API não apaga o vendedor do marcador (created_by)', async () => {
  const c = await seedConversation('2013', '313', 'chat-13');
  await placeholder(c, 'u1', T0, 'seller', '11');
  await placeholder(c, 'u2', T0 + 5, 'seller', '22');
  TALK_MESSAGES['313'] = [
    { id: 'u1', type: 'outgoing', message_type: 'text', text: 'resposta 1', created_at: T0 }, // sem author
    { id: 'u2', type: 'outgoing', message_type: 'text', text: 'resposta 2', created_at: T0 + 5, author: { id: 'a', type: 'internal', name: 'X' } }, // internal sem user_id
  ];
  const { state } = await runSync('2013', ['313'], new Map([['313', c.id]]));
  assert.equal(state.totals.placeholders_filled, 2);
  assert.deepEqual((await rows(c.id)).map((x) => [x.external_id, x.sender, x.sender_id, x.message]), [
    ['u1', 'seller', '11', 'resposta 1'],
    ['u2', 'seller', '22', 'resposta 2'],
  ]);
  // marcador preenchido mantém o evento de origem e passa a ter o payload da API
  const r = (await db.query<{ source_event: unknown; src: string }>(`select source_event, raw_payload->>'_source' as src from conversation_messages where external_id = 'u1'`)).rows[0];
  assert.deepEqual(r.source_event, { e: 1 });
  assert.equal(r.src, 'talk_messages_api');
});

test('3 e 4. bot e outgoing sem autor (sem marcador) entram identificados como bot / autor não identificado', async () => {
  const c = await seedConversation('2014', '314', 'chat-14');
  TALK_MESSAGES['314'] = [
    { id: 'b1', type: 'outgoing', message_type: 'text', text: 'Olá, sou o bot', created_at: T0, author: { id: 'bot', type: 'bot', name: 'Salesbot' } },
    { id: 'b2', type: 'outgoing', message_type: 'text', text: 'mensagem', created_at: T0 + 5 },
  ];
  await runSync('2014', ['314'], new Map([['314', c.id]]));
  assert.deepEqual((await rows(c.id)).map((x) => [x.external_id, x.sender, x.sender_id]), [
    ['b1', 'bot', 'bot'],
    ['b2', 'system', null],
  ]);
  const name = (await db.query<{ sender_name: string }>(`select sender_name from conversation_messages where external_id = 'b2'`)).rows[0].sender_name;
  assert.equal(name, 'Autor não identificado');
});

test('mensagem real do webhook nunca é reescrita; conversa não tem occurred_at adiantado', async () => {
  const c = await seedConversation('2015', '315', 'chat-15');
  await db.query(`update conversations set occurred_at = '2026-01-01T00:00:00Z' where id = $1`, [c.id]);
  await supa.rpc('kommo_ingest_message', {
    p_conversation_key: c.key, p_seller_id: null, p_client_name: 'Cliente', p_event_id: null,
    p_message: {
      kommo_message_id: 'w1', kommo_chat_id: 'chat-15', kommo_talk_id: '315', kommo_lead_id: '2015', kommo_entity_type: 'lead',
      kommo_entity_id: '2015', direction: 'incoming', sender_type: 'client', message_text: 'webhook', message_type: 'text',
      sent_at: new Date(T0 * 1000).toISOString(), timestamp_valid: true, raw_payload: { from: 'webhook' },
    },
  });
  await db.query(`update conversations set occurred_at = '2026-01-01T00:00:00Z' where id = $1`, [c.id]);
  await placeholder(c, 'w2', T0 + 9000);
  // a API devolve w1 com outro texto (não pode sobrescrever) e a resposta do vendedor dias depois
  TALK_MESSAGES['315'] = [client('w1', T0, 'versão da API'), sellerMsg('w2', T0 + 9000, 11, 'follow-up')];
  // chamada direta à função também respeita a regra (corrida webhook × sync)
  const direct = await supa.rpc('kommo_fill_talk_messages', {
    p_conversation_id: c.id,
    p_messages: [{ kommo_message_id: 'w1', direction: 'incoming', sender_type: 'client', message_text: 'versão da API', message_type: 'text', sent_at: new Date(T0 * 1000).toISOString(), author_identified: true }],
  });
  assert.equal((direct.data as { kept: number }).kept, 1);
  await runSync('2015', ['315'], new Map([['315', c.id]]));
  const r = await rows(c.id);
  assert.deepEqual(r.map((x) => [x.external_id, x.message]), [['w1', 'webhook'], ['w2', 'follow-up']]);
  const occurred = (await db.query<{ o: Date }>('select occurred_at as o from conversations where id = $1', [c.id])).rows[0].o;
  assert.equal(new Date(occurred).toISOString(), '2026-01-01T00:00:00.000Z');
});

test('ids do webhook diferentes da API: incoming igual (±2s, mesmo texto) não é duplicado', async () => {
  const c = await seedConversation('2016', '316', 'chat-16');
  await supa.rpc('kommo_ingest_message', {
    p_conversation_key: c.key, p_seller_id: null, p_client_name: 'Cliente', p_event_id: null,
    p_message: {
      kommo_message_id: 'webhook-id', kommo_chat_id: 'chat-16', kommo_talk_id: '316', kommo_lead_id: '2016', kommo_entity_type: 'lead',
      kommo_entity_id: '2016', direction: 'incoming', sender_type: 'client', message_text: 'quero o 15 pro', message_type: 'text',
      sent_at: new Date((T0 - 100) * 1000).toISOString(), timestamp_valid: true,
    },
  });
  // A API devolve só a mensagem (de outro espaço de id) fora do intervalo real gravado? Aqui o intervalo
  // da API não contém a mensagem do webhook, então a proteção por id não dispara — a do texto ±2s sim.
  const res = await supa.rpc('kommo_fill_talk_messages', {
    p_conversation_id: c.id,
    p_messages: [{ kommo_message_id: 'api-id', direction: 'incoming', sender_type: 'client', message_text: 'quero o 15 pro', message_type: 'text', sent_at: new Date((T0 - 99) * 1000).toISOString(), author_identified: true }],
  });
  assert.equal((res.data as { webhook_duplicate: number }).webhook_duplicate, 1);
  assert.equal((await rows(c.id)).length, 1);
});

test('desligado por padrão: sem KOMMO_TALK_HISTORY=on não chama a API', async () => {
  talkHistoryFlag = '';
  try {
    requests.length = 0;
    const { state } = await runSync('2017', ['317'], new Map([['317', 'x']]));
    assert.equal(state.enabled, false);
    assert.equal(requests.length, 0);
  } finally {
    talkHistoryFlag = 'on';
  }
});

test('paginação: servidor que ignora `page` não gera 40 chamadas; limite de páginas marca truncado', async () => {
  const many: ApiMsg[] = [];
  for (let i = 0; i < 300; i++) many.push(client(`g${i}`, T0 + i));
  TALK_MESSAGES['318'] = many;
  IGNORES_PAGE.add('318');
  requests.length = 0;
  const r = await kommo.fetchTalkMessages('318');
  assert.equal(requests.length, 2);
  assert.equal(r.messages.length, 250);
  IGNORES_PAGE.delete('318');
  const t = await kommo.fetchTalkMessages('318', { maxPages: 1 });
  assert.equal(t.truncated, true);
  // exatamente 250: segunda página vem 204
  TALK_MESSAGES['319'] = many.slice(0, 250);
  const exact = await kommo.fetchTalkMessages('319');
  assert.deepEqual([exact.messages.length, exact.pages, exact.truncated], [250, 2, false]);
});
