import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { AuthShell } from '../components/brand/AuthShell';
import './Login.css';

const MIN_LENGTH = 8;

/**
 * Definir/alterar a própria senha. Destino do convite e do link de nova senha enviados pela gestão
 * (o Supabase Auth abre a sessão pelo link). A senha vai direto ao Supabase Auth — nunca é gravada
 * pelo sistema.
 */
export function SetPassword() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) return setError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
    if (password !== confirm) return setError('As senhas não conferem.');
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(/different from the old/i.test(updateError.message) ? 'A nova senha precisa ser diferente da atual.' : `Não foi possível salvar a senha: ${updateError.message}`);
      return;
    }
    setDone(true);
    setTimeout(() => navigate('/', { replace: true }), 1200);
  };

  return (
    <AuthShell>
        <div className="access-screen">
          <h1 className="access-screen-title">Defina sua senha</h1>
          <p className="access-screen-text">{user?.email ? `Conta ${user.email}` : 'Crie a senha de acesso ao painel.'}</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          {error && <div className="login-error" role="alert">{error}</div>}
          {done && <div className="login-success" role="status">Senha salva! Abrindo o painel…</div>}
          <div className="login-field">
            <label htmlFor="new-password">Nova senha</label>
            <input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={MIN_LENGTH} />
          </div>
          <div className="login-field">
            <label htmlFor="confirm-password">Confirme a senha</label>
            <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={MIN_LENGTH} />
          </div>
          <p className="login-hint">Mínimo de {MIN_LENGTH} caracteres. Use uma senha só sua — ela não é compartilhada com a gestão.</p>
          <button type="submit" className="btn-primary login-submit" disabled={saving || done}>
            {saving ? 'Salvando…' : 'Salvar senha'}
          </button>
          <button type="button" className="access-screen-link" onClick={() => navigate('/', { replace: true })}>
            Voltar ao painel
          </button>
          <button type="button" className="access-screen-link" onClick={signOut}>
            Sair
          </button>
        </form>
    </AuthShell>
  );
}
