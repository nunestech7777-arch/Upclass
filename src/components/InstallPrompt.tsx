import React, { useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';
import { installMode, type InstallMode } from '../lib/installPrompt';
import './InstallPrompt.css';

const DISMISS_KEY = 'upclass-install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// O evento pode chegar antes do React montar: guarda desde o carregamento do módulo.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const wasDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Aviso "Instalar o Upclass" (ver lib/installPrompt.ts): instruções no iPhone/iPad e botão de
 * instalação nativa no Android. Some no app instalado e até a próxima visita depois de "Entendi".
 */
export function InstallPrompt() {
  const compute = (): InstallMode =>
    installMode({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      standalone: isStandalone(),
      nativeAvailable: deferredPrompt != null,
      dismissed: wasDismissed(),
    });
  const [mode, setMode] = useState<InstallMode>(null);

  useEffect(() => {
    // Pequeno atraso: o aviso entra depois que a tela já carregou.
    const timer = window.setTimeout(() => setMode(compute()), 1200);
    const update = () => setMode(compute());
    listeners.add(update);
    return () => {
      window.clearTimeout(timer);
      listeners.delete(update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // modo privado: só esconde agora
    }
    setMode(null);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    setMode(null);
  };

  return (
    <div className="install-prompt" role="dialog" aria-label="Instalar o Upclass">
      <img className="install-prompt-icon" src="/apple-touch-icon.png?v=3" alt="" width={56} height={56} />
      <div className="install-prompt-text">
        <strong>Instalar o Upclass</strong>
        {mode === 'ios' ? (
          <span>
            Toque em <Share size={16} className="install-prompt-share" aria-label="Compartilhar" /> <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
          </span>
        ) : (
          <span>Use o sistema como um app, direto da tela inicial.</span>
        )}
      </div>
      {mode === 'ios' ? (
        <button type="button" className="install-prompt-btn" onClick={dismiss}>
          Entendi
        </button>
      ) : (
        <div className="install-prompt-actions">
          <button type="button" className="install-prompt-btn is-primary" onClick={install}>
            Instalar
          </button>
          <button type="button" className="install-prompt-close" onClick={dismiss} aria-label="Agora não">
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
