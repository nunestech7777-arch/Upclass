import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accessStatus, normalizeEmail, passwordProblem, planLink, safeRedirect, type AccessRow } from './sellerAccess.ts';

const seller = (user_id: string, seller_id: string, enabled = true): AccessRow => ({ user_id, role: 'seller', seller_id, enabled });
const admin: AccessRow = { user_id: 'u-admin', role: 'admin', seller_id: null, enabled: true };

describe('accessStatus', () => {
  it('sem vínculo, desativado, convite pendente e ativo', () => {
    assert.equal(accessStatus(null, null), 'none');
    assert.equal(accessStatus(seller('u1', 's1', false), { id: 'u1', email_confirmed_at: 'x', last_sign_in_at: 'x' }), 'disabled');
    assert.equal(accessStatus(seller('u1', 's1'), { id: 'u1', email_confirmed_at: null, last_sign_in_at: null }), 'invited');
    // Criada pelo admin com senha (confirmada, ainda sem login): ativa.
    assert.equal(accessStatus(seller('u1', 's1'), { id: 'u1', email_confirmed_at: 'x', last_sign_in_at: null }), 'active');
    assert.equal(accessStatus(seller('u1', 's1'), { id: 'u1', email_confirmed_at: 'x', last_sign_in_at: 'y' }), 'active');
    // Linha sem conta no Auth (conta apagada) não conta como acesso.
    assert.equal(accessStatus(seller('u1', 's1'), null), 'none');
  });
});

describe('planLink', () => {
  it('conta livre num vendedor sem login: vincula', () => {
    assert.deepEqual(planLink('s1', 'u1', null, null, false), { ok: true, noop: false, replaceUserId: null });
  });
  it('conta de administrador nunca vira vendedor', () => {
    const r = planLink('s1', 'u-admin', admin, null, true);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.conflict.code, 'admin_account');
  });
  it('conta já vinculada a outro vendedor: bloqueia com o nome dele, mesmo com replace', () => {
    const r = planLink('s1', 'u2', seller('u2', 's2'), null, true, (id) => (id === 's2' ? 'JULY' : id));
    assert.equal(!r.ok && r.conflict.code, 'account_linked_elsewhere');
    assert.match(!r.ok ? r.conflict.message : '', /JULY/);
  });
  it('vendedor que já tem outra conta: só troca com replace, desvinculando a anterior', () => {
    const blocked = planLink('s1', 'u3', null, seller('u1', 's1'), false);
    assert.equal(!blocked.ok && blocked.conflict.code, 'seller_has_login');
    assert.deepEqual(planLink('s1', 'u3', null, seller('u1', 's1'), true), { ok: true, noop: false, replaceUserId: 'u1' });
  });
  it('mesma conta no mesmo vendedor: nada a fazer', () => {
    assert.deepEqual(planLink('s1', 'u1', seller('u1', 's1'), seller('u1', 's1'), false), { ok: true, noop: true, replaceUserId: null });
  });
});

describe('normalizeEmail / safeRedirect', () => {
  it('normaliza e rejeita e-mails inválidos', () => {
    assert.equal(normalizeEmail('  Carol@Loja.COM '), 'carol@loja.com');
    assert.equal(normalizeEmail('carol'), null);
    assert.equal(normalizeEmail('a b@c.d'), null);
  });
  it('redirecionamento só para a própria origem', () => {
    assert.equal(safeRedirect('https://painel.loja.com/definir-senha', 'https://painel.loja.com'), 'https://painel.loja.com/definir-senha');
    assert.equal(safeRedirect('https://evil.com/definir-senha', 'https://painel.loja.com'), undefined);
    assert.equal(safeRedirect('https://painel.loja.com/x', null), undefined);
    assert.equal(safeRedirect('javascript:alert(1)', 'https://painel.loja.com'), undefined);
  });
});

describe('passwordProblem', () => {
  it('exige 8+ caracteres, sem espaço nas pontas, até 72', () => {
    assert.equal(passwordProblem('Loja2026!'), null);
    assert.match(passwordProblem('1234567') ?? '', /8 caracteres/);
    assert.match(passwordProblem(' senha123') ?? '', /espaço/);
    assert.match(passwordProblem('x'.repeat(73)) ?? '', /72/);
    assert.match(passwordProblem(undefined) ?? '', /Informe/);
  });
});
