import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { AuthShell } from '../components/brand/AuthShell';
import { LoginIntro } from '../components/brand/LoginIntro';
import './Login.css';

export function Login() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Entrada da marca: roda uma vez por montagem da rota (erros e novas tentativas não a repetem).
  const [introDone, setIntroDone] = useState(false);
  // Fim da entrada: devolve o foco ao e-mail no desktop (no celular não abre o teclado sozinho).
  useEffect(() => {
    if (!introDone || window.matchMedia?.('(pointer: coarse)').matches) return;
    document.getElementById('email')?.focus({ preventScroll: true });
  }, [introDone]);

  if (!loading && session) {
    const from = (location.state as { from?: Location })?.from?.pathname || '/';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setSubmitting(false);
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setError('Email ou senha incorretos. Verifique se digitou corretamente.');
        } else if (/banned/i.test(error.message)) {
          setError('Acesso desativado. Fale com a gestão da loja.');
        } else if (error.message.includes('Email not confirmed')) {
          setError('Email não confirmado no Supabase. Habilite "Auto Confirm" no painel.');
        } else {
          setError(`Erro ao autenticar: ${error.message}`);
        }
      }
    } catch (err: any) {
      setSubmitting(false);
      setError(err?.message || 'Erro de conexão com o Supabase.');
    }
  };

  return (
    <>
    {!introDone && (
      <LoginIntro
        onDone={() => setIntroDone(true)}
      />
    )}
    <AuthShell animatedBackdrop cardState={introDone ? undefined : 'waiting'}>
        <div className="access-screen">
          <h1 className="access-screen-title">Acesse o sistema</h1>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          {!isSupabaseConfigured && (
            <div className="login-error">
              Sistema sem configuração do Supabase. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas
              variáveis de ambiente (na Vercel: Settings → Environment Variables) e faça um novo deploy.
            </div>
          )}
          {error && <div className="login-error" role="alert">{error}</div>}
          <div className="login-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seuemail@exemplo.com"
              required
            />
          </div>
          <div className="login-field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              required
            />
          </div>
          <button type="submit" className="btn-primary login-submit" disabled={submitting || !isSupabaseConfigured}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
    </AuthShell>
    </>
  );
}


