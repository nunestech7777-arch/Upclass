import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { ProgressBar } from '../finance/FinancePrimitives';
import { coverageSummary } from '../../lib/finance/dashboard';
import type { Coverage } from '../../lib/finance/calc';
import { brl, int } from '../../lib/finance/format';

/**
 * Botão discreto de conciliação (cabeçalho do Dashboard) + modal "Status da Conciliação".
 * Os números vêm do mesmo `Coverage` que antes alimentava o aviso fixo; as pendências continuam
 * sinalizadas no próprio botão.
 */
export function CoverageStatus({ coverage }: { coverage: Coverage | null }) {
  const [open, setOpen] = useState(false);
  const summary = coverage ? coverageSummary(coverage) : null;
  const hasPending = !!summary && summary.pending > 0;

  return (
    <>
      <button
        type="button"
        className={`fin-btn dv-coverage-btn ${hasPending ? 'has-pending' : ''}`}
        onClick={() => setOpen(true)}
        disabled={!summary}
        aria-haspopup="dialog"
        title={hasPending ? `${summary!.pending} item(ns) aguardando conciliação` : 'Custos conciliados'}
      >
        {hasPending ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
        Conciliação{hasPending ? ` (${int(summary!.pending)})` : ''}
      </button>
      {open && summary && <CoverageDialog summary={summary} onClose={() => setOpen(false)} />}
    </>
  );
}

function CoverageDialog({ summary, onClose }: { summary: ReturnType<typeof coverageSummary>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [onClose]);

  const pct = summary.pct;
  const pctText = pct == null ? '—' : `${pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

  return (
    <div className="fin-modal-root" role="dialog" aria-modal="true" aria-labelledby="dv-coverage-title">
      <div className="fin-drawer-backdrop" onClick={onClose} />
      <div className="fin-modal dv-coverage-modal" ref={ref}>
        <header className="fin-modal-head">
          <h3 id="dv-coverage-title">Status da Conciliação</h3>
          <button type="button" className="fin-icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        {summary.total === 0 ? (
          <p className="fin-muted">Nenhum item vendido no período selecionado.</p>
        ) : (
          <>
            <div>
              <strong className="dv-coverage-headline">
                {int(summary.reconciled)} de {int(summary.total)} itens conciliados
              </strong>
              <span className="fin-muted">{pctText} concluído</span>
              <ProgressBar value={pct} tone={summary.pending === 0 ? 'profit' : 'warn'} />
            </div>

            <dl className="dv-coverage-grid">
              <div>
                <dt>Total de itens</dt>
                <dd>{int(summary.total)}</dd>
              </div>
              <div>
                <dt>Itens conciliados</dt>
                <dd className="tone-profit">{int(summary.reconciled)}</dd>
              </div>
              <div>
                <dt>Itens pendentes</dt>
                <dd className={summary.pending > 0 ? 'tone-warn' : ''}>{int(summary.pending)}</dd>
              </div>
              <div>
                <dt>Percentual conciliado</dt>
                <dd>{pctText}</dd>
              </div>
              <div>
                <dt>Receita conciliada</dt>
                <dd>{brl(summary.revenueKnown)}</dd>
              </div>
              <div>
                <dt>Valor pago dos itens pendentes</dt>
                <dd className={summary.pending > 0 ? 'tone-warn' : ''}>{brl(summary.amountPending)}</dd>
              </div>
            </dl>

            {summary.reasons.length > 0 && (
              <ul className="fin-msg-list">
                {summary.reasons.map((r) => (
                  <li key={r.label}>
                    {r.label}: {int(r.count)}
                  </li>
                ))}
              </ul>
            )}
            {summary.zeroCostDevices > 0 && (
              <p className="fin-muted fin-small">
                {int(summary.zeroCostDevices)} iPhone(s) com custo zero informado pela origem — confira o cadastro de custo no Mercado Phone.
              </p>
            )}
          </>
        )}

        <p className="dv-coverage-note">Os indicadores de lucro, margem e projeção consideram apenas os itens conciliados.</p>

        <footer className="fin-modal-foot">
          <button type="button" className="fin-btn is-primary" onClick={onClose}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
