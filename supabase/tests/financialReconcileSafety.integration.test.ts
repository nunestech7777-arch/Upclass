/**
 * Migração 0020 (conciliação segura) contra um Postgres real (PGlite, em memória): colunas novas
 * não mudam vendas existentes, alertas não se repetem, valores aceitos e acesso só de administrador.
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
let SALE = '';

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  `);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (f.startsWith('0020')) {
      // Venda já conciliada antes da 0020: nada nela pode mudar.
      await db.exec(`
        insert into sellers (name, external_id) values ('Vendedora', '8377');
        insert into products (name, code, category) values ('FONTE TURBO VOLTS 30W', 'P1', 'Acessórios');
        insert into sales (seller_id, product_id, quantity, amount, sold_at, external_id, revenue, cost, profit, financial_status)
        select s.id, p.id, 1, 70, '2026-10-20 19:21:00+00', '8734927-7936124-0', 70, 64.9, 5.1, 'ok' from sellers s, products p;
      `);
    }
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/create extension[^;]*;/gi, ''));
  }
  SALE = (await db.query<{ id: string }>('select id from sales limit 1')).rows[0].id;
});

test('0020: venda existente mantém valores; colunas novas nascem vazias/zeradas', async () => {
  const r = (await db.query<Record<string, unknown>>('select revenue, cost, profit, financial_status, financial_checked_at, financial_check_attempts from sales where id = $1', [SALE])).rows[0];
  assert.equal(Number(r.revenue), 70);
  assert.equal(Number(r.cost), 64.9);
  assert.equal(r.financial_status, 'ok');
  assert.equal(r.financial_checked_at, null);
  assert.equal(r.financial_check_attempts, 0);
});

test('0020: alerta com a mesma chave não se repete (insert ... on conflict do nothing)', async () => {
  const insert = `insert into financial_reconcile_alerts (kind, mp_order_id, external_id, sale_id, detail, dedupe_key, has_evidence)
    values ('retroactive_change', '8734927', '8734927-7936124-0', $1, 'custo mudou', 'retroactive_change|8734927-7936124-0|70|80|ok', false)
    on conflict (dedupe_key) do nothing`;
  await db.query(insert, [SALE]);
  await db.query(insert, [SALE]);
  const n = (await db.query<{ n: number }>('select count(*)::int as n from financial_reconcile_alerts')).rows[0].n;
  assert.equal(n, 1);
});

test('0020: só aceita tipos de alerta, situações e resultados de tentativa conhecidos', async () => {
  await assert.rejects(db.query(`insert into financial_reconcile_alerts (kind, mp_order_id, detail, dedupe_key) values ('outro', '1', 'x', 'k1')`));
  await assert.rejects(db.query(`update financial_reconcile_alerts set status = 'apagado'`));
  await assert.rejects(db.query(`insert into financial_reconcile_attempts (source, mp_order_id, outcome) values ('webhook', '1', 'talvez')`));
  await db.query(`insert into financial_reconcile_attempts (source, mp_order_id, outcome, detail) values ('webhook', '8734927', 'empty_history', null)`);
  await db.query(`insert into financial_reconcile_attempts (source, mp_order_id, outcome) values ('cron', '8734927', 'reconciled')`);
  const outcomes = (await db.query<{ outcome: string }>(`select outcome from financial_reconcile_attempts where mp_order_id = '8734927' order by created_at, outcome`)).rows.map((r) => r.outcome);
  assert.deepEqual(outcomes.sort(), ['empty_history', 'reconciled']);
});

test('0020: alertas e tentativas só para administrador (RLS com is_admin)', async () => {
  const policies = (await db.query<{ tablename: string; qual: string }>(
    `select tablename, qual from pg_policies where tablename in ('financial_reconcile_alerts', 'financial_reconcile_attempts')`
  )).rows;
  assert.ok(policies.length >= 3);
  for (const p of policies) assert.match(p.qual ?? '', /is_admin/);
  const rls = (await db.query<{ relname: string; relrowsecurity: boolean }>(
    `select relname, relrowsecurity from pg_class where relname in ('financial_reconcile_alerts', 'financial_reconcile_attempts')`
  )).rows;
  assert.ok(rls.every((r) => r.relrowsecurity));
});

test('0020: excluir a venda não apaga o alerta (sale_id vira nulo)', async () => {
  await db.query(`insert into financial_reconcile_alerts (kind, mp_order_id, sale_id, detail, dedupe_key) values ('model_swap', '8734927', $1, 'troca', 'k-del')`, [SALE]);
  await db.query('delete from sales where id = $1', [SALE]);
  const r = (await db.query<{ sale_id: string | null }>(`select sale_id from financial_reconcile_alerts where dedupe_key = 'k-del'`)).rows[0];
  assert.equal(r.sale_id, null);
});
