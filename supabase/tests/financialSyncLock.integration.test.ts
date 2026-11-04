/**
 * Migração 0022 (trava compartilhada da conciliação) contra um Postgres real (PGlite, em memória):
 * uma execução por vez, prazo vencido libera, só o dono libera e só o service_role usa a trava.
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
});

const tryLock = async (holder: string, ttl = 180) =>
  (await db.query<{ ok: boolean }>('select public.try_financial_sync_lock($1, $2) as ok', [holder, ttl])).rows[0].ok;
const release = (holder: string) => db.query('select public.release_financial_sync_lock($1)', [holder]);
const holder = async () => (await db.query<{ holder: string | null }>('select holder from financial_sync_lock where id = 1')).rows[0].holder;

test('0022: uma linha, livre ao criar', async () => {
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from financial_sync_lock');
  assert.equal(rows[0].n, 1);
  assert.equal(await holder(), null);
});

test('0022: uma execução por vez; o dono renova; outro dono espera', async () => {
  assert.equal(await tryLock('button#1'), true);
  assert.equal(await tryLock('cron#1'), false);
  assert.equal(await tryLock('button#1'), true, 'mesmo dono');
  await release('cron#1');
  assert.equal(await holder(), 'button#1', 'só o dono libera');
  await release('button#1');
  assert.equal(await holder(), null);
  assert.equal(await tryLock('cron#1'), true);
  await release('cron#1');
});

test('0022: trava vencida (execução que caiu) é tomada', async () => {
  assert.equal(await tryLock('button#morto', 60), true);
  await db.exec(`update financial_sync_lock set expires_at = now() - interval '1 second' where id = 1`);
  assert.equal(await tryLock('cron#2'), true);
  await release('cron#2');
});

test('0022: parâmetros inválidos são recusados', async () => {
  await assert.rejects(tryLock('', 60));
  await assert.rejects(tryLock('x', 0));
  await assert.rejects(tryLock('x', 901));
});

test('0022: anon e authenticated não usam a trava nem leem a tabela', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query(`select public.try_financial_sync_lock('intruso', 60)`), /permission denied/);
      await assert.rejects(db.query(`select public.release_financial_sync_lock('intruso')`), /permission denied/);
      await assert.rejects(db.query('select * from financial_sync_lock'), /permission denied/);
    } finally {
      await db.exec('reset role');
    }
  }
  assert.equal(await holder(), null);
});

test('0022: service_role usa a trava', async () => {
  await db.exec('set role service_role');
  try {
    assert.equal((await db.query<{ ok: boolean }>(`select public.try_financial_sync_lock('cron#3', 60) as ok`)).rows[0].ok, true);
    await db.query(`select public.release_financial_sync_lock('cron#3')`);
  } finally {
    await db.exec('reset role');
  }
  assert.equal(await holder(), null);
});

test('0022: migração pode rodar de novo sem erro nem linha duplicada', async () => {
  await db.exec(readFileSync(join(MIGRATIONS_DIR, '0022_financial_sync_lock.sql'), 'utf8'));
  const { rows } = await db.query<{ n: number }>('select count(*)::int as n from financial_sync_lock');
  assert.equal(rows[0].n, 1);
});
