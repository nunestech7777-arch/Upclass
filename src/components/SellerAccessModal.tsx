import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Link2, Loader2, RefreshCw, Send, Unlink, UserPlus, X } from 'lucide-react';
import { SellerAvatar } from './SellerAvatar';
import { ACCESS_STATUS_LABELS, AccessApiError, accessStatusOf, sellerAccessApi, type AccessStatus, type SellerLogin } from '../lib/accessApi';
import { formatInstantBR } from '../lib/finance/dates';
import type { Seller } from '../lib/database.types';
import './ConversationSummaryModal.css';
import './SellerPhotoModal.css';
import './SellerAccessModal.css';

type Mode = 'idle' | 'create' | 'invite' | 'link' | 'relink' | 'password';

const MIN_PASSWORD = 8;

export function AccessBadge({ status }: { status: AccessStatus }) {
  return <span className={`access-badge is-${status}`}>{ACCESS_STATUS_LABELS[status]}</span>;
}

/**
 * Gerenciar acesso de UM vendedor já cadastrado: criar o login com senha definida pelo
 * administrador (ou por convite), vincular conta existente, trocar a conta, definir nova senha,
 * desvincular, ativar/desativar e reenviar convite. A senha vai direto ao Supabase Auth. Tudo passa pela function seller-access
 * (o navegador não grava papel nem vínculo). Não mexe na foto nem no botão "Oculto" do ranking.
 */
export function SellerAccessModal({
  seller,
  login,
  onClose,
  onChanged,
}: {
  seller: Seller;
  login: SellerLogin | undefined;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const status = accessStatusOf(login);
  const [mode, setMode] = useState<Mode>('idle');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    setSuccess(null);
    try {
      await fn();
      setSuccess(ok);
      setMode('idle');
      setEmail('');
      setPassword('');
      setConfirm('');
      await onChanged();
    } catch (err) {
      const e = err as AccessApiError;
      setErrorCode(e.code ?? null);
      setError(
        e.code === 'not_deployed'
          ? 'A function seller-access ainda não foi publicada no Supabase.'
          : e.message || 'Não foi possível concluir a operação.'
      );
    } finally {
      setBusy(false);
    }
  };

  const needsEmail = mode === 'create' || mode === 'invite' || mode === 'link' || mode === 'relink';
  const needsPassword = mode === 'create' || mode === 'password';
  const passwordError =
    needsPassword && password && password.length < MIN_PASSWORD
      ? `Mínimo de ${MIN_PASSWORD} caracteres.`
      : needsPassword && confirm && password !== confirm
        ? 'As senhas não conferem.'
        : null;

  const openMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setSuccess(null);
    setPassword('');
    setConfirm('');
    setShowPassword(false);
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (needsPassword && (password.length < MIN_PASSWORD || password !== confirm)) {
      setError(password.length < MIN_PASSWORD ? `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` : 'As senhas não conferem.');
      return;
    }
    if (mode === 'password') {
      run(() => sellerAccessApi.setPassword(seller.id, password), `Nova senha definida para ${seller.name}. Informe a senha ao vendedor pessoalmente.`);
      return;
    }
    if (!value) return;
    if (mode === 'create') run(() => sellerAccessApi.create(seller.id, value, password), `Acesso criado: ${seller.name} já pode entrar com ${value} e a senha definida.`);
    if (mode === 'invite') run(() => sellerAccessApi.invite(seller.id, value), `Convite enviado para ${value}. O vendedor define a própria senha pelo link do e-mail.`);
    if (mode === 'link') run(() => sellerAccessApi.link(seller.id, value), `Conta ${value} vinculada a ${seller.name}.`);
    if (mode === 'relink') {
      if (!window.confirm(`Trocar a conta de ${seller.name} para ${value}? A conta atual (${login?.email ?? '—'}) perde o acesso.`)) return;
      run(() => sellerAccessApi.link(seller.id, value, true), `Vínculo alterado: ${seller.name} agora entra com ${value}.`);
    }
  };

  const unlink = () => {
    if (!window.confirm(`Desvincular a conta ${login?.email ?? ''} de ${seller.name}? O login deixa de acessar o painel. Vendas, metas e histórico NÃO são apagados.`)) return;
    run(() => sellerAccessApi.unlink(seller.id), 'Conta desvinculada. Nenhum dado comercial foi apagado.');
  };

  const toggleEnabled = () => {
    const next = !login?.enabled;
    if (!next && !window.confirm(`Desativar o acesso de ${seller.name}? O vendedor perde o acesso na hora. O ranking não é alterado.`)) return;
    run(() => sellerAccessApi.setEnabled(seller.id, next), next ? 'Acesso ativado.' : 'Acesso desativado.');
  };

  const resend = () =>
    run(async () => {
      const r = await sellerAccessApi.resend(seller.id);
      return r;
    }, 'Convite reenviado.');

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="seller-photo-modal access-modal" role="dialog" aria-modal="true" aria-label={`Gerenciar acesso de ${seller.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="seller-photo-modal-header">
          <div>
            <h3 className="seller-photo-modal-title">Gerenciar acesso</h3>
            <p className="text-muted text-sm">Login individual do Painel do Vendedor</p>
          </div>
          <button ref={closeRef} className="modal-close-btn" onClick={onClose} aria-label="Fechar" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="seller-photo-modal-body access-modal-body">
          <div className="access-identity">
            <SellerAvatar name={seller.name} photoUrl={seller.photo_url} size="lg" />
            <div className="access-identity-text">
              <strong>{seller.name}</strong>
              <span className="text-muted text-sm">ID no MercadoPhone: {seller.external_id ?? 'não informado'}</span>
              <AccessBadge status={status} />
            </div>
          </div>

          <dl className="access-details">
            <div>
              <dt>E-mail da conta</dt>
              <dd>{login?.email ?? 'Nenhum login vinculado a este vendedor.'}</dd>
            </div>
            {login && (
              <>
                <div>
                  <dt>Último acesso</dt>
                  <dd>{login.last_sign_in_at ? formatInstantBR(login.last_sign_in_at) : 'Nunca entrou'}</dd>
                </div>
                <div>
                  <dt>Acesso criado</dt>
                  <dd>
                    {formatInstantBR(login.created_at)}
                    {login.created_by_email ? ` · por ${login.created_by_email}` : ''}
                  </dd>
                </div>
                {login.updated_by_email && login.updated_at !== login.created_at && (
                  <div>
                    <dt>Última alteração</dt>
                    <dd>
                      {formatInstantBR(login.updated_at)} · por {login.updated_by_email}
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>

          {error && (
            <div className="seller-photo-alert error" role="alert">
              <AlertCircle size={16} />
              <span>
                {error}
                {errorCode === 'account_exists' && (
                  <>
                    {' '}
                    <button type="button" className="access-inline-link" onClick={() => openMode('link')}>
                      Vincular esta conta
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
          {success && (
            <div className="seller-photo-alert success" role="status">
              <CheckCircle2 size={16} />
              <span>{success}</span>
            </div>
          )}

          {mode !== 'idle' ? (
            <form className="access-form" onSubmit={submitEmail}>
              {needsEmail && (
                <>
                  <label htmlFor="access-email">
                    {mode === 'invite' ? 'E-mail do vendedor (receberá o convite)' : mode === 'create' ? 'E-mail de login do vendedor' : mode === 'link' ? 'E-mail da conta existente' : 'E-mail da nova conta'}
                  </label>
                  <input
                    id="access-email"
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vendedor@email.com"
                    required
                    autoFocus
                  />
                </>
              )}
              {needsPassword && (
                <>
                  <label htmlFor="access-password">{mode === 'password' ? 'Nova senha' : 'Senha'}</label>
                  <div className="access-password">
                    <input
                      id="access-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={MIN_PASSWORD}
                      required
                      autoFocus={mode === 'password'}
                    />
                    <button type="button" className="access-eye" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <label htmlFor="access-confirm">Confirme a senha</label>
                  <input
                    id="access-confirm"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    minLength={MIN_PASSWORD}
                    required
                  />
                  {passwordError && <p className="access-field-error">{passwordError}</p>}
                </>
              )}
              <p className="text-muted text-xs">
                {mode === 'create'
                  ? `Mínimo de ${MIN_PASSWORD} caracteres. A conta já fica ativa; entregue o e-mail e a senha ao vendedor pessoalmente. Ele pode trocar a senha depois, pelo ícone de chave no painel.`
                  : mode === 'password'
                    ? `Mínimo de ${MIN_PASSWORD} caracteres. A senha anterior deixa de funcionar.`
                    : mode === 'invite'
                      ? 'O Supabase envia um convite por e-mail e o vendedor cria a própria senha.'
                      : 'A conta precisa já existir no sistema. Contas de administrador ou já vinculadas a outro vendedor são bloqueadas.'}
              </p>
              <div className="access-form-actions">
                <button type="button" className="btn-secondary" onClick={() => openMode('idle')} disabled={busy}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? <Loader2 size={16} className="spin" /> : null}
                  {mode === 'create' ? 'Criar acesso' : mode === 'password' ? 'Salvar nova senha' : mode === 'invite' ? 'Enviar convite' : mode === 'link' ? 'Vincular' : 'Alterar vínculo'}
                </button>
              </div>
            </form>
          ) : (
            <div className="access-actions">
              {!login ? (
                <>
                  <button type="button" className="btn-primary" onClick={() => openMode('create')} disabled={busy}>
                    <UserPlus size={16} /> Criar acesso (e-mail e senha)
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => openMode('link')} disabled={busy}>
                    <Link2 size={16} /> Vincular conta existente
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => openMode('invite')} disabled={busy}>
                    <Send size={16} /> Enviar convite por e-mail
                  </button>
                </>
              ) : (
                <>
                  <div className="access-toggle-row">
                    <div>
                      <strong>Acesso {login.enabled ? 'ativado' : 'desativado'}</strong>
                      <p className="text-muted text-xs">Independente do botão “Oculto” do ranking.</p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleEnabled}
                      disabled={busy}
                      className="access-switch"
                      role="switch"
                      aria-checked={login.enabled}
                      aria-label={login.enabled ? 'Desativar acesso' : 'Ativar acesso'}
                    >
                      <span />
                    </button>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => openMode('password')} disabled={busy}>
                    <KeyRound size={16} /> Definir nova senha
                  </button>
                  {login.enabled && status === 'invited' && (
                    <button type="button" className="btn-secondary" onClick={resend} disabled={busy}>
                      <RefreshCw size={16} /> Reenviar convite
                    </button>
                  )}
                  <button type="button" className="btn-secondary" onClick={() => openMode('relink')} disabled={busy}>
                    <Link2 size={16} /> Alterar vínculo
                  </button>
                  <button type="button" className="btn-danger-outline" onClick={unlink} disabled={busy}>
                    <Unlink size={16} /> Desvincular conta
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
