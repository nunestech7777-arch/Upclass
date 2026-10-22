import React, { Component, type ErrorInfo, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './pages/Login.css';
import './components/brand/AuthShell.css';
import logoPhoneLight from './assets/brand/upclass/logo-phone-light.png';
import App from './App.tsx';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="login-page" role="alert">
          <div className="login-backdrop" aria-hidden="true" />
          <main className="login-card">
            <img src={logoPhoneLight} alt="Upclass Phone" className="login-logo" />
            <div className="access-screen">
              <h1 className="access-screen-title">Não foi possível carregar esta tela</h1>
              <p className="access-screen-text">
                {this.state.error?.message || 'Ocorreu um erro inesperado ao renderizar a tela.'}
              </p>
            </div>
            <button type="button" className="btn-primary login-submit" onClick={() => window.location.reload()}>
              Recarregar página
            </button>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);


if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Falha ao registrar o service worker:', error);
    });
  });
}
