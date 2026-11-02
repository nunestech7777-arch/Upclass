// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwrStore } from './swrStore.ts';
import { AUTO_REFRESH_MS, HISTORICAL_TTL_MS, includesToday, periodCacheKey, periodTtlMs, TODAY_TTL_MS } from './cachePolicy.ts';

const TTL = 120_000;

function setup() {
  let clock = 1_000_000;
  const store = createSwrStore<string>(() => clock);
  let calls = 0;
  const loader = (value: string) => () => {
    calls += 1;
    return Promise.resolve(value);
  };
  return { store, loader, advance: (ms: number) => (clock += ms), calls: () => calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('primeiro acesso sem cache: busca e guarda', async () => {
  const { store, loader, calls } = setup();
  assert.equal(store.peek('k'), undefined);
  assert.equal(await store.load('k', loader('v1'), { ttlMs: TTL }), 'v1');
  assert.equal(store.peek('k')?.data, 'v1');
  assert.equal(calls(), 1);
});

test('segundo acesso / retorno imediato com cache válido: não busca de novo', async () => {
  const { store, loader, advance, calls } = setup();
  await store.load('k', loader('v1'), { ttlMs: TTL });
  advance(30_000);
  assert.equal(store.isFresh('k', TTL), true);
  assert.equal(await store.load('k', loader('v2'), { ttlMs: TTL }), 'v1');
  assert.equal(calls(), 1);
});

test('retorno depois do prazo: mostra o valor antigo na hora e atualiza em segundo plano', async () => {
  const { store, loader, advance, calls } = setup();
  await store.load('k', loader('v1'), { ttlMs: TTL });
  advance(TTL + 1);
  assert.equal(store.isFresh('k', TTL), false);
  const pending = store.load('k', loader('v2'), { ttlMs: TTL });
  // Enquanto atualiza, a tela continua com o valor anterior.
  assert.equal(store.peek('k')?.data, 'v1');
  assert.ok(store.peek('k')?.inflight);
  assert.equal(await pending, 'v2');
  assert.equal(store.peek('k')?.data, 'v2');
  assert.equal(calls(), 2);
});

test('requisições simultâneas da mesma chave usam uma busca só', async () => {
  const { store, loader, calls } = setup();
  const [a, b, c] = await Promise.all([
    store.load('k', loader('v1'), { ttlMs: TTL }),
    store.load('k', loader('outro'), { ttlMs: TTL }),
    store.load('k', loader('outro'), { ttlMs: TTL, force: true }),
  ]);
  assert.deepEqual([a, b, c], ['v1', 'v1', 'v1']);
  assert.equal(calls(), 1);
});

test('atualização manual (force) busca mesmo com cache válido', async () => {
  const { store, loader, calls } = setup();
  await store.load('k', loader('v1'), { ttlMs: TTL });
  assert.equal(await store.load('k', loader('v2'), { ttlMs: TTL, force: true }), 'v2');
  assert.equal(calls(), 2);
});

test('falha de rede na atualização mantém os dados anteriores e registra o erro', async () => {
  const { store, loader, advance } = setup();
  await store.load('k', loader('v1'), { ttlMs: TTL });
  const at = store.peek('k')?.at;
  advance(TTL + 1);
  await assert.rejects(store.load('k', () => Promise.reject(new Error('sem rede')), { ttlMs: TTL }));
  assert.equal(store.peek('k')?.data, 'v1');
  assert.equal(store.peek('k')?.at, at, 'horário continua o dos dados antigos');
  assert.equal(store.peek('k')?.error, 'sem rede');
  // Nova tentativa que funciona limpa o erro.
  await store.load('k', loader('v2'), { ttlMs: TTL });
  assert.equal(store.peek('k')?.error, undefined);
});

test('logout / troca de conta: clear apaga tudo e descarta resposta de busca antiga', async () => {
  const { store } = setup();
  let resolveOld!: (v: string) => void;
  const old = store.load('contaA|k', () => new Promise<string>((r) => (resolveOld = r)), { ttlMs: TTL });
  store.clear();
  resolveOld('dados da conta A');
  await old;
  assert.equal(store.peek('contaA|k'), undefined, 'resposta de antes do logout não volta ao cache');
});

test('invalidate (vínculo mudou, dado histórico corrigido) força nova busca na próxima visita', async () => {
  const { store, loader, calls } = setup();
  await store.load('k', loader('v1'), { ttlMs: HISTORICAL_TTL_MS });
  store.invalidate();
  assert.equal(store.isFresh('k', HISTORICAL_TTL_MS), false);
  assert.equal(store.peek('k')?.data, 'v1', 'continua exibível até chegar o novo');
  assert.equal(await store.load('k', loader('v2'), { ttlMs: HISTORICAL_TTL_MS }), 'v2');
  assert.equal(calls(), 2);
});

test('invalidação durante uma busca em andamento: o resultado fica marcado para buscar de novo', async () => {
  const { store } = setup();
  let resolve!: (v: string) => void;
  const pending = store.load('k', () => new Promise<string>((r) => (resolve = r)), { ttlMs: TTL });
  store.invalidate();
  resolve('com vínculo antigo');
  await pending;
  assert.equal(store.peek('k')?.data, 'com vínculo antigo');
  assert.equal(store.isFresh('k', TTL), false);
});

test('set complementa o valor (responsáveis do Kommo) sem mudar o horário e avisa os inscritos', async () => {
  const { store, loader, advance } = setup();
  await store.load('k', loader('parcial'), { ttlMs: TTL });
  const at = store.peek('k')?.at;
  let notified = 0;
  const off = store.subscribe('k', () => (notified += 1));
  advance(5_000);
  store.set('k', 'completo');
  assert.equal(store.peek('k')?.data, 'completo');
  assert.equal(store.peek('k')?.at, at);
  assert.equal(notified, 1);
  off();
  store.set('k', 'outro');
  assert.equal(notified, 1);
});

test('limite de entradas descarta os períodos mais antigos', async () => {
  let clock = 0;
  const store = createSwrStore<number>(() => clock, 3);
  for (let i = 0; i < 5; i++) {
    clock += 1;
    await store.load(`k${i}`, () => Promise.resolve(i), { ttlMs: TTL });
  }
  assert.equal(store.peek('k0'), undefined);
  assert.equal(store.peek('k1'), undefined);
  assert.equal(store.peek('k4')?.data, 4);
});

test('clear avisa os inscritos depois (seguro durante a renderização)', async () => {
  const { store, loader } = setup();
  await store.load('k', loader('v1'), { ttlMs: TTL });
  let notified = 0;
  store.subscribe('k', () => (notified += 1));
  store.clear();
  assert.equal(notified, 0);
  await flush();
  assert.equal(notified, 1);
});

test('política: período com hoje vale 2 min; só dias passados vale 30 min', () => {
  assert.equal(includesToday({ from: '2026-10-26', to: '2026-11-01' }, '2026-11-01'), true);
  assert.equal(includesToday({ from: '2026-10-28', to: '2026-10-28' }, '2026-11-01'), false);
  assert.equal(periodTtlMs({ from: '2026-11-01', to: '2026-11-01' }, '2026-11-01'), TODAY_TTL_MS);
  assert.equal(periodTtlMs({ from: '2026-10-28', to: '2026-10-28' }, '2026-11-01'), HISTORICAL_TTL_MS);
  assert.ok(TODAY_TTL_MS >= 60_000 && TODAY_TTL_MS <= 180_000);
  assert.ok(HISTORICAL_TTL_MS >= 15 * 60_000 && HISTORICAL_TTL_MS <= 60 * 60_000);
});

test('chave separa conta/papel, período e canal; atendente não entra (filtro aplicado em memória)', () => {
  const week = { from: '2026-10-26', to: '2026-11-01' };
  const today = '2026-11-01';
  const base = periodCacheKey('userA:admin', { range: week, channel: 'all' }, today);
  assert.notEqual(base, periodCacheKey('userB:admin', { range: week, channel: 'all' }, today), 'outra conta');
  assert.notEqual(base, periodCacheKey('userA:seller', { range: week, channel: 'all' }, today), 'outro papel');
  assert.notEqual(base, periodCacheKey('userA:admin', { range: { from: '2026-10-28', to: '2026-10-28' }, channel: 'all' }, today), 'outro período');
  assert.notEqual(base, periodCacheKey('userA:admin', { range: week, channel: 'instagram' }, today), 'outro canal');
});

test('virada do dia: o período que deixou de incluir hoje ganha outra chave e é buscado completo', () => {
  const day = { from: '2026-10-31', to: '2026-10-31' };
  const at2350 = periodCacheKey('userA:admin', { range: day, channel: 'all' }, '2026-10-31');
  const at0005 = periodCacheKey('userA:admin', { range: day, channel: 'all' }, '2026-11-01');
  assert.notEqual(at2350, at0005);
  assert.equal(periodTtlMs(day, '2026-11-01'), HISTORICAL_TTL_MS);
});

test('atualização automática: intervalo maior que o prazo de hoje (cada ciclo acha o dado vencido)', () => {
  assert.ok(AUTO_REFRESH_MS > TODAY_TTL_MS);
  assert.ok(AUTO_REFRESH_MS <= 3 * 60_000);
});
