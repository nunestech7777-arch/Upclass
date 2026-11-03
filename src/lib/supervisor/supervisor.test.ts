// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelOf, originLabel, kommoLeadUrl } from './channels.ts';
import {
  byTimeline,
  classifyConversations,
  conversationStats,
  formatSeconds,
  median,
  sortByTimeline,
  storeDayOf,
  summarize,
  variation,
  type PeriodConversation,
  type PeriodMessage,
} from './metrics.ts';
import { daysOf, rangeToInstants, sanitizeSearch } from './filters.ts';
import { buildAnalysisTranscript } from './aiCriteria.ts';

function msg(conversation_id: string, sender: PeriodMessage['sender'], sent_at: string, received_seq = 0): PeriodMessage {
  return { conversation_id, sender, sent_at, received_seq };
}

function conv(id: string, extra: Partial<PeriodConversation> = {}): PeriodConversation {
  return {
    id,
    seller_id: 's1',
    client_name: `Cliente ${id}`,
    occurred_at: '2026-10-28T15:00:00Z',
    messages_count: 0,
    origin: 'waba',
    score: null,
    summary: null,
    kommo_lead_id: null,
    ...extra,
  };
}

test('canal: WhatsApp Business e Lite são WhatsApp; Instagram; resto é Outros', () => {
  assert.equal(channelOf('waba'), 'whatsapp');
  assert.equal(channelOf('com.amocrm.amocrmwa'), 'whatsapp');
  assert.equal(channelOf('instagram_business'), 'instagram');
  assert.equal(channelOf('facebook'), 'other');
  assert.equal(channelOf(null), 'other');
  assert.equal(originLabel('com.amocrm.amocrmwa'), 'WhatsApp Lite');
  assert.equal(originLabel(null), 'Canal não informado');
  assert.equal(kommoLeadUrl(null), null);
  assert.equal(kommoLeadUrl('123'), 'https://vocedeiphone.kommo.com/leads/detail/123');
});

test('tempo de resposta: mede da 1ª mensagem do cliente até o vendedor; bot não conta como resposta', () => {
  const s = conversationStats([
    msg('c', 'client', '2026-10-28T12:00:00Z'),
    msg('c', 'client', '2026-10-28T12:01:00Z'),
    msg('c', 'bot', '2026-10-28T12:01:30Z'),
    msg('c', 'seller', '2026-10-28T12:05:00Z'),
    msg('c', 'seller', '2026-10-28T12:06:00Z'),
    msg('c', 'client', '2026-10-28T13:00:00Z'),
    msg('c', 'seller', '2026-10-28T13:00:30Z'),
  ]);
  assert.deepEqual(s.responseSeconds, [300, 30]);
  assert.equal(s.awaitingReply, false);
  assert.equal(s.clientMessages, 3);
  assert.equal(s.sellerMessages, 3);
  assert.equal(s.botMessages, 1);
});

test('cliente sem resposta: última rodada do cliente aberta (mesmo com bot respondendo)', () => {
  const s = conversationStats([
    msg('c', 'seller', '2026-10-28T12:00:00Z'),
    msg('c', 'client', '2026-10-28T12:10:00Z'),
    msg('c', 'bot', '2026-10-28T12:10:05Z'),
  ]);
  assert.equal(s.awaitingReply, true);
  assert.equal(s.awaitingSince, '2026-10-28T12:10:00Z');
  assert.deepEqual(s.responseSeconds, []);
});

test('ordena pelo horário mesmo se o banco devolver fora de ordem', () => {
  const s = conversationStats([
    msg('c', 'seller', '2026-10-28T12:02:00Z'),
    msg('c', 'client', '2026-10-28T12:00:00Z'),
  ]);
  assert.deepEqual(s.responseSeconds, [120]);
});

test('resumo: analisadas só com nota/resumo reais; pendentes = resto; sem nota inventada', () => {
  const convs = [conv('a', { score: 8 }), conv('b'), conv('c', { seller_id: null, origin: 'instagram_business' })];
  const messages = [
    msg('a', 'client', '2026-10-28T12:00:00Z'),
    msg('a', 'seller', '2026-10-28T12:10:00Z'),
    msg('b', 'client', '2026-10-28T12:00:00Z'),
    msg('b', 'seller', '2026-10-28T12:02:00Z'),
    msg('c', 'client', '2026-10-28T12:00:00Z'),
  ];
  const s = summarize(convs, messages, ['2026-10-28']);
  assert.equal(s.conversations, 3);
  assert.equal(s.analyzed, 1);
  assert.equal(s.pending, 2);
  assert.equal(s.avgScore, 8);
  assert.equal(s.avgResponseSeconds, 360);
  assert.equal(s.medianResponseSeconds, 360);
  assert.equal(s.awaiting, 1);
  assert.equal(s.awaitingList[0].conversation.id, 'c');
  assert.deepEqual(s.byChannel, { whatsapp: 2, instagram: 1, other: 0 });
  // Sem status de atendimento informado ninguém vira atendente: o vendedor do lead (seller_id) não conta.
  assert.deepEqual(s.bySeller.map((r) => [r.sellerId, r.conversations, r.awaiting]), [[null, 3, 1]]);
  assert.deepEqual(s.byDay, [{ date: '2026-10-28', conversations: 3, avgResponseSeconds: 360 }]);
});

test('resumo sem nenhuma análise: nota média é null, nunca zero', () => {
  const s = summarize([conv('a')], []);
  assert.equal(s.avgScore, null);
  assert.equal(s.avgResponseSeconds, null);
  assert.equal(s.analyzed, 0);
});

test('período: dias da loja (UTC−3) viram instantes UTC com fim exclusivo', () => {
  assert.deepEqual(rangeToInstants({ from: '2026-10-28', to: '2026-10-28' }), {
    fromIso: '2026-10-28T03:00:00.000Z',
    toIso: '2026-10-29T03:00:00.000Z',
  });
  assert.deepEqual(daysOf({ from: '2026-10-30', to: '2026-11-02' }), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('busca: remove caracteres que mudariam o filtro do PostgREST', () => {
  assert.equal(sanitizeSearch('  Maria, (Silva)*  '), 'Maria Silva');
  assert.equal(sanitizeSearch('a'.repeat(100)).length, 60);
});

test('formatação e variação', () => {
  assert.equal(formatSeconds(null), '—');
  assert.equal(formatSeconds(42), '42 s');
  assert.equal(formatSeconds(300), '5 min');
  assert.equal(formatSeconds(4320), '1 h 12 min');
  assert.equal(formatSeconds(97200), '1 d 3 h');
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(variation(12, 10), 20);
  assert.equal(variation(5, 0), null);
});

test('transcrição para o avaliador: marca mensagem sem texto e não inventa conteúdo', () => {
  const t = buildAnalysisTranscript([
    { sender: 'seller', sender_id: '7', sender_name: 'Ana', message: '', message_type: 'unavailable', sent_at: '2026-10-28T12:01:00Z' },
    { sender: 'client', sender_name: 'Maria', message: 'Oi, tem iPhone 15?', message_type: 'text', sent_at: '2026-10-28T12:00:00Z' },
    { sender: 'system', sender_name: null, message: 'x', message_type: 'text', sent_at: '2026-10-28T12:00:30Z' },
    { sender: 'seller', sender_id: '7', sender_name: 'Ana', message: '', message_type: 'voice', sent_at: '2026-10-28T12:02:00Z' },
  ]);
  assert.equal(
    t,
    '[28/10, 09:00] Cliente: Oi, tem iPhone 15?\n[28/10, 09:01] Vendedor (Ana): [mensagem sem texto disponível]\n[28/10, 09:02] Vendedor (Ana): [voice]'
  );
});

test('sortByTimeline: mesma ordem que sort(byTimeline), inclusive empates e received_seq ausente', () => {
  const list: PeriodMessage[] = [
    msg('a', 'client', '2026-10-28T12:00:00Z', 3),
    msg('b', 'seller', '2026-10-28T11:00:00.000Z', 2),
    { conversation_id: 'c', sender: 'bot', sent_at: '2026-10-28T12:00:00Z' },
    msg('d', 'client', '2026-10-28T12:00:00Z', 3),
    msg('e', 'seller', '2026-10-28T09:00:00-03:00', 1),
    msg('f', 'client', '2026-10-28T12:00:00Z', 1),
  ];
  assert.deepEqual(sortByTimeline(list), [...list].sort(byTimeline));
  assert.equal(list[0].conversation_id, 'a');
});

test('storeDayOf: dia no fuso de Brasília', () => {
  assert.equal(storeDayOf('2026-10-28T02:59:59Z'), '2026-10-27');
  assert.equal(storeDayOf('2026-10-28T03:00:00Z'), '2026-10-28');
});

// ---------------------------------------------------------------------------
// Regressão 02/11/2026: resposta posterior ao período (lead 27183537) e "Clientes sem resposta"
// ---------------------------------------------------------------------------

test('resposta de 02/11 a mensagem de 31/10 20:16: em 31/10 a conversa segue "não atendida" e "sem resposta"', () => {
  const day = rangeToInstants({ from: '2026-10-31', to: '2026-10-31' });
  const human = (sent_at: string): PeriodMessage => ({ ...msg('c', 'seller', sent_at), sender_id: 'caroline' });
  const messages = [msg('c', 'client', '2026-10-31T23:16:00Z'), human('2026-11-02T12:54:00Z')];
  const status = classifyConversations([conv('c', { kommo_lead_id: '27183537' })], messages, day.toIso, { linkedKommoUsers: new Set(['caroline']) });
  assert.equal(status.get('c')?.status, 'nao_atendida');
  assert.deepEqual(status.get('c')?.attendants, []);
  const s = conversationStats(messages, day.toIso);
  assert.equal(s.awaitingReply, true, 'a resposta futura não apaga o "sem resposta" de 31/10');
  assert.equal(s.hadHumanReply, false);
  assert.equal(s.sellerMessages, 0, 'contadores do período não incluem a resposta de 02/11');
  // Ela só fecha a rodada para o tempo de resposta, marcada como fora do período.
  assert.equal(s.rounds.length, 1);
  assert.equal(s.rounds[0].inPeriod, false);
});

test('"Clientes sem resposta" inclui atendidas que terminaram o período com nova mensagem do cliente', () => {
  const day = rangeToInstants({ from: '2026-10-31', to: '2026-10-31' });
  const human = (id: string, sent_at: string): PeriodMessage => ({ ...msg(id, 'seller', sent_at), sender_id: 'u1' });
  const messages = [
    // a: não atendida (conta nos dois indicadores)
    msg('a', 'client', '2026-10-31T13:00:00Z'),
    // b: atendida e depois o cliente escreveu de novo sem resposta até o fim do dia
    msg('b', 'client', '2026-10-31T13:00:00Z'),
    human('b', '2026-10-31T13:05:00Z'),
    msg('b', 'client', '2026-10-31T20:00:00Z'),
    // c: atendida e encerrada respondida (não conta em nenhum)
    msg('c', 'client', '2026-10-31T13:00:00Z'),
    human('c', '2026-10-31T13:02:00Z'),
  ];
  const convs = ['a', 'b', 'c'].map((id) => conv(id));
  const status = classifyConversations(convs, messages, day.toIso, { linkedKommoUsers: new Set(['u1']) });
  assert.deepEqual(['a', 'b', 'c'].map((id) => status.get(id)?.status), ['nao_atendida', 'atendida', 'atendida']);
  const summary = summarize(convs, messages, ['2026-10-31'], { periodEnd: day.toIso });
  assert.equal(summary.awaiting, 2, 'não atendida (a) + atendida com mensagem pendente no fim (b)');
});
