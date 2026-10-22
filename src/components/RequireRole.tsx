import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthShell } from './brand/AuthShell';
import '../pages/Login.css';

/**
 * Roteamento por papel. É só experiência de uso: a proteção real dos dados está no banco (RLS e
 * funções seller_portal_*) e nas Edge Functions, que conferem o papel pelo token.
 */

function FullPageSpinner() {
  return (
    <AuthShell role="status" ariaLive="polite">
      <div className="login-spinner" aria-hidden="true" />
      <p className="access-screen-text">Verificando seu acesso…</p>
    </AuthShell>
  );
}

export function AccessScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const { signOut, reloadAccess, user } = useAuth();
  return (
    <AuthShell>
        <div className="access-screen">
          <h1 className="access-screen-title">{title}</h1>
          <div className="access-screen-text">{children}</div>
          {user?.email && <p className="access-screen-email">Conectado como {user.email}</p>}
        </div>
        <div className="access-screen-actions">
          <button type="button" className="btn-primary login-submit" onClick={reloadAccess}>
            Tentar novamente
          </button>
          <button type="button" className="access-screen-link" onClick={signOut}>
            Sair desta conta
          </button>
        </div>
    </AuthShell>
  );
}

/** Mensagem para conta sem papel válido (ou desativada). */
function Blocked() {
  const { access, accessError } = useAuth();
  if (accessError) return <AccessScreen title="Não foi possível verificar seu acesso">{accessError}</AccessScreen>;
  if (access?.role === 'seller' && !access.enabled) {
    return <AccessScreen title="Acesso desativado">Seu acesso ao Painel do Vendedor está desativado. Fale com a gestão da loja.</AccessScreen>;
  }
  return (
    <AccessScreen title="Acesso não liberado">
      Nenhum vendedor está vinculado a esta conta. Peça à gestão da loja para liberar seu acesso em Configurações.
    </AccessScreen>
  );
}

/** Área administrativa: só administrador. Vendedor vai para o próprio painel. */
export function RequireAdmin() {
  const { access, accessLoading, accessError } = useAuth();
  if (accessLoading) return <FullPageSpinner />;
  if (!accessError && access?.role === 'admin' && access.enabled) return <Outlet />;
  if (!accessError && access?.role === 'seller' && access.enabled) return <Navigate to="/vendedor" replace />;
  return <Blocked />;
}

/** Painel do Vendedor: só conta de vendedor ativa e vinculada. */
export function RequireSeller() {
  const { access, accessLoading, accessError } = useAuth();
  if (accessLoading) return <FullPageSpinner />;
  if (!accessError && access?.role === 'seller' && access.enabled && access.sellerId) return <Outlet />;
  if (!accessError && access?.role === 'admin' && access.enabled) return <Navigate to="/" replace />;
  return <Blocked />;
}
