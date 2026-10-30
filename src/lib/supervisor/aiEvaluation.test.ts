// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ATTRIBUTION_RULE_VERSION, buildEvaluationTargets, type EvaluationMessage } from './aiEvaluation.ts';
import { buildAnalysisTranscript } from './aiCriteria.ts';
import { classifyConversations, type PeriodConversation } from './metrics.ts';

const EMERSON = '11336555';
const CAROLINE = '15815704';
const YASMIN = '111';
const KAREN = '222';
const sellers = new Map([
  [CAROLINE, 'seller-caroline'],
  [YASMIN, 'seller-yasmin'],
  [KAREN, 'seller-karen'],
]);
const DAY = { from: '2026-10-28T03:00:00.000Z', to: '2026-10-29T03:00:00.000Z' };

let n = 0;
function msg(sender: EvaluationMessage['sender'], hour: number, extra: Partial<EvaluationMessage> = {}, conversation_id = 'c1'): EvaluationMessage {
  n += 1;
  return { id: `m${n}`, conversation_id, sender, sent_at: `2026-10-28T${String(hour).padStart(2, '0')}:00:00.000Z`, received_seq: n, message_type: 'text', ...extra };
}
const by = (id: string, hour: number, c = 'c1') => msg('seller', hour, { sender_id: id, sender_name: 'x' }, c);

test('1. um vendedor identificado: um alvo, só com as mensagens dele', () => {
  const ms = [msg('client', 12), by(YASMIN, 13), msg('client', 14), by(YASMIN, 15)];
  const [t, ...rest] = buildEvaluationTargets('c1', ms, DAY, sellers);
  assert.equal(rest.length, 0);
  assert.equal(t.kommoUserId, YASMIN);
  assert.equal(t.sellerId, 'seller-yasmin');
  assert.equal(t.eligible, true);
  assert.deepEqual(t.ownMessageIds, [ms[1].id, ms[3].id]);
  assert.deepEqual(t.contextMessageIds, ms.map((m) => m.id));
  assert.equal(t.attribution, 'autor_da_mensagem');
  assert.equal(t.ruleVersion, ATTRIBUTION_RULE_VERSION);
});

test('2. vários vendedores: um alvo por participante, cada um com as próprias mensagens', () => {
  const ms = [msg('client', 10), by(CAROLINE, 11), msg('client', 12), by(YASMIN, 13), by(KAREN, 14)];
  const targets = buildEvaluationTargets('c1', ms, DAY, sellers);
  assert.deepEqual(targets.map((t) => t.kommoUserId), [CAROLINE, YASMIN, KAREN]);
  for (const t of targets) {
    assert.deepEqual(t.ownMessageIds, ms.filter((m) => m.sender_id === t.kommoUserId).map((m) => m.id));
    assert.deepEqual(t.otherParticipants.map((p) => p.kommoUserId).sort(), [CAROLINE, YASMIN, KAREN].filter((k) => k !== t.kommoUserId).sort());
  }
});

test('3. lead do Emerson atendido pela Caroline: avaliada é a Caroline; Emerson não', () => {
  // O responsável do lead nem é entrada da função: não há como ele virar avaliado.
  const ms = [msg('client', 10), by(CAROLINE, 11)];
  const targets = buildEvaluationTargets('c1', ms, DAY, sellers);
  assert.deepEqual(targets.map((t) => t.kommoUserId), [CAROLINE]);
  // Se o Emerson de fato enviar mensagem humana, aparece — mas sem vendedor vinculado não é elegível.
  const withEmerson = buildEvaluationTargets('c1', [...ms, by(EMERSON, 12)], DAY, sellers);
  const em = withEmerson.find((t) => t.kommoUserId === EMERSON)!;
  assert.equal(em.eligible, false);
  assert.equal(em.ineligibleReason, 'Usuário do Kommo sem vendedor vinculado');
});

test('4. só mensagens automáticas: nenhum alvo; robô nunca vira vendedor', () => {
  const ms = [msg('client', 10), msg('bot', 10, { sender_name: 'Salesbot' }), msg('bot', 11, { sender_name: 'Instagram', template: true })];
  assert.deepEqual(buildEvaluationTargets('c1', ms, DAY, sellers), []);
  const mixed = buildEvaluationTargets('c1', [...ms, by(KAREN, 12)], DAY, sellers);
  assert.equal(mixed[0].automaticMessages, 2);
  assert.deepEqual(mixed[0].ownMessageIds, [mixed[0].contextMessageIds.at(-1)]);
});

test('5. sem autor identificado (aparelho ou marcador): nenhum alvo, nada atribuído a ninguém', () => {
  const ms = [
    msg('client', 10),
    msg('bot', 11, { sender_name: 'WhatsApp Lite' }),
    msg('bot', 12, { sender_name: 'Automação ou envio externo', message_type: 'unavailable' }),
    msg('seller', 13, { sender_id: null, sender_name: 'Emerson' }),
  ];
  assert.deepEqual(buildEvaluationTargets('c1', ms, DAY, sellers), []);
  const t = buildEvaluationTargets('c1', [...ms, by(CAROLINE, 14)], DAY, sellers)[0];
  assert.equal(t.unidentifiedHumanMessages, 2);
  assert.equal(t.unknownAuthorMessages, 1);
  assert.deepEqual(t.ownMessageIds, [t.contextMessageIds.at(-1)]);
});

test('6. troca de responsável do lead não muda quem é avaliado', () => {
  const conv = (lead: string): PeriodConversation => ({
    id: 'c1', seller_id: null, client_name: 'x', occurred_at: DAY.from, messages_count: 0, origin: null, score: null, summary: null, kommo_lead_id: lead,
  });
  const ms = [msg('client', 10), by(CAROLINE, 11)];
  const linked = new Set(sellers.keys());
  const a = classifyConversations([conv('L1')], ms, DAY.to, { linkedKommoUsers: linked, responsibleByLead: new Map([['L1', EMERSON]]) });
  const b = classifyConversations([conv('L1')], ms, DAY.to, { linkedKommoUsers: linked, responsibleByLead: new Map([['L1', YASMIN]]) });
  assert.deepEqual(a.get('c1')!.attendants, b.get('c1')!.attendants);
  assert.deepEqual(buildEvaluationTargets('c1', ms, DAY, sellers).map((t) => t.kommoUserId), [CAROLINE]);
});

test('7 e 8. resposta do dia seguinte e mensagens fora do período não entram', () => {
  const before = msg('seller', 2, { sender_id: KAREN }); // 27/10 23:00 BRT
  const nextDay = { ...by(YASMIN, 0), sent_at: '2026-10-29T12:00:00.000Z' };
  const ms = [before, msg('client', 12), by(CAROLINE, 13), nextDay];
  const targets = buildEvaluationTargets('c1', ms, DAY, sellers);
  assert.deepEqual(targets.map((t) => t.kommoUserId), [CAROLINE]);
  assert.equal(targets[0].contextMessageIds.includes(nextDay.id), false);
  assert.equal(targets[0].contextMessageIds.includes(before.id), false);
  assert.deepEqual(targets[0].period, DAY);
});

test('9. sem duplicidade: mensagem repetida conta uma vez; um alvo por pessoa; outra conversa não mistura', () => {
  const a = by(YASMIN, 13);
  const ms = [msg('client', 12), a, { ...a }, by(YASMIN, 14), by(KAREN, 15, 'c2')];
  const targets = buildEvaluationTargets('c1', ms, DAY, sellers);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].ownMessageIds.length, 2);
  assert.equal(new Set(targets[0].contextMessageIds).size, targets[0].contextMessageIds.length);
  assert.equal(targets[0].contextMessageIds.length, 3);
});

test('10. compatível com o Meu Supervisor: mesmos atendentes de classifyConversations', () => {
  const ms = [msg('client', 10), by(CAROLINE, 11), by(EMERSON, 12), msg('bot', 13, { sender_name: 'Salesbot' }), by(KAREN, 14)];
  const conv: PeriodConversation = { id: 'c1', seller_id: 'x', client_name: 'x', occurred_at: DAY.from, messages_count: 0, origin: null, score: null, summary: null, kommo_lead_id: null };
  const sup = classifyConversations([conv], ms, DAY.to, { linkedKommoUsers: new Set(sellers.keys()) }).get('c1')!;
  const ai = buildEvaluationTargets('c1', ms, DAY, sellers);
  assert.deepEqual(ai.map((t) => [t.kommoUserId, t.ownMessageIds.length]), sup.attendants.map((a) => [a.kommoUserId, a.messages]));
});

test('transcrição para o avaliado: separa avaliado, outros atendentes, robô e envio sem autor', () => {
  const t = buildAnalysisTranscript(
    [
      { sender: 'client', sender_name: 'Maria', message: 'Oi', message_type: 'text', sent_at: '2026-10-28T12:00:00Z' },
      { sender: 'bot', sender_name: 'Salesbot', message: 'Olá!', message_type: 'text', sent_at: '2026-10-28T12:00:10Z' },
      { sender: 'seller', sender_id: CAROLINE, sender_name: 'Carol', message: 'Bom dia', message_type: 'text', sent_at: '2026-10-28T12:01:00Z' },
      { sender: 'seller', sender_id: YASMIN, sender_name: 'Yas', message: 'Continuo', message_type: 'text', sent_at: '2026-10-28T12:02:00Z' },
      { sender: 'bot', sender_name: 'WhatsApp Lite', message: 'ok', message_type: 'text', sent_at: '2026-10-28T12:03:00Z' },
    ],
    { evaluatedKommoUserId: CAROLINE, nameOf: (id) => (id === CAROLINE ? 'CAROLINE' : 'YASMIN') }
  );
  assert.deepEqual(t.split('\n').map((l) => l.replace(/^\[[^\]]+\] /, '').split(':')[0]), [
    'Cliente',
    'Robô (Salesbot)',
    'Vendedor avaliado (CAROLINE)',
    'Outro atendente (YASMIN)',
    'Atendente não identificado (enviado pelo aparelho)',
  ]);
});

test('Análise IA desativada: o código de avaliação não chama IA, rede nem Edge Function', () => {
  const files = ['aiEvaluation.ts', 'aiCriteria.ts', '../../pages/supervisor/SupervisorAiAnalysis.tsx'];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const forbidden of ['functions.invoke', 'fetch(', 'anthropic', 'openai', '/v1/messages', 'XMLHttpRequest']) {
      assert.equal(src.toLowerCase().includes(forbidden.toLowerCase()), false, `${f} contém "${forbidden}"`);
    }
  }
  // As funções de preparação são puras: não importam o cliente do banco.
  for (const f of ['aiEvaluation.ts', 'aiCriteria.ts']) {
    assert.equal(/supabaseClient|supabase-js/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), false, f);
  }
});
