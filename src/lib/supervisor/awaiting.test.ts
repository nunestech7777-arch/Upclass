// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConversations, summarize, type PeriodConversation, type PeriodMessage } from './metrics.ts';
import { rangeToInstants } from './filters.ts';
import { AWAITING_CATEGORIES, awaitingBreakdown, isAwaitingCategory } from './awaiting.ts';

const day = rangeToInstants({ from: '2026-10-31', to: '2026-10-31' });

function conv(id: string): PeriodConversation {
  return { id, seller_id: null, client_name: id, occurred_at: '2026-10-31T20:00:00Z', messages_count: 0, score: null, summary: null, kommo_lead_id: `L${id}` } as unknown as PeriodConversation;
}
const client = (c: string, at: string): PeriodMessage => ({ conversation_id: c, sender: 'client', sent_at: at, received_seq: 0 });
const human = (c: string, at: string, user = 'u1'): PeriodMessage => ({ conversation_id: c, sender: 'seller', sender_id: user, sent_at: at, received_seq: 0 });
const device = (c: string, at: string): PeriodMessage => ({ conversation_id: c, sender: 'seller', sender_id: null, sent_at: at, received_seq: 0 });
const salesbot = (c: string, at: string): PeriodMessage => ({ conversation_id: c, sender: 'bot', sender_name: 'Salesbot', sent_at: at, received_seq: 0 } as PeriodMessage);
const unknown = (c: string, at: string): PeriodMessage => ({ conversation_id: c, sender: 'bot', sender_name: null, message_type: 'unavailable', sent_at: at, received_seq: 0 } as PeriodMessage);

/** Um exemplo de cada situação + uma conversa respondida (fora do "sem resposta"). */
function scenario() {
  const messages: PeriodMessage[] = [
    client('nunca', '2026-10-31T13:00:00Z'),
    client('pend', '2026-10-31T13:00:00Z'),
    human('pend', '2026-10-31T13:05:00Z'),
    client('pend', '2026-10-31T22:00:00Z'),
    client('indet', '2026-10-31T13:00:00Z'),
    unknown('indet', '2026-10-31T13:01:00Z'),
    client('auto', '2026-10-31T13:00:00Z'),
    salesbot('auto', '2026-10-31T13:00:30Z'),
    client('aparelho', '2026-10-31T13:00:00Z'),
    device('aparelho', '2026-10-31T13:02:00Z'),
    client('aparelho', '2026-10-31T21:00:00Z'),
    client('ok', '2026-10-31T13:00:00Z'),
    human('ok', '2026-10-31T13:01:00Z'),
    // Resposta de 02/11 não tira "nunca" da lista de 31/10.
    human('nunca', '2026-11-01T12:00:00Z'),
  ];
  const convs = ['nunca', 'pend', 'indet', 'auto', 'aparelho', 'ok'].map(conv);
  const attendance = classifyConversations(convs, messages, day.toIso, { linkedKommoUsers: new Set(['u1']) });
  const summary = summarize(convs, messages, ['2026-10-31'], { attendance, periodEnd: day.toIso });
  return { attendance, summary };
}

test('cada situação vai para sua categoria e a soma é o total de "Clientes sem resposta"', () => {
  const { attendance, summary } = scenario();
  assert.equal(summary.awaiting, 5);
  const b = awaitingBreakdown(summary.awaitingList, attendance, summary.awaiting);
  assert.deepEqual(b.counts, { nunca_atendida: 1, atendida_pendente: 1, nao_determinada: 1, automatica: 1, nao_identificado: 1 });
  assert.equal(b.total, 5);
  assert.equal(b.reconciled, true);
  assert.deepEqual([...b.ids.nunca_atendida], ['nunca']);
  assert.deepEqual([...b.ids.atendida_pendente], ['pend']);
  assert.ok(!AWAITING_CATEGORIES.some((c) => b.ids[c].has('ok')), 'conversa respondida não entra');
});

test('conversa sem status ou total divergente: sem selo "Conferida"', () => {
  const { attendance, summary } = scenario();
  const partial = new Map(attendance);
  partial.delete('auto');
  const b = awaitingBreakdown(summary.awaitingList, partial, summary.awaiting);
  assert.equal(b.unclassified, 1);
  assert.equal(b.reconciled, false);
  assert.equal(awaitingBreakdown(summary.awaitingList, attendance, summary.awaiting + 1).reconciled, false);
});

test('conversa repetida na lista: conta uma vez e tira o selo "Conferida" (a lista divergiu do total)', () => {
  const { attendance, summary } = scenario();
  const dup = [...summary.awaitingList, summary.awaitingList[0]];
  const b = awaitingBreakdown(dup, attendance, summary.awaiting);
  assert.equal(b.total, 5);
  assert.equal(b.reconciled, false);
});

test('filtro de vendedor: o card usa a mesma lista focada do total do vendedor', () => {
  const messages: PeriodMessage[] = [
    client('a', '2026-10-31T13:00:00Z'),
    human('a', '2026-10-31T13:05:00Z', 'u1'),
    client('a', '2026-10-31T22:00:00Z'),
    client('b', '2026-10-31T13:00:00Z'),
    human('b', '2026-10-31T13:05:00Z', 'u2'),
    client('b', '2026-10-31T22:00:00Z'),
  ];
  const convs = ['a', 'b'].map(conv);
  const attendance = classifyConversations(convs, messages, day.toIso, { linkedKommoUsers: new Set(['u1', 'u2']) });
  const summary = summarize(convs, messages, ['2026-10-31'], { attendance, periodEnd: day.toIso, attendantKeyOf: (id) => id, focus: 'u1' });
  const b = awaitingBreakdown(summary.awaitingList, attendance, summary.awaiting);
  assert.equal(summary.awaiting, 1);
  assert.deepEqual([...b.ids.atendida_pendente], ['a']);
  assert.equal(b.reconciled, true);
});

test('parâmetro da URL: só categorias conhecidas', () => {
  assert.equal(isAwaitingCategory('nunca_atendida'), true);
  assert.equal(isAwaitingCategory('qualquer'), false);
  assert.equal(isAwaitingCategory(null), false);
});
