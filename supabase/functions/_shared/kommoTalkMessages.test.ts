// Rodar com: npm test  (node --test). Dados SIMULADOS no formato documentado da API — não provam a integração real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTalkFetchError,
  classifyTalkMessageSender,
  normalizeTalkMessage,
  planTalkIngest,
  summarizeTalkProbe,
  talkMessageAuthorIdentified,
  UNIDENTIFIED_AUTHOR,
  type KommoTalkApiMessage,
  type TalkContext,
} from './kommoTalkMessages.ts';

const RECEIVED = new Date('2026-10-27T15:00:00.000Z');
const TALK: TalkContext = { talk_id: '124229', chat_id: 'chat-A', contact_id: '500', entity_type: 'lead', entity_id: '9001' };

function api(over: Partial<KommoTalkApiMessage> = {}): KommoTalkApiMessage {
  return {
    id: 'msg-1',
    chat_id: 'chat-A',
    type: 'incoming',
    message_type: 'text',
    author: { id: 'amojo-ext-1', type: 'external', name: 'Maria Cliente' },
    text: 'Oi, tem o iPhone 15?',
    created_at: 1793000000,
    sec_created_at: 1793000000123,
    origin: 'com.amocrm.amocrmwa',
    attachment: null,
    ...over,
  };
}

const seller = (id: string, userId: number, created: number, text = 'Temos sim!') =>
  api({ id, type: 'outgoing', author: { id: `amojo-u${userId}`, type: 'internal', name: `Vendedor ${userId}`, user_id: userId }, text, created_at: created });

test('1. incoming de cliente → client, com texto e horário UTC', () => {
  const r = normalizeTalkMessage(api(), TALK, RECEIVED);
  assert.ok(r.ok);
  assert.equal(r.value.sender_type, 'client');
  assert.equal(r.value.direction, 'incoming');
  assert.equal(r.value.message_text, 'Oi, tem o iPhone 15?');
  // sec_created_at (ms) do mesmo segundo dá a precisão; created_at_original fica o valor em segundos
  assert.equal(r.value.sent_at, new Date(1793000000123).toISOString());
  assert.equal(r.value.created_at_original, '1793000000');
  // ms de outro segundo é ignorado
  const off = normalizeTalkMessage(api({ sec_created_at: 1793000005000 }), TALK, RECEIVED);
  assert.ok(off.ok);
  assert.equal(off.value.sent_at, new Date(1793000000 * 1000).toISOString());
  assert.equal(r.value.kommo_message_id, 'msg-1');
  assert.equal(r.value.kommo_talk_id, '124229');
  assert.equal(r.value.kommo_lead_id, '9001');
});

test('2. outgoing de vendedor → seller, sender_id = author.user_id (id do usuário Kommo)', () => {
  const r = normalizeTalkMessage(seller('msg-2', 11, 1793000060), TALK, RECEIVED);
  assert.ok(r.ok);
  assert.equal(r.value.sender_type, 'seller');
  assert.equal(r.value.direction, 'outgoing');
  assert.equal(r.value.sender_id, '11');
  assert.equal(r.value.sender_name, 'Vendedor 11');
  assert.equal(r.value.message_text, 'Temos sim!');
});

test('3. mensagem de bot → bot (não é vendedor humano)', () => {
  const m = api({ id: 'b', type: 'outgoing', author: { id: 'bot-1', type: 'bot', name: 'Salesbot' }, text: 'Olá! Em que posso ajudar?' });
  assert.deepEqual(classifyTalkMessageSender(m), { sender: 'bot', identified: true });
  const r = normalizeTalkMessage(m, TALK, RECEIVED);
  assert.ok(r.ok);
  assert.equal(r.value.sender_type, 'bot');
  assert.equal(r.value.sender_name, 'Salesbot');
});

test('4. outgoing com autor desconhecido → não vira vendedor; registra a limitação', () => {
  for (const author of [undefined, { id: 'x', type: '' }, { id: 'x', type: 'algo_novo' }, { id: 'x', type: 'external' }]) {
    const m = api({ id: 'u', type: 'outgoing', author, text: 'mensagem' });
    assert.deepEqual(classifyTalkMessageSender(m), { sender: 'system', identified: false });
    const r = normalizeTalkMessage(m, TALK, RECEIVED);
    assert.ok(r.ok);
    assert.notEqual(r.value.sender_type, 'seller');
    assert.equal(r.value.sender_name, UNIDENTIFIED_AUTHOR);
  }
  // internal sem user_id: é vendedor, mas sem id não inventamos qual
  const r = normalizeTalkMessage(api({ id: 'v', type: 'outgoing', author: { id: 'a', type: 'internal', name: 'Fulano' } }), TALK, RECEIVED);
  assert.ok(r.ok);
  assert.equal(r.value.sender_type, 'seller');
  assert.equal(r.value.sender_id, null);
});

test('5. conversa com múltiplos vendedores mantém cada autor', () => {
  const msgs = [api({ id: 'c1', created_at: 1793000000 }), seller('s1', 11, 1793000010), seller('s2', 22, 1793000020), seller('s3', 33, 1793000030)];
  const ids = msgs.map((m) => normalizeTalkMessage(m, TALK, RECEIVED)).map((r) => (r.ok ? `${r.value.sender_type}:${r.value.sender_id}` : 'x'));
  assert.deepEqual(ids, ['client:amojo-ext-1', 'seller:11', 'seller:22', 'seller:33']);
});

test('7. duplicadas: mesma id repetida na resposta entra uma vez; já gravada com texto não é reescrita', () => {
  const msgs = [api({ id: 'a' }), api({ id: 'a' }), seller('b', 11, 1793000100), seller('c', 11, 1793000200)];
  const plan = planTalkIngest(msgs, [
    { external_id: 'a', message_type: 'text' }, // veio pelo webhook
    { external_id: 'b', message_type: 'unavailable' }, // marcador da events API
  ]);
  assert.equal(plan.duplicatesInResponse, 1);
  assert.equal(plan.alreadyStored, 1);
  assert.equal(plan.placeholdersFilled, 1);
  assert.deepEqual(plan.toIngest.map((m) => m.id), ['b', 'c']);
  assert.equal(plan.idMismatch, false);
});

test('plano ordena cronologicamente (created_at, depois sec_created_at)', () => {
  const plan = planTalkIngest(
    [
      api({ id: 'z', created_at: 1793000100, sec_created_at: 1793000100900 }),
      api({ id: 'y', created_at: 1793000100, sec_created_at: 1793000100100 }),
      api({ id: 'x', created_at: 1793000000 }),
    ],
    []
  );
  assert.deepEqual(plan.toIngest.map((m) => m.id), ['x', 'y', 'z']);
});

test('ids de outro espaço: talk com mensagens reais gravadas e nenhuma id em comum → não grava nada', () => {
  const plan = planTalkIngest([api({ id: 'novo-1' }), seller('novo-2', 11, 1793000100)], [{ external_id: 'webhook-1', message_type: 'text' }]);
  assert.equal(plan.idMismatch, true);
  assert.equal(plan.toIngest.length, 0);
  // só marcadores (sem mensagens reais) não prova nada → grava normalmente
  const ok = planTalkIngest([api({ id: 'novo-1' })], [{ external_id: 'ph-1', message_type: 'unavailable' }]);
  assert.equal(ok.idMismatch, false);
  assert.equal(ok.toIngest.length, 1);
});

test('9. erros 401/402/403 suspendem o histórico; 404 só pula o talk', () => {
  assert.deepEqual(classifyTalkFetchError(401), { kind: 'token_invalid', blocksAll: true });
  assert.deepEqual(classifyTalkFetchError(402), { kind: 'payment_required', blocksAll: true });
  assert.deepEqual(classifyTalkFetchError(403), { kind: 'forbidden', blocksAll: true });
  assert.deepEqual(classifyTalkFetchError(404), { kind: 'talk_not_found', blocksAll: false });
  assert.deepEqual(classifyTalkFetchError(500), { kind: 'other', blocksAll: false });
});

test('10. anexos: áudio/imagem sem texto são gravados com o tipo; texto vazio sem anexo é ignorado', () => {
  const voice = normalizeTalkMessage(
    api({ id: 'v', type: 'incoming', message_type: 'voice', text: '', attachment: { type: 'voice', link: 'https://x/a.ogg', file_name: 'a.ogg' } }),
    TALK,
    RECEIVED
  );
  assert.ok(voice.ok);
  assert.equal(voice.value.message_type, 'voice');
  assert.equal(voice.value.message_text, '');
  const pic = normalizeTalkMessage(api({ id: 'p', message_type: 'picture', text: 'olha', attachment: { type: 'picture', link: 'l' } }), TALK, RECEIVED);
  assert.ok(pic.ok);
  assert.equal(pic.value.message_type, 'picture');
  assert.equal(pic.value.message_text, 'olha');
  // localização vem sem attachment: o message_type conta como conteúdo
  const loc = normalizeTalkMessage(api({ id: 'l', message_type: 'location', text: '' }), TALK, RECEIVED);
  assert.ok(loc.ok);
  assert.equal(loc.value.message_type, 'location');
  const empty = normalizeTalkMessage(api({ id: 'e', message_type: 'text', text: '  ' }), TALK, RECEIVED);
  assert.deepEqual(empty, { ok: false, reason: 'empty_message' });
});

test('origem marcada no raw_payload e chat da conversa tem prioridade', () => {
  const r = normalizeTalkMessage(api({ chat_id: 'outro' }), TALK, RECEIVED);
  assert.ok(r.ok);
  assert.equal(r.value.kommo_chat_id, 'chat-A');
  assert.equal((r.value.raw_payload as Record<string, unknown>)._source, 'talk_messages_api');
});

test('summarizeTalkProbe não expõe texto nem nomes', () => {
  const out = summarizeTalkProbe([api(), seller('s', 11, 1793000100, 'segredo comercial')], [
    { external_id: 's', sender: 'seller', sender_id: '11', message_type: 'unavailable' },
  ]);
  const raw = JSON.stringify(out);
  assert.ok(!raw.includes('segredo'));
  assert.ok(!raw.includes('Maria'));
  assert.ok(!raw.includes('Vendedor 11'));
  assert.equal(out.outgoing_with_text, 1);
  assert.equal(out.incoming_with_text, 1);
  assert.deepEqual(out.internal_user_ids, [11]);
  assert.deepEqual(out.by_origin, { 'com.amocrm.amocrmwa': 2 });
  assert.equal(out.db.api_outgoing_matching_placeholders, 1);
  assert.deepEqual(out.db.seller_user_id_vs_placeholder_created_by, { match: 1, differ: 0 });
});

test('autor identificado: vendedor só com user_id; bot e cliente sim; desconhecido não', () => {
  assert.equal(talkMessageAuthorIdentified(seller('a', 11, 1793000000)), true);
  assert.equal(talkMessageAuthorIdentified(api({ type: 'outgoing', author: { id: 'x', type: 'internal' } })), false);
  assert.equal(talkMessageAuthorIdentified(api({ type: 'outgoing', author: { id: 'b', type: 'bot' } })), true);
  assert.equal(talkMessageAuthorIdentified(api({ type: 'outgoing', author: undefined })), false);
  assert.equal(talkMessageAuthorIdentified(api()), true);
});

test('message_type "text" com texto vazio e anexo usa o tipo do anexo', () => {
  const r = normalizeTalkMessage(api({ message_type: 'text', text: '', attachment: { type: 'file', link: 'l', file_name: 'nota.pdf' } }), TALK, RECEIVED);
  assert.ok(r.ok);
  assert.equal(r.value.message_type, 'file');
});

test('marcadores não provam o espaço de ids: bater só com marcador não evita a checagem', () => {
  const plan = planTalkIngest(
    [api({ id: 'ph-1', type: 'outgoing' }), api({ id: 'api-c1' })],
    [
      { external_id: 'ph-1', message_type: 'unavailable' },
      { external_id: 'webhook-c1', message_type: 'text' }, // real no intervalo, id diferente
    ]
  );
  assert.equal(plan.idMismatch, true);
});
