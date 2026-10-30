// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKommoUserOptions, matchesSearch, missingUserIds, normalizeName } from './kommoUsers.ts';
import { toKommoUserRows, usersAreStale } from '../../../supabase/functions/_shared/kommoUsers.ts';

const SYNC = '2026-10-29T18:02:27.000Z';
const OLD = '2026-08-09T20:45:50.000Z';
const users = [
  { id: '15815704', name: 'CAROLINE', synced_at: SYNC },
  { id: '13377356', name: 'YASMIN SILVA', synced_at: SYNC },
  { id: '15131108', name: 'JULY (ACESSÓRIOS)', synced_at: OLD },
];
const sellers = [
  { id: 's-caroline', name: 'CAROLINE', kommo_user_id: null },
  { id: 's-yasmim', name: 'YASMIM', kommo_user_id: '13377356' },
  { id: 's-july', name: 'JULY', kommo_user_id: '15131108' },
];

test('opções: usuário já vinculado a outro vendedor aparece como ocupado; o próprio vínculo não', () => {
  const forCaroline = buildKommoUserOptions(users, sellers, 's-caroline');
  assert.deepEqual(
    forCaroline.map((o) => [o.label, o.takenBy]),
    [
      ['CAROLINE', null],
      ['JULY (ACESSÓRIOS)', 'JULY'],
      ['YASMIN SILVA', 'YASMIM'],
    ]
  );
  const forYasmim = buildKommoUserOptions(users, sellers, 's-yasmim');
  assert.equal(forYasmim.find((o) => o.id === '13377356')!.takenBy, null);
});

test('usuário que não veio na última sincronização é marcado, mas continua na lista (vínculo preservado)', () => {
  assert.deepEqual([...missingUserIds(users)], ['15131108']);
  const july = buildKommoUserOptions(users, sellers, 's-july').find((o) => o.id === '15131108')!;
  assert.equal(july.missing, true);
  assert.equal(july.takenBy, null);
});

test('busca ignora acento e maiúsculas e acha pelo nome do usuário Kommo vinculado', () => {
  assert.equal(normalizeName('  Carolíne '), 'caroline');
  assert.equal(matchesSearch(sellers[0], users, 'carol'), true);
  assert.equal(matchesSearch(sellers[1], users, 'silva'), true);
  assert.equal(matchesSearch(sellers[1], users, 'carol'), false);
  assert.equal(matchesSearch(sellers[2], users, ''), true);
});

test('sincronização: ids como texto, sem duplicados, nome limpo; nada é apagado (só upsert)', () => {
  const now = new Date(SYNC);
  const rows = toKommoUserRows(
    [
      { id: 15815704, name: ' CAROLINE ', email: null },
      { id: 15815704, name: 'CAROLINE', email: null },
      { id: 14801439, name: '', email: 'x@y.z' },
    ] as never,
    now
  );
  assert.deepEqual(rows, [
    { id: '15815704', name: 'CAROLINE', email: null, synced_at: SYNC },
    { id: '14801439', name: 'Usuário 14801439', email: 'x@y.z', synced_at: SYNC },
  ]);
});

test('lista de usuários fica velha depois de 6 h (ou se nunca sincronizou)', () => {
  const now = new Date('2026-10-29T18:00:00Z');
  assert.equal(usersAreStale(null, now), true);
  assert.equal(usersAreStale('2026-10-29T13:00:00Z', now), false);
  assert.equal(usersAreStale('2026-10-29T11:00:00Z', now), true);
  assert.equal(usersAreStale(OLD, now), true);
});
