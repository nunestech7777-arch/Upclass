/**
 * Migração 0021 (atendimentos por usuário do Kommo) contra um Postgres real (PGlite, em memória):
 * regra de autoria, limites do período, conversa com dois atendentes e acesso só de administrador.
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
const db = new PGlite();
const ADMIN = '00000000-0000-0000-0000-00000000000a';
const SELLER_USER = '00000000-0000-0000-0000-0000000000c1';

async function as<T>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set request.jwt.sub = '${uid}'; set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

const COUNT = `select kommo_user_id, conversations::int as n from public.kommo_attended_conversations($1, $2) order by 1`;
// Outubro/2026 na loja (UTC−3): [01/10 00:00, 01/11 00:00).
const OCT = ['2026-10-01T03:00:00Z', '2026-11-01T03:00:00Z'];

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    insert into auth.users values ('${ADMIN}', 'dono@loja.test');
    create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on all functions in schema auth to authenticated;
  `);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/create extension[^;]*;/gi, ''));
  }
  await db.exec(`
    grant usage on schema public to authenticated;
    grant all on all tables in schema public to authenticated;
    insert into auth.users values ('${SELLER_USER}', 'carol@loja.test');
  `);
  // Conversas: c1 atendida por A e B; c2 só por A (duas mensagens); c3 com Salesbot, resposta pelo
  // aparelho e cliente; c4 com resposta de A fora do período (antes e no limite final).
  const convs = (await db.query<{ id: string }>(`
    insert into conversations (client_name, occurred_at) values ('c1', now()), ('c2', now()), ('c3', now()), ('c4', now()) returning id
  `)).rows.map((r) => r.id);
  const [c1, c2, c3, c4] = convs;
  await db.exec(`
    insert into conversation_messages (conversation_id, sender, sender_id, sender_name, message, sent_at) values
      ('${c1}', 'client', null, 'Cliente', 'oi', '2026-10-05T12:00:00Z'),
      ('${c1}', 'seller', 'kA', 'A', 'olá', '2026-10-05T12:01:00Z'),
      ('${c1}', 'seller', 'kB', 'B', 'olá', '2026-10-05T12:02:00Z'),
      ('${c2}', 'seller', 'kA', 'A', 'x', '2026-10-06T12:00:00Z'),
      ('${c2}', 'seller', 'kA', 'A', 'y', '2026-10-06T12:05:00Z'),
      ('${c3}', 'bot', null, 'Salesbot', 'menu', '2026-10-07T12:00:00Z'),
      ('${c3}', 'seller', null, null, 'pelo aparelho', '2026-10-07T12:01:00Z'),
      ('${c4}', 'seller', 'kA', 'A', 'antes', '2026-10-01T02:59:59Z'),
      ('${c4}', 'seller', 'kA', 'A', 'no fim', '2026-11-01T03:00:00Z');
  `);
});

test('0021: conversa distinta por autor; dois atendentes contam para os dois; bot e envio sem autor não contam', async () => {
  const rows = (await db.query<{ kommo_user_id: string; n: number }>(COUNT, OCT)).rows;
  assert.deepEqual(rows, [
    { kommo_user_id: 'kA', n: 2 },
    { kommo_user_id: 'kB', n: 1 },
  ]);
});

test('0021: limites do período no fuso da loja (início inclusivo, fim exclusivo)', async () => {
  const sept30 = (await db.query<{ kommo_user_id: string; n: number }>(COUNT, ['2026-09-30T03:00:00Z', '2026-10-01T03:00:00Z'])).rows;
  assert.deepEqual(sept30, [{ kommo_user_id: 'kA', n: 1 }]);
  const nov1 = (await db.query<{ kommo_user_id: string; n: number }>(COUNT, ['2026-11-01T03:00:00Z', '2026-11-02T03:00:00Z'])).rows;
  assert.deepEqual(nov1, [{ kommo_user_id: 'kA', n: 1 }]);
});

test('0021: administrador vê as contagens; vendedor e conta sem papel não veem nada (RLS de quem chama)', async () => {
  await db.exec(`insert into public.sellers (name, external_id) values ('CAROLINE', '40936')`);
  await db.exec(`insert into public.user_access (user_id, role, seller_id) select '${SELLER_USER}', 'seller', id from public.sellers where external_id = '40936'`);
  const admin = await as<{ kommo_user_id: string; n: number }>(ADMIN, COUNT, OCT);
  assert.equal(admin.length, 2);
  const sellerRows = await as<{ kommo_user_id: string; n: number }>(SELLER_USER, COUNT, OCT);
  assert.deepEqual(sellerRows, []);
});

test('0021: índice parcial das mensagens humanas com autor (evita ler a tabela inteira)', async () => {
  const idx = (await db.query<{ indexdef: string }>(
    `select indexdef from pg_indexes where indexname = 'idx_conversation_messages_human_author_sent'`
  )).rows[0];
  assert.ok(idx, 'índice criado');
  assert.match(idx.indexdef, /\(sent_at\) INCLUDE \(sender_id, conversation_id\)/);
  assert.match(idx.indexdef, /WHERE \(\(sender = 'seller'::text\) AND \(sender_id IS NOT NULL\)\)/);
});

test('0021: função não é executável por anon e não é SECURITY DEFINER', async () => {
  const fn = (await db.query<{ prosecdef: boolean; acl: string }>(
    `select prosecdef, proacl::text as acl from pg_proc where proname = 'kommo_attended_conversations'`
  )).rows[0];
  assert.equal(fn.prosecdef, false);
  assert.doesNotMatch(fn.acl, /(^|,|\{)anon=/);
  assert.doesNotMatch(fn.acl, /(^|,|\{)=X/, 'sem execução para PUBLIC');
});
