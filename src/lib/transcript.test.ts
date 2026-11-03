// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscript, transcriptPeriodView } from './transcript.ts';

const names = { clientName: 'Maria' };

function row(id: string, sent_at: string, sender: string, extra: Record<string, unknown> = {}) {
  return { id, sent_at, sender, message: `msg ${id}`, received_seq: Number(id.replace(/\D/g, '')) || 0, ...extra } as never;
}

test('ordena pelo horário original, mesmo se o banco devolver fora de ordem', () => {
  const t = buildTranscript(
    [
      row('3', '2026-09-21T14:00:30Z', 'client'),
      row('1', '2026-09-21T14:00:10Z', 'client'),
      row('2', '2026-09-21T14:00:20Z', 'seller'),
    ],
    names,
    'UTC'
  );
  assert.deepEqual(t.map((m) => m.id), ['1', '2', '3']);
});

test('mensagens no mesmo segundo usam a ordem de chegada (received_seq) como desempate', () => {
  const t = buildTranscript(
    [
      row('b', '2026-09-21T14:00:10Z', 'seller', { received_seq: 8 }),
      row('a', '2026-09-21T14:00:10Z', 'client', { received_seq: 7 }),
      row('c', '2026-09-21T14:00:10Z', 'client', { received_seq: 9 }),
    ],
    names,
    'UTC'
  );
  assert.deepEqual(t.map((m) => m.id), ['a', 'b', 'c']);
});

test('não inventa remetente: conversa só com mensagens do cliente continua só do cliente', () => {
  const t = buildTranscript(
    [row('1', '2026-09-21T14:00:10Z', 'client'), row('2', '2026-09-21T14:00:20Z', 'client'), row('3', '2026-09-21T14:00:30Z', 'client')],
    names,
    'UTC'
  );
  assert.deepEqual(t.map((m) => m.sender), ['client', 'client', 'client']);
});

test('nome exibido é o autor real da mensagem; bot e sistema aparecem como tal', () => {
  const t = buildTranscript(
    [
      row('1', '2026-09-21T14:00:10Z', 'client', { sender_name: 'Maria Silva' }),
      row('2', '2026-09-21T14:00:20Z', 'bot', { sender_name: null }),
      row('3', '2026-09-21T14:00:30Z', 'seller', { sender_name: 'Ana (plantão)' }),
      row('4', '2026-09-21T14:00:40Z', 'seller', { sender_name: null }),
      row('5', '2026-09-21T14:00:50Z', 'system', { sender_name: null, message_type: 'picture' }),
    ],
    names,
    'UTC'
  );
  assert.deepEqual(
    t.map((m) => [m.sender, m.senderName]),
    [
      ['client', 'Maria Silva'],
      ['bot', 'Bot'],
      ['seller', 'Ana (plantão)'],
      // sem autor informado pelo Kommo: rótulo neutro, nunca o vendedor responsável presumido
      ['seller', 'Atendente'],
      ['system', 'Sistema'],
    ]
  );
  assert.equal(t[4].attachmentType, 'picture');
  assert.equal(t[0].attachmentType, null);
});

test('horário convertido uma única vez a partir de UTC; separador de dia quando a data muda', () => {
  const t = buildTranscript(
    [
      row('1', '2026-09-21T23:50:00Z', 'client'),
      row('2', '2026-09-21T23:55:00Z', 'seller'),
      row('3', '2026-09-22T00:05:00Z', 'client'),
    ],
    names,
    'America/Sao_Paulo'
  );
  // 23:50Z = 20:50 em São Paulo (UTC-3) — mesmo dia, sem virar para 22/09
  assert.deepEqual(t.map((m) => m.time), ['20:50', '20:55', '21:05']);
  assert.ok(t[0].dayLabel);
  assert.equal(t[1].dayLabel, null);
  assert.equal(t[2].dayLabel, null);
});

test('marcador de mensagem sem texto (events API) é sinalizado, com autor e posição reais', () => {
  const t = buildTranscript(
    [
      row('1', '2026-09-21T14:00:10Z', 'client', { message_type: 'text' }),
      row('2', '2026-09-21T14:00:20Z', 'seller', { message: '', message_type: 'unavailable', sender_name: 'Ana' }),
    ],
    names,
    'UTC'
  );
  assert.deepEqual(t.map((m) => [m.sender, m.senderName, m.unavailable, m.attachmentType]), [
    ['client', 'Maria', false, null],
    ['seller', 'Ana', true, null],
  ]);
});

test('período escolhido: marca mensagens anteriores e posteriores e conta só as de dentro como "no período"', () => {
  // 31/10 na loja = [31/10 03:00Z, 01/11 03:00Z)
  const t = buildTranscript(
    [
      row('1', '2026-10-30T15:00:00Z', 'client'),
      row('2', '2026-10-31T23:16:00Z', 'client'),
      row('3', '2026-10-31T23:20:00Z', 'bot', { sender_name: 'Salesbot' }),
      row('4', '2026-11-02T12:54:00Z', 'seller', { sender_name: 'CAROLINE' }),
      row('5', '2026-11-02T12:55:00Z', 'client'),
    ],
    names
  );
  const v = transcriptPeriodView(t, '2026-10-31T03:00:00.000Z', '2026-11-01T03:00:00.000Z');
  assert.deepEqual(v.positions, ['before', 'in', 'in', 'after', 'after']);
  assert.deepEqual(v.inPeriod, { client: 1, seller: 0, bot: 1 });
  assert.deepEqual(v.all, { client: 3, seller: 1, bot: 1 });
  assert.equal(v.firstAfter, 3, 'o aviso de resposta posterior fica antes da resposta de 02/11');
  assert.equal(v.firstInAfterBefore, 1);
  // Autor preservado na transcrição completa.
  assert.equal(t[3].senderName, 'CAROLINE');
});

test('período escolhido: conversa toda dentro do período não ganha marcadores', () => {
  const t = buildTranscript([row('1', '2026-10-31T13:00:00Z', 'client'), row('2', '2026-10-31T13:05:00Z', 'seller')], names);
  const v = transcriptPeriodView(t, '2026-10-31T03:00:00.000Z', '2026-11-01T03:00:00.000Z');
  assert.equal(v.firstAfter, -1);
  assert.equal(v.firstInAfterBefore, -1);
  assert.deepEqual(v.inPeriod, v.all);
});

test('período escolhido: limites exatos — início entra, fim (meia-noite seguinte) já é posterior', () => {
  const t = buildTranscript([row('1', '2026-10-31T03:00:00Z', 'client'), row('2', '2026-11-01T02:59:59Z', 'seller'), row('3', '2026-11-01T03:00:00Z', 'seller')], names);
  const v = transcriptPeriodView(t, '2026-10-31T03:00:00.000Z', '2026-11-01T03:00:00.000Z');
  assert.deepEqual(v.positions, ['in', 'in', 'after']);
  assert.deepEqual(v.inPeriod, { client: 1, seller: 1, bot: 0 });
});

test('horário e dia exibidos no fuso da loja (mensagem de 31/10 23:16 não vira 01/11)', () => {
  const t = buildTranscript([row('1', '2026-11-01T02:16:00Z', 'client')], names, 'America/Sao_Paulo');
  assert.equal(t[0].time, '23:16');
  assert.match(t[0].dayLabel ?? '', /31/);
});
