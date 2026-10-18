import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, Info, MinusCircle, TrendingDown } from 'lucide-react';
import type { Coverage, PaceStatus } from '../../lib/finance/calc';
import { brl, int, pct } from '../../lib/finance/format';
import { dayLabel } from '../../lib/finance/dates';

/** Preenchimento limitado a 100%; o texto ao lado mostra o valor real. */
export function ProgressBar({ value, tone }: { value: number | null; tone: 'profit' | 'goal' | 'worst' | 'deficit' | 'warn' }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="fin-progress" aria-hidden="true">
      <span className={`fin-progress-fill tone-${tone}`} style={{ width: `${width}%` }} />
    </span>
  );
}

export function PctWithBar({ value, tone, label }: { value: number | null; tone: 'profit' | 'goal' | 'worst' | 'deficit' | 'warn'; label?: string }) {
  if (value == null) return <span className="fin-muted">Sem meta</span>;
  return (
    <span className="fin-pct-cell">
      <span className={`fin-pct-text tone-${tone}`}>{label ?? pct(value)}</span>
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
  value: string;
  icon: React.ReactNode;
  tone: 'profit' | 'goal' | 'worst' | 'deficit' | 'warn' | 'neutral';
  caption?: React.ReactNode;
  progress?: number | null;
  highlight?: boolean;
  badge?: string;
}

export function KpiCard({ label, value, icon, tone, caption, progress, highlight, badge }: KpiCardProps) {
  return (
    <div className={`fin-kpi ${highlight ? 'is-highlight' : ''} tone-${tone}`}>
      <div className="fin-kpi-head">
        <span className="fin-kpi-label">{label}</span>
        <span className={`fin-kpi-icon tone-${tone}`}>{icon}</span>
      </div>
      <span className={`fin-kpi-value tone-${tone}`}>{value}</span>
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

/** Aviso de resultado parcial: itens sem custo conciliado nunca viram lucro zero. */
export function CoverageNotice({ coverage, lastSyncAt }: { coverage: Coverage; lastSyncAt?: string | null }) {
  if (coverage.items === 0) return null;
  const missing = coverage.items - coverage.reconciled;
  const reasons = [
    coverage.pending.pending && `${int(coverage.pending.pending)} aguardando conciliação`,
    coverage.pending.ambiguous && `${int(coverage.pending.ambiguous)} ambíguos`,
    coverage.pending.not_found && `${int(coverage.pending.not_found)} sem pedido no histórico`,
    coverage.pending.mismatch && `${int(coverage.pending.mismatch)} com lucro divergente`,
  ].filter(Boolean);

  if (missing === 0) {
    return (
      <div className="fin-notice is-ok" role="status">
        <CheckCircle2 size={16} />
        <span>
          Custos conciliados com o Mercado Phone: {int(coverage.items)} de {int(coverage.items)} itens
          {lastSyncAt ? ` · última conciliação ${lastSyncAt}` : ''}.
          {coverage.zeroCostDevices > 0 &&
            ` ${int(coverage.zeroCostDevices)} iPhone(s) com custo zero informado pela origem — confira o cadastro de custo no Mercado Phone.`}
        </span>
      </div>
    );
  }
  return (
    <div className="fin-notice is-partial" role="status">
      <AlertTriangle size={16} />
      <span>
        <strong>
          Resultado parcial — {int(coverage.reconciled)} de {int(coverage.items)} itens conciliados.
        </strong>{' '}
        {reasons.join(', ')}. Receita conciliada {brl(coverage.revenueKnown)}; valor pago dos itens pendentes{' '}
        {brl(coverage.amountPending)}. Lucro, margem e projeção consideram apenas os itens conciliados.
      </span>
    </div>
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

/** Dias completos sem nenhuma venda: pode ser loja fechada ou importação atrasada. */
export function EmptyDaysNotice({ days, lastSaleAt }: { days: string[]; lastSaleAt: string | null }) {
  if (days.length === 0) return null;
  const recent = days.slice(-6).map(dayLabel).join(', ');
  return (
    <div className="fin-notice is-partial" role="status">
      <AlertTriangle size={16} />
      <span>
        <strong>{int(days.length)} dia(s) completo(s) sem nenhuma venda registrada</strong> ({recent}
        {days.length > 6 ? ', …' : ''}).{lastSaleAt ? ` Última venda importada: ${lastSaleAt}.` : ''} Se houve vendas nesses dias, a importação
        do Mercado Phone pode estar atrasada — a projeção e o ritmo os contam como zero.
      </span>
    </div>
  );
}
