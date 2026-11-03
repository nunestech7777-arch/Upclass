import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info, MinusCircle, TrendingDown } from 'lucide-react';
import type { PaceStatus } from '../../lib/finance/calc';
import { pct } from '../../lib/finance/format';
import { AnimatedText, CountUpValue } from '../ui/AnimatedNumber';
import { AnimatedBar } from '../ui/AnimatedBar';
import { useCardLink } from '../ui/useCardLink';
import type { To } from 'react-router-dom';

/** Preenchimento limitado a 100% (animado, padrão do Dashboard); o texto ao lado mostra o valor real. */
export function ProgressBar({ value, tone }: { value: number | null; tone: 'profit' | 'goal' | 'worst' | 'deficit' | 'warn' }) {
  return (
    <span className="fin-progress" aria-hidden="true">
      <AnimatedBar className={`fin-progress-fill tone-${tone}`} pct={value} />
    </span>
  );
}

export function PctWithBar({ value, tone, label }: { value: number | null; tone: 'profit' | 'goal' | 'worst' | 'deficit' | 'warn'; label?: string }) {
  if (value == null) return <span className="fin-muted">Sem meta</span>;
  return (
    <span className="fin-pct-cell">
      <span className={`fin-pct-text tone-${tone}`}>
        <AnimatedText text={label ?? pct(value)} />
      </span>
      <ProgressBar value={value} tone={tone} />
    </span>
  );
}

export function SectionEyebrow({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="fin-eyebrow">
      {icon}
      {children}
    </span>
  );
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone: 'profit' | 'goal' | 'worst' | 'deficit' | 'warn' | 'neutral';
  caption?: React.ReactNode;
  progress?: number | null;
  highlight?: boolean;
  badge?: string;
  /** Destino do detalhamento (card navegável, ver cardLinks.ts); sem ele o card não é clicável. */
  to?: To | null;
}

export function KpiCard({ label, value, icon, tone, caption, progress, highlight, badge, to }: KpiCardProps) {
  // Sem aria-label: o leitor de tela lê o próprio conteúdo do card (rótulo e valor) como nome do link.
  const link = useCardLink(to);
  return (
    <div className={`fin-kpi ${highlight ? 'is-highlight' : ''} tone-${tone}`} {...link}>
      <div className="fin-kpi-head">
        <span className="fin-kpi-label">{label}</span>
        <span className={`fin-kpi-icon tone-${tone}`}>{icon}</span>
      </div>
      <span className={`fin-kpi-value tone-${tone}`}>
        <CountUpValue value={value} />
      </span>
      {badge && <span className="fin-badge-partial">{badge}</span>}
      {caption && <span className="fin-kpi-caption">{caption}</span>}
      {progress !== undefined && <ProgressBar value={progress} tone={tone === 'neutral' ? 'goal' : tone} />}
    </div>
  );
}

const PACE_LABEL: Record<PaceStatus, { text: string; icon: React.ReactNode; cls: string }> = {
  on_pace: { text: 'No ritmo', icon: <CheckCircle2 size={13} />, cls: 'tone-profit' },
  below_pace: { text: 'Abaixo do ritmo', icon: <TrendingDown size={13} />, cls: 'tone-deficit' },
  in_progress: { text: 'Em andamento', icon: <Clock size={13} />, cls: 'tone-goal' },
  future: { text: '—', icon: null, cls: 'fin-muted' },
  no_goal: { text: 'Sem meta', icon: <MinusCircle size={13} />, cls: 'fin-muted' },
  partial: { text: 'Dados parciais', icon: <AlertTriangle size={13} />, cls: 'tone-warn' },
};

export function PaceLabel({ status }: { status: PaceStatus }) {
  const p = PACE_LABEL[status];
  return (
    <span className={`fin-status ${p.cls}`}>
      {p.icon}
      {p.text}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="fin-empty">
      <Info size={18} />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

