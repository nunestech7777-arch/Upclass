import React from 'react';
import { BrandLogo } from './BrandLogo';
import './AuthShell.css';

/**
 * Casca das telas de acesso (login, definir senha, verificação e bloqueio).
 * Fundo oficial Upclass com camada escura por cima; cartão sólido e legível.
 */
export function AuthShell({
  children,
  role,
  ariaLive,
  animatedBackdrop = false,
  cardState,
}: {
  children: React.ReactNode;
  role?: string;
  ariaLive?: 'polite';
  /** Só o login: fundo com brilhos em movimento lento (estilos em Login.css). */
  animatedBackdrop?: boolean;
  /** Só o login: cartão oculto e inerte durante a entrada da marca, depois revelado. */
  cardState?: 'waiting';
}) {
  return (
    <div className="login-page">
      {animatedBackdrop ? (
        <div className="login-backdrop is-animated" aria-hidden="true">
          <span className="login-glow login-glow-magenta" />
          <span className="login-glow login-glow-blue" />
          <span className="login-glow login-glow-cyan" />
          <span className="login-veil" />
        </div>
      ) : (
        <div className="login-backdrop" aria-hidden="true" />
      )}
      <main
        className={`login-card${cardState ? ` is-${cardState}` : ''}`}
        role={role}
        aria-live={ariaLive}
        inert={cardState === 'waiting' ? true : undefined}
      >
        <BrandLogo variant="phone" on="dark" className="login-logo" />
        {children}
      </main>
      <p className="login-footnote">Upclass Phone · Sistema interno de gestão</p>
    </div>
  );
}
