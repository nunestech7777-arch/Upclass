/**
 * Migração do módulo financeiro contra um Postgres real (PGlite, em memória): aplica todas as
 * migrações do projeto sobre uma linha de venda legada e confere campos derivados e restrições.
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
let SELLER = '';
let PRODUCT = '';

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  `);
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (f.startsWith('0013')) {
      // Venda legada, gravada antes do módulo financeiro (horário da loja guardado como UTC).
      await db.exec(`
        insert into sellers (name, external_id) values ('Vendedora', '40936');
        insert into products (name, code, category) values ('IPHONE 15', 'P1', 'Aparelhos');
        insert into sales (seller_id, product_id, quantity, amount, sold_at, external_id)
        select s.id, p.id, 1, 3656, '2026-09-30 21:15:00+00', '8112249-10964123-4' from sellers s, products p;
      `);
    }
    if (f.startsWith('0015')) {
      // Meta de aparelhos já cadastrada antes da meta de acessórios: precisa sobreviver intacta.
      await db.exec(`insert into seller_device_goals (seller_id, month, device_target) select id, '2026-10-01', 20 from sellers limit 1;`);
    }
    await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/create extension[^;]*;/gi, ''));
  }
  SELLER = (await db.query<{ id: string }>('select id from sellers limit 1')).rows[0].id;
  PRODUCT = (await db.query<{ id: string }>('select id from products limit 1')).rows[0].id;
});

test('venda legada recebe data comercial e pedido sem mudar valor nem horário', async () => {
  const { rows } = await db.query<Record<string, unknown>>(
    `select sold_date::text, mp_order_id, item_status, financial_status, amount::float8 as amount, cost from sales`
  );
  assert.deepEqual(rows[0], {
    sold_date: '2026-09-30',
    mp_order_id: '8112249',
    item_status: 'active',
    financial_status: 'pending',
    amount: 3656,
    cost: null,
  });
});

test('nova venda do webhook ganha sold_date e mp_order_id pelo trigger', async () => {
  await db.query(
    `insert into sales (seller_id, product_id, quantity, amount, sold_at, external_id)
     values ($1, $2, 1, 100, '2026-10-01 23:30:00+00', '8173392-149566-0')`,
    [SELLER, PRODUCT]
  );
  const { rows } = await db.query<{ sold_date: string; mp_order_id: string }>(
    `select sold_date::text, mp_order_id from sales where external_id = '8173392-149566-0'`
  );
  // 23:30 no horário da loja continua no dia 01 (não é deslocado para o dia seguinte).
  assert.deepEqual(rows[0], { sold_date: '2026-10-01', mp_order_id: '8173392' });
});

test('situação e status financeiro só aceitam valores conhecidos', async () => {
  await assert.rejects(db.query(`update sales set item_status = 'deleted'`));
  await assert.rejects(db.query(`update sales set financial_status = 'estimado'`));
});

test('meta de lucro: uma por vendedor/mês, valores não negativos e pior cenário ≤ meta', async () => {
  await db.query(
    `insert into seller_profit_goals (seller_id, month, profit_target, worst_case_target) values ($1, '2026-10-01', 100000, 90000)`,
    [SELLER]
  );
  await assert.rejects(
    db.query(`insert into seller_profit_goals (seller_id, month, profit_target) values ($1, '2026-10-01', 1)`, [SELLER]),
    /duplicate key/
  );
  await assert.rejects(
    db.query(`insert into seller_profit_goals (seller_id, month, profit_target) values ($1, '2026-11-01', -1)`, [SELLER])
  );
  await assert.rejects(
    db.query(
      `insert into seller_profit_goals (seller_id, month, profit_target, worst_case_target) values ($1, '2026-12-01', 100, 200)`,
      [SELLER]
    )
  );
  await assert.rejects(
    db.query(`insert into seller_profit_goals (seller_id, month, profit_target) values ($1, '2026-11-15', 100)`, [SELLER])
  );
  // Meta ausente é diferente de zero: ambos os campos podem ficar nulos.
  await db.query(`insert into seller_profit_goals (seller_id, month) values ($1, '2027-01-01')`, [SELLER]);
});

test('migração 0015: meta de acessórios é coluna nova, nula nas linhas existentes, e independente da de aparelhos', async () => {
  const legacy = await db.query<{ device_target: number; accessory_target: number | null }>(
    `select device_target, accessory_target from seller_device_goals where month = '2026-10-01'`
  );
  assert.deepEqual(legacy.rows[0], { device_target: 20, accessory_target: null });

  await db.query(`update seller_device_goals set accessory_target = 30 where month = '2026-10-01'`);
  const both = await db.query<{ device_target: number; accessory_target: number }>(`select device_target, accessory_target from seller_device_goals where month = '2026-10-01'`);
  assert.deepEqual(both.rows[0], { device_target: 20, accessory_target: 30 });

  await assert.rejects(db.query(`update seller_device_goals set accessory_target = -1`));
  // uma meta pode existir sem a outra
  await db.query(`insert into seller_device_goals (seller_id, month, accessory_target) values ($1, '2026-11-01', 15)`, [SELLER]);
  const onlyAccessory = await db.query<{ device_target: number | null; accessory_target: number }>(
    `select device_target, accessory_target from seller_device_goals where month = '2026-11-01'`
  );
  assert.deepEqual(onlyAccessory.rows[0], { device_target: null, accessory_target: 15 });
});
