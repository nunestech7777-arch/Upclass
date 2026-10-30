// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceTotals,
  classifyAttendance,
  matchesAttendanceFilter,
  isChannelAuthored,
  kommoProcessedConversations,
  outgoingKind,
  templateMessageIds,
  templateTexts,
  type ConversationAttendance,
} from './attendance.ts';
import { classifyConversations, conversationsInPeriod, summarize, type PeriodConversation, type PeriodMessage } from './metrics.ts';

const EMERSON = '11336555';
const YASMIN = '111';
const KAREN = '222';
const linked = new Set([YASMIN, KAREN]);

let seq = 0;
function m(conversation_id: string, sender: PeriodMessage['sender'], minute: number, extra: Partial<PeriodMessage> = {}): PeriodMessage {
  seq += 1;
  return { conversation_id, sender, sent_at: new Date(Date.UTC(2026, 9, 28, 15, minute)).toISOString(), received_seq: seq, ...extra };
}
const seller = (c: string, minute: number, id: string) => m(c, 'seller', minute, { sender_id: id, sender_name: 'x', message_type: 'text' });
const bot = (c: string, minute: number, name: string, extra: Partial<PeriodMessage> = {}) =>
  m(c, 'bot', minute, { sender_name: name, message_type: 'text', ...extra });

test('tipo da mensagem: vendedor com id, aparelho, Salesbot, resposta pronta do canal e sem autor', () => {
  assert.equal(outgoingKind({ sender: 'seller', sender_id: YASMIN }), 'human');
  assert.equal(outgoingKind({ sender: 'seller', sender_id: null }), 'external');
  assert.equal(outgoingKind({ sender: 'bot', sender_name: 'Salesbot' }), 'automatic');
  assert.equal(outgoingKind({ sender: 'bot', sender_name: 'WhatsApp Lite', message_type: 'text' }), 'external');
  assert.equal(outgoingKind({ sender: 'bot', sender_name: 'Instagram', message_type: 'text', template: true }), 'automatic');
  assert.equal(outgoingKind({ sender: 'bot', sender_name: 'Automação ou envio externo', message_type: 'unavailable' }), 'unknown');
  assert.equal(outgoingKind({ sender: 'client' }), null);
  assert.equal(outgoingKind({ sender: 'system' }), null);
});

test('texto repetido em 3+ conversas é resposta pronta; texto único não', () => {
  const ids = templateMessageIds([
    { id: 'a', conversation_id: 'c1', message: 'Olá! Já te respondemos' },
    { id: 'b', conversation_id: 'c2', message: 'olá!  já te respondemos ' },
    { id: 'c', conversation_id: 'c3', message: 'Olá! Já te respondemos' },
    { id: 'd', conversation_id: 'c1', message: 'Seu iPhone chegou' },
    { id: 'e', conversation_id: 'c1', message: 'Seu iPhone chegou' },
  ]);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
});

test('lead no nome do Emerson e resposta da Yasmin: atendida pela Yasmin, nunca pelo Emerson', () => {
  const a = classifyAttendance([m('c', 'client', 0), seller('c', 5, YASMIN)], 'L1', {
    responsibleByLead: new Map([['L1', EMERSON]]),
    linkedKommoUsers: linked,
  });
  assert.equal(a.status, 'atendida');
  assert.deepEqual(a.attendants, [{ kommoUserId: YASMIN, messages: 1 }]);
  assert.equal(a.awaitingDistribution, false);
  assert.equal(a.responsibleId, EMERSON);
});

test('Emerson que respondeu de verdade aparece como atendente', () => {
  const a = classifyAttendance([m('c', 'client', 0), seller('c', 2, EMERSON)], 'L1', { linkedKommoUsers: linked });
  assert.equal(a.status, 'atendida');
  assert.deepEqual(a.attendants.map((x) => x.kommoUserId), [EMERSON]);
});

test('vários atendentes ficam preservados, na ordem da primeira resposta', () => {
  const a = classifyAttendance(
    [m('c', 'client', 0), seller('c', 1, KAREN), seller('c', 2, YASMIN), seller('c', 3, KAREN)],
    null,
    { linkedKommoUsers: linked }
  );
  assert.deepEqual(a.attendants, [
    { kommoUserId: KAREN, messages: 2 },
    { kommoUserId: YASMIN, messages: 1 },
  ]);
});

test('sem resposta + lead com a conta de distribuição: não atendida E aguardando distribuição', () => {
  const ctx = { responsibleByLead: new Map([['L1', EMERSON], ['L2', YASMIN]]), linkedKommoUsers: linked };
  const a = classifyAttendance([m('c', 'client', 0)], 'L1', ctx);
  assert.equal(a.status, 'nao_atendida');
  assert.equal(a.awaitingDistribution, true);
  // Lead com vendedora vinculada e sem resposta: só não atendida.
  const b = classifyAttendance([m('c', 'client', 0)], 'L2', ctx);
  assert.equal(b.status, 'nao_atendida');
  assert.equal(b.awaitingDistribution, false);
  // Responsável não consultado: nada é presumido.
  const c = classifyAttendance([m('c', 'client', 0)], 'L9', ctx);
  assert.equal(c.responsibleId, undefined);
  assert.equal(c.awaitingDistribution, false);
});

test('só Salesbot respondeu: atendimento automático (pode estar aguardando distribuição)', () => {
  const a = classifyAttendance([m('c', 'client', 0), bot('c', 0, 'Salesbot')], 'L1', {
    responsibleByLead: new Map([['L1', EMERSON]]),
    linkedKommoUsers: linked,
  });
  assert.equal(a.status, 'automatico');
  assert.equal(a.awaitingDistribution, true);
});

test('resposta digitada no aparelho: atendente não identificado; marcador sem autor: não determinado', () => {
  const ext = classifyAttendance([m('c', 'client', 0), bot('c', 4, 'WhatsApp Lite')], null, { linkedKommoUsers: linked });
  assert.equal(ext.status, 'atendente_nao_identificado');
  assert.deepEqual(ext.attendants, []);
  const unk = classifyAttendance(
    [m('c', 'client', 0), bot('c', 4, 'Automação ou envio externo', { message_type: 'unavailable' })],
    null,
    { linkedKommoUsers: linked }
  );
  assert.equal(unk.status, 'nao_determinado');
  assert.equal(classifyAttendance([], null, { linkedKommoUsers: linked }).status, 'nao_determinado');
});

test('totais: cada conversa em um só status; distribuição é contada à parte', () => {
  const ctx = { responsibleByLead: new Map([['L1', EMERSON]]), linkedKommoUsers: linked };
  const items: ConversationAttendance[] = [
    classifyAttendance([m('a', 'client', 0)], 'L1', ctx),
    classifyAttendance([m('b', 'client', 0), seller('b', 1, YASMIN)], 'L1', ctx),
    classifyAttendance([m('c', 'client', 0), bot('c', 1, 'Salesbot')], null, ctx),
  ];
  const t = attendanceTotals(items);
  assert.equal(t.total, 3);
  assert.equal(t.atendida + t.nao_atendida + t.atendente_nao_identificado + t.automatico + t.nao_determinado, 3);
  assert.equal(t.aguardando_distribuicao, 1);
  assert.equal(matchesAttendanceFilter(items[0], 'aguardando_distribuicao'), true);
  assert.equal(matchesAttendanceFilter(items[0], 'nao_atendida'), true);
});

test('desempenho por quem respondeu: conversa compartilhada conta para os dois, total não duplica', () => {
  const conv = (id: string): PeriodConversation => ({
    id,
    seller_id: 'lead-owner',
    client_name: id,
    occurred_at: '2026-10-28T15:30:00Z',
    messages_count: 0,
    origin: 'waba',
    score: null,
    summary: null,
    kommo_lead_id: null,
  });
  const messages = [
    m('a', 'client', 0), seller('a', 10, YASMIN), m('a', 'client', 20), seller('a', 25, KAREN),
    m('b', 'client', 0), bot('b', 0, 'Salesbot'),
  ];
  const ctx = { linkedKommoUsers: linked };
  const byConv = new Map<string, PeriodMessage[]>();
  for (const x of messages) byConv.set(x.conversation_id, [...(byConv.get(x.conversation_id) ?? []), x]);
  const attendance = new Map([...byConv].map(([id, list]) => [id, classifyAttendance(list, null, ctx)]));
  const keyOf = (id: string) => (id === YASMIN ? 'seller-yasmin' : id === KAREN ? 'seller-karen' : `kommo:${id}`);

  const s = summarize([conv('a'), conv('b')], messages, [], { attendance, attendantKeyOf: keyOf });
  assert.equal(s.conversations, 2);
  const row = (k: string | null) => s.bySeller.find((r) => r.sellerId === k)!;
  assert.equal(row('seller-yasmin').conversations, 1);
  assert.equal(row('seller-karen').conversations, 1);
  assert.equal(row('seller-yasmin').avgResponseSeconds, 600);
  assert.equal(row('seller-karen').avgResponseSeconds, 300);
  assert.equal(row(null).conversations, 1);
  assert.equal(row(null).awaiting, 1);
  assert.equal(s.bySeller.some((r) => r.sellerId === 'lead-owner'), false);

  const focused = summarize([conv('a')], messages, [], { attendance, attendantKeyOf: keyOf, focus: 'seller-karen' });
  assert.equal(focused.responses, 1);
  assert.equal(focused.avgResponseSeconds, 300);
  assert.equal(focused.sellerMessages, 1);
});

test('resposta no dia seguinte entra no tempo de resposta, mas o cliente terminou o período sem resposta', () => {
  const messages = [m('a', 'client', 0), seller('a', 120, YASMIN)];
  const s = summarize(
    [{ id: 'a', seller_id: null, client_name: 'a', occurred_at: '2026-10-28T15:00:00Z', messages_count: 0, origin: null, score: null, summary: null, kommo_lead_id: null }],
    messages,
    [],
    { periodEnd: '2026-10-28T16:00:00Z' }
  );
  assert.equal(s.responses, 1);
  assert.equal(s.answeredInPeriod, 0);
  assert.equal(s.awaiting, 1);
  assert.equal(s.sellerMessages, 0);
  assert.equal(s.clientMessages, 1);
});

const pc = (id: string, occurred_at: string): PeriodConversation => ({
  id, seller_id: null, client_name: id, occurred_at, messages_count: 0, origin: null, score: null, summary: null, kommo_lead_id: null,
});

test('conversa de ontem respondida hoje continua em "ontem"; disparo só de robô não é atendimento', () => {
  const periodEnd = '2026-10-28T16:00:00Z';
  const msgs = [m('a', 'client', 0), seller('a', 120, YASMIN), m('b', 'client', 90), bot('c', 10, 'Salesbot')];
  const out = conversationsInPeriod([pc('a', '2026-10-28T17:00:00Z'), pc('b', '2026-10-28T16:30:00Z'), pc('c', '2026-10-28T15:10:00Z')], msgs, periodEnd);
  assert.deepEqual(out.map((c) => [c.id, c.period_last_at]), [['a', '2026-10-28T15:00:00.000Z']]);
  const s = summarize(out, msgs, ['2026-10-28'], { periodEnd });
  assert.deepEqual(s.byDay, [{ date: '2026-10-28', conversations: 1, avgResponseSeconds: 7200 }]);
});

test('resposta pronta reconhecida pelo texto, mesmo fora da janela de 14 dias', () => {
  const lookback = [
    { id: 'x1', conversation_id: 'c1', message: 'Oi! Em breve respondemos' },
    { id: 'x2', conversation_id: 'c2', message: 'Oi! Em breve respondemos' },
  ];
  const old = { id: 'old', conversation_id: 'c3', message: 'oi!  em breve respondemos' };
  assert.equal(templateTexts([...lookback, old]).has('oi! em breve respondemos'), true);
  // O mesmo id repetido (janela e período se sobrepõem) não conta duas vezes.
  assert.equal(templateTexts([...lookback, lookback[0]]).size, 0);
  assert.equal(isChannelAuthored({ sender: 'bot', sender_name: 'Instagram', message_type: 'text' }), true);
  assert.equal(isChannelAuthored({ sender: 'bot', sender_name: 'Salesbot', message_type: 'text' }), false);
  assert.equal(isChannelAuthored({ sender: 'bot', sender_name: 'Automação ou envio externo', message_type: 'unavailable' }), false);
});

test('cliente esperando numa conversa já respondida pelo aparelho não aparece como "ninguém respondeu"', () => {
  const msgs = [m('a', 'client', 0), bot('a', 3, 'WhatsApp Lite'), m('a', 'client', 10)];
  const s = summarize([pc('a', '2026-10-28T15:10:00Z')], msgs);
  assert.equal(s.awaitingList[0].answered, true);
  assert.equal(s.awaitingList[0].attendantKey, null);
});

test('resposta do dia seguinte NÃO muda status nem atendentes do dia; só fecha o tempo de resposta', () => {
  const periodEnd = '2026-10-28T16:00:00Z';
  // Cliente às 15:00 (dentro); Yasmin às 15:10 (dentro); cliente 15:30; Emerson só às 17:00 (depois do fim).
  const msgs = [m('a', 'client', 0), seller('a', 10, YASMIN), m('a', 'client', 30), seller('a', 120, EMERSON), m('b', 'client', 0), seller('b', 90, KAREN)];
  const convs = [pc('a', '2026-10-28T17:00:00Z'), pc('b', '2026-10-28T16:30:00Z')];
  const att = classifyConversations(convs, msgs, periodEnd, { linkedKommoUsers: linked });
  assert.deepEqual(att.get('a')!.attendants.map((x) => x.kommoUserId), [YASMIN]);
  assert.equal(att.get('b')!.status, 'nao_atendida');
  assert.deepEqual(att.get('b')!.attendants, []);
  const keyOf = (id: string) => `kommo:${id}`;
  const s = summarize(convs, msgs, [], { attendance: att, attendantKeyOf: keyOf, periodEnd });
  assert.equal(s.bySeller.some((r) => r.sellerId === `kommo:${EMERSON}`), false);
  assert.equal(s.bySeller.some((r) => r.sellerId === `kommo:${KAREN}`), false);
  // Tempo de resposta usa a resposta do dia seguinte (rodadas fechadas), sem mudar quem atendeu...
  assert.equal(s.responses, 3);
  // ...mas "sem resposta" e a taxa são do período: as duas conversas terminaram o dia esperando.
  assert.equal(s.answeredInPeriod, 1);
  assert.equal(s.awaiting, 2);
  assert.deepEqual(s.awaitingList.map((x) => [x.conversation.id, x.attendantKey]), [['b', null], ['a', `kommo:${YASMIN}`]]);
});

test('conversas processadas no critério Kommo: soma por autor; robô por autor; sem autor fica de fora', () => {
  const t = (c: string, talk: string, x: PeriodMessage) => ({ ...x, conversation_id: c, kommo_talk_id: talk });
  const msgs = [
    t('a', 'T1', seller('a', 1, YASMIN)), t('a', 'T1', seller('a', 2, KAREN)), t('a', 'T1', seller('a', 3, YASMIN)),
    t('b', 'T2', seller('b', 1, YASMIN)), t('b', 'T2', bot('b', 0, 'Salesbot')), t('b', 'T2', bot('b', 5, 'Instagram')),
    t('c', 'T3', bot('c', 0, 'Salesbot')),
    t('d', 'T4', bot('d', 0, 'Automação ou envio externo', { message_type: 'unavailable' })),
    t('e', 'T5', m('e', 'client', 0)),
  ];
  const k = kommoProcessedConversations(msgs);
  assert.deepEqual(k.users, [{ kommoUserId: YASMIN, talks: 2 }, { kommoUserId: KAREN, talks: 1 }]);
  // T2 tem Salesbot e Instagram: 2 ocorrências de robô, 1 atendimento diferente (o caso 69 × 67).
  assert.equal(k.robot.total, 3);
  assert.equal(k.robot.uniqueTalks, 2);
  assert.deepEqual(k.robot.byAuthor, [{ name: 'Salesbot', talks: 2 }, { name: 'Instagram', talks: 1 }]);
  assert.equal(k.total, 6);
  assert.equal(k.uniqueTalks, 3);
  assert.deepEqual(k.withoutAuthor, { messages: 1, talks: 1 });
});
