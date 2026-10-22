/**
 * Painel do Vendedor contra um Postgres real (PGlite, em memória): aplica todas as migrações e
 * confere papéis, RLS e isolamento entre vendedores — inclusive tentativas de acesso indevido.
 * Cada consulta roda como o papel `authenticated` com o `auth.uid()` da conta simulada.
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
const CAROL_USER = '00000000-0000-0000-0000-0000000000c1';
const JULY_USER = '00000000-0000-0000-0000-0000000000c2';
const STRANGER = '00000000-0000-0000-0000-0000000000ff';
let CAROL = '';
let JULY = '';

/** Executa `sql` como uma conta logada (papel authenticated + auth.uid()). */
async function as<T>(uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`set request.jwt.sub = '${uid}'; set role authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    -- O admin já existia antes da migração: precisa continuar administrador.
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
  // Privilégios padrão do Supabase para o papel authenticated (a RLS é quem restringe).
  await db.exec(`
    grant usage on schema public to authenticated;
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;
  `);
  await db.exec(`
    insert into auth.users values ('${CAROL_USER}', 'carol@loja.test'), ('${JULY_USER}', 'july@loja.test'), ('${STRANGER}', 'x@loja.test');
    insert into sellers (name, external_id, show_in_ranking) values ('CAROLINE', '40936', true), ('JULY', '26879', false);
    insert into products (name, code, category, price) values
      ('IPHONE 15 PRO MAX 256GB', 'P1', 'Aparelhos', 7000), ('CAPA MAGSAFE', 'P2', 'Acessórios', 150);
  `);
  CAROL = (await db.query<{ id: string }>(`select id from sellers where external_id = '40936'`)).rows[0].id;
  JULY = (await db.query<{ id: string }>(`select id from sellers where external_id = '26879'`)).rows[0].id;
  // Pedido 12345: Caroline vendeu 2 iPhones (uma linha, quantidade 2) e Julia a capa.
  // Mesmo pedido, item cancelado e item removido (versão antiga) da Caroline.
  await db.exec(`
    insert into sales (seller_id, product_id, quantity, amount, sold_at, external_id, cost, profit, revenue, customer_name)
    select '${CAROL}', id, 2, 14000, '2026-10-20 10:00:00+00', '12345-1-0', 9000, 5000, 13800, 'Cliente Secreto' from products where code = 'P1';
    insert into sales (seller_id, product_id, quantity, amount, sold_at, external_id, cost, profit)
    select '${JULY}', id, 1, 150, '2026-10-20 10:00:00+00', '12345-2-1', 40, 110 from products where code = 'P2';
    insert into sales (seller_id, product_id, quantity, amount, sold_at, external_id, item_status)
    select '${CAROL}', id, 1, 7000, '2026-10-19 15:00:00+00', '12300-1-0', 'cancelled' from products where code = 'P1';
    insert into sales (seller_id, product_id, quantity, amount, sold_at, external_id, item_status)
    select '${CAROL}', id, 1, 7000, '2026-10-19 16:00:00+00', '12301-1-0', 'removed' from products where code = 'P1';
    insert into user_access (user_id, role, seller_id, email) values
      ('${CAROL_USER}', 'seller', '${CAROL}', 'carol@loja.test'),
      ('${JULY_USER}', 'seller', '${JULY}', 'july@loja.test');
  `);
});

test('conta existente antes da migração vira administradora; o admin segue lendo tudo', async () => {
  const [me] = await as<{ role: string; enabled: boolean }>(ADMIN, 'select role, enabled from my_access()');
  assert.deepEqual(me, { role: 'admin', enabled: true });
  const rows = await as<{ n: number }>(ADMIN, 'select count(*)::int as n from sales');
  assert.equal(rows[0].n, 4);
  const cost = await as<{ cost: string }>(ADMIN, `select cost from sales where external_id = '12345-1-0'`);
  assert.equal(Number(cost[0].cost), 9000);
});

test('vendedor não lê NENHUMA tabela diretamente (custos, vendas, metas, vendedores)', async () => {
  for (const table of ['sales', 'products', 'sellers', 'seller_profit_goals', 'seller_device_goals', 'seller_weekly_goals', 'goals', 'user_access', 'admin_audit_log', 'financial_sync_runs', 'conversations']) {
    const rows = await as<{ n: number }>(CAROL_USER, `select count(*)::int as n from ${table}`);
    assert.equal(rows[0].n, 0, `vendedor leu ${table}`);
  }
});

test('vendedor não grava em tabelas nem altera o próprio papel/vínculo', async () => {
  await assert.rejects(as(CAROL_USER, `insert into seller_weekly_goals (seller_id, week_start, device_target) values ($1, '2026-10-19', 99)`, [CAROL]));
  await assert.rejects(as(CAROL_USER, `insert into user_access (user_id, role) values ($1, 'admin')`, [STRANGER]));
  // UPDATE/DELETE sem linha visível não afetam nada.
  await as(CAROL_USER, `update user_access set role = 'admin', seller_id = null where user_id = $1`, [CAROL_USER]);
  await as(CAROL_USER, `update sales set seller_id = $1`, [CAROL]);
  await as(CAROL_USER, `delete from sales`);
  const [row] = await as<{ role: string }>(ADMIN, `select role from user_access where user_id = $1`, [CAROL_USER]);
  assert.equal(row.role, 'seller');
  const [n] = await as<{ n: number }>(ADMIN, `select count(*)::int as n from sales where seller_id = $1`, [JULY]);
  assert.equal(n.n, 1);
});

test('Minhas Vendas: só os itens do vendedor do item, sem custo/lucro/cliente e sem itens removidos', async () => {
  const carol = await as<Record<string, unknown>>(CAROL_USER, `select * from seller_portal_sales('2026-10-19', '2026-10-25')`);
  assert.deepEqual(carol.map((r) => [r.mp_order_id, r.product_name, r.quantity, r.item_status]), [
    ['12345', 'IPHONE 15 PRO MAX 256GB', 2, 'active'],
    ['12300', 'IPHONE 15 PRO MAX 256GB', 1, 'cancelled'],
  ]);
  for (const key of Object.keys(carol[0])) assert.ok(!/cost|profit|revenue|customer|seller/i.test(key), `campo restrito: ${key}`);
  const july = await as<Record<string, unknown>>(JULY_USER, `select * from seller_portal_sales('2026-10-19', '2026-10-25')`);
  assert.deepEqual(july.map((r) => r.product_name), ['CAPA MAGSAFE']);
});

test('funções do vendedor não aceitam outro vendedor: não há parâmetro de vendedor e sem vínculo nada sai', async () => {
  await assert.rejects(as(STRANGER, `select * from seller_portal_sales('2026-10-19', '2026-10-25')`), /não autorizado/);
  await assert.rejects(as(ADMIN, `select * from seller_portal_sales('2026-10-19', '2026-10-25')`), /não autorizado/);
  const [none] = await as<{ n: number }>(STRANGER, 'select count(*)::int as n from my_access()');
  assert.equal(none.n, 0);
  const [stranger] = await as<{ n: number }>(STRANGER, 'select count(*)::int as n from sales');
  assert.equal(stranger.n, 0);
  await assert.rejects(as(CAROL_USER, `select * from seller_portal_sales('2025-01-01', '2026-10-25')`), /período inválido/);
});

test('acesso desativado bloqueia na hora; ocultar do ranking não bloqueia', async () => {
  await db.exec(`update user_access set enabled = false where user_id = '${JULY_USER}'`);
  await assert.rejects(as(JULY_USER, `select * from seller_portal_sales('2026-10-19', '2026-10-25')`), /não autorizado/);
  const [me] = await as<{ enabled: boolean }>(JULY_USER, 'select enabled from my_access()');
  assert.equal(me.enabled, false);
  await db.exec(`update user_access set enabled = true where user_id = '${JULY_USER}'`);
  // JULY está oculta do ranking (show_in_ranking = false) e segue com acesso.
  const rows = await as(JULY_USER, `select * from seller_portal_sales('2026-10-19', '2026-10-25')`);
  assert.equal(rows.length, 1);
  const [vis] = await as<{ show_in_ranking: boolean }>(ADMIN, `select show_in_ranking from sellers where id = $1`, [JULY]);
  assert.equal(vis.show_in_ranking, false);
});

test('vínculo 1:1: uma conta por vendedor e um vendedor por conta; admin sem vendedor', async () => {
  await assert.rejects(db.query(`insert into user_access (user_id, role, seller_id) values ($1, 'seller', $2)`, [STRANGER, CAROL]));
  await assert.rejects(db.query(`update user_access set seller_id = $1 where user_id = $2`, [JULY, CAROL_USER]));
  await assert.rejects(db.query(`insert into user_access (user_id, role, seller_id) values ($1, 'admin', $2)`, [STRANGER, CAROL]));
  await assert.rejects(db.query(`insert into user_access (user_id, role) values ($1, 'seller')`, [STRANGER]));
});

test('metas semanais: só segunda-feira, > 0, uma por vendedor/semana, histórico e auditoria; vendedor vê só a sua', async () => {
  await as(ADMIN, `insert into seller_weekly_goals (seller_id, week_start, device_target) values ($1, '2026-10-12', 15), ($1, '2026-10-19', 20), ($2, '2026-10-19', 10)`, [CAROL, JULY]);
  await assert.rejects(as(ADMIN, `insert into seller_weekly_goals (seller_id, week_start, device_target) values ($1, '2026-10-21', 5)`, [CAROL]));
  await assert.rejects(as(ADMIN, `insert into seller_weekly_goals (seller_id, week_start, device_target) values ($1, '2026-10-26', 0)`, [CAROL]));
  await assert.rejects(as(ADMIN, `insert into seller_weekly_goals (seller_id, week_start, device_target) values ($1, '2026-10-19', 30)`, [CAROL]));
  // Upsert que vira UPDATE (é o que a tela de metas faz): só uma linha de auditoria, de update.
  await as(ADMIN, `insert into seller_weekly_goals (seller_id, week_start, device_target) values ($1, '2026-10-19', 21)
                   on conflict (seller_id, week_start) do update set device_target = excluded.device_target`, [CAROL]);
  await as(ADMIN, `update seller_weekly_goals set device_target = 22, created_by_email = 'forjado' where seller_id = $1 and week_start = '2026-10-19'`, [CAROL]);

  const carol = await as<{ week_start: string; device_target: number }>(CAROL_USER, `select week_start::text, device_target from seller_portal_weekly_goals('2026-10-12', '2026-10-25')`);
  assert.deepEqual(carol, [
    { week_start: '2026-10-12', device_target: 15 },
    { week_start: '2026-10-19', device_target: 22 },
  ]);
  const july = await as<{ device_target: number }>(JULY_USER, `select device_target from seller_portal_weekly_goals('2026-10-19', '2026-10-25')`);
  assert.deepEqual(july.map((r) => r.device_target), [10]);

  const [goal] = await as<{ created_by_email: string; updated_by_email: string }>(ADMIN, `select created_by_email, updated_by_email from seller_weekly_goals where seller_id = $1 and week_start = '2026-10-19'`, [CAROL]);
  assert.deepEqual(goal, { created_by_email: 'dono@loja.test', updated_by_email: 'dono@loja.test' });
  const audit = await as<{ action: string; details: { from: number | null; to: number } }>(ADMIN, `select action, details from admin_audit_log where seller_id = $1 order by id`, [CAROL]);
  assert.deepEqual(audit.map((a) => a.action), ['weekly_goal_insert', 'weekly_goal_insert', 'weekly_goal_update', 'weekly_goal_update']);
  assert.deepEqual([audit[2].details.from, audit[2].details.to], [20, 21]);
  assert.deepEqual([audit[3].details.from, audit[3].details.to], [21, 22]);
  // Vendedor não lê a auditoria.
  const [n] = await as<{ n: number }>(CAROL_USER, 'select count(*)::int as n from admin_audit_log');
  assert.equal(n.n, 0);
});

test('nenhuma política ampla "qualquer logado" sobrou no schema public', async () => {
  const { rows } = await db.query<{ tablename: string; policyname: string; qual: string | null }>(
    `select tablename, policyname, qual from pg_policies where schemaname = 'public'`
  );
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(!['authenticated_full_access', 'authenticated_read'].includes(r.policyname), `${r.tablename}.${r.policyname}`);
    assert.match(r.qual ?? '', /is_admin/, `${r.tablename}.${r.policyname} sem is_admin`);
  }
  // Toda tabela do schema public tem RLS ligada.
  const { rows: noRls } = await db.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`
  );
  assert.deepEqual(noRls, []);
});

test('reaplicar a migração 0017 não promove a admin conta sem vínculo (auditoria M1)', async () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, '0017_seller_portal_access.sql'), 'utf8');
  await db.exec(sql);
  const [none] = await as<{ n: number }>(STRANGER, 'select count(*)::int as n from my_access()');
  assert.equal(none.n, 0);
  const [leak] = await as<{ n: number }>(STRANGER, 'select count(*)::int as n from sales');
  assert.equal(leak.n, 0);
  const [carol] = await as<{ role: string }>(CAROL_USER, 'select role from my_access()');
  assert.equal(carol.role, 'seller');
});

test('0018 giro: só admin lê os movimentos; só a sincronização grava, de forma atômica e sem plano velho', async () => {
  const mov = JSON.stringify([{ product_external_id: 'p1', kind: 'baseline', quantity: 10, quantity_after: 10, entry_date: null, name: 'PELICULA', product_type: 'ACESSORIOS' }]);
  const lv = JSON.stringify([{ product_external_id: 'p1', quantity: 10, name: 'PELICULA', product_type: 'ACESSORIOS' }]);
  // Conta logada (inclusive admin) não chama a função de gravação.
  await assert.rejects(as(ADMIN, `select record_stock_movements($1::jsonb, $2::jsonb, '{}', null, now(), '[]')`, [mov, lv]));
  const [first] = (await db.query<{ n: number }>(`select record_stock_movements($1::jsonb, $2::jsonb, '{}', null, now(), '[{"line_key":"9-p1","quantity":1}]') as n`, [mov, lv])).rows;
  assert.equal(first.n, 1);
  // Segunda execução montada sobre o MESMO estado (tabela vazia) é descartada: nada duplica.
  const [stale] = (await db.query<{ n: number }>(`select record_stock_movements($1::jsonb, $2::jsonb, '{}', null, now(), '[{"line_key":"9-p1","quantity":1}]') as n`, [mov, lv])).rows;
  assert.equal(stale.n, -1);
  const [admin] = await as<{ n: number }>(ADMIN, 'select count(*)::int as n from stock_movements');
  assert.equal(admin.n, 1);
  const [seller] = await as<{ n: number }>(CAROL_USER, 'select count(*)::int as n from stock_movements');
  assert.equal(seller.n, 0);
  const [levels] = await as<{ n: number }>(CAROL_USER, 'select count(*)::int as n from stock_levels');
  assert.equal(levels.n, 0);
  const [seen] = await as<{ n: number }>(ADMIN, 'select count(*)::int as n from stock_cancellations_seen');
  assert.equal(seen.n, 1);
  await assert.rejects(as(ADMIN, `insert into stock_movements (product_external_id, kind, quantity, quantity_after) values ('x', 'exit', 1, 0)`));
  // Entrada exige data; demais tipos não têm data.
  await assert.rejects(db.query(`insert into stock_movements (product_external_id, kind, quantity, quantity_after) values ('x', 'entry', 1, 1)`));
  await assert.rejects(db.query(`insert into stock_movements (product_external_id, kind, quantity, quantity_after, entry_date) values ('x', 'return', 1, 1, '2026-10-21')`));
});
