import React from 'react';
import { AlertTriangle, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { channelOf, originLabel } from '../../lib/supervisor/channels';
import { EmptyState } from '../finance/FinancePrimitives';

export { EmptyState };

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
}: {
  title: string;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`sv-panel ${className}`}>
      <header className="sv-panel-head">
        <div>
          {eyebrow && <span className="sv-panel-eyebrow">{eyebrow}</span>}
          <h2 className="sv-panel-title">{title}</h2>
        </div>
        {actions && <div className="sv-panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function LoadingBlock({ label = 'Carregando dados reais do Kommo…' }: { label?: string }) {
  return (
    <div className="sv-loading" role="status">
      <Loader2 size={18} className="fin-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="sv-error" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div>
        <strong>Não foi possível carregar os dados.</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="sv-btn" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" /> Tentar de novo
        </button>
      )}
    </div>
  );
}

/** Selo do canal; o texto completo (WhatsApp Business / Lite) fica no title. */
export function ChannelBadge({ origin, compact = false }: { origin: string | null; compact?: boolean }) {
  const channel = channelOf(origin);
  const label = originLabel(origin);
  return (
    <span className={`sv-channel sv-channel-${channel}`} title={label}>
      {channel === 'instagram' ? <InstagramGlyph /> : <MessageCircle size={12} aria-hidden="true" />}
      {!compact && <span>{channel === 'whatsapp' ? 'WhatsApp' : channel === 'instagram' ? 'Instagram' : label}</span>}
    </span>
  );
}

/** O lucide-react desta versão não tem o ícone do Instagram (marca); um contorno simples basta. */
function InstagramGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function NotActiveTag({ children = 'Aguardando Supervisor IA' }: { children?: React.ReactNode }) {
  return <span className="sv-tag-muted">{children}</span>;
}
