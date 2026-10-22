import React, { useEffect, useRef } from 'react';
import { AlertTriangle, ChevronRight, X } from 'lucide-react';
import './metrics.css';

/**
 * Peças compartilhadas pelas abas Vendas e Estoque: grade de 5 cards clicáveis, modal de
 * detalhamento (fórmula + composição) e barra de filtros fixa no topo durante a rolagem.
 */

export type MetricTone = 'blue' | 'green' | 'purple' | 'amber' | 'teal';

export interface MetricCardProps {
  icon: React.ReactNode;
  tone: MetricTone;
  badge: string;
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  /** Texto curto quando o valor é parcial (dados ausentes) — nunca apresentar como definitivo. */
  partial?: string | null;
  loading?: boolean;
  onOpen?: () => void;
}

export function MetricCard({ icon, tone, badge, label, value, caption, partial, loading, onOpen }: MetricCardProps) {
  const content = (
    <>
      <div className="mc-head">
        <span className={`mc-icon tone-${tone}`}>{icon}</span>
        <span className={`mc-badge tone-${tone}`}>{badge}</span>
      </div>
      <span className="mc-label">{label}</span>
      <span className="mc-value" title={typeof value === 'string' ? value : undefined}>
        {loading ? '…' : value}
      </span>
      {caption && <span className="mc-caption">{loading ? 'carregando…' : caption}</span>}
      {!loading && partial && (
        <span className="mc-partial" title={partial}>
          <AlertTriangle size={12} /> {partial}
        </span>
      )}
      {onOpen && (
        <span className="mc-more" aria-hidden>
          Ver detalhes <ChevronRight size={13} />
        </span>
      )}
    </>
  );
  return onOpen ? (
    <button type="button" className="mc-card is-clickable" onClick={onOpen} aria-label={`${label}: ver detalhamento`}>
      {content}
    </button>
  ) : (
    <div className="mc-card">{content}</div>
  );
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="mc-grid">{children}</div>;
}

/** Barra de filtros que fica presa no topo da área de conteúdo durante a rolagem. */
export function StickyFilterBar({ children, summary }: { children: React.ReactNode; summary?: React.ReactNode }) {
  return (
    <div className="mc-filters-sticky">
      <div className="mc-filters-card">
        {children}
        {summary && <div className="mc-filters-summary">{summary}</div>}
      </div>
    </div>
  );
}

export interface DetailColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

export interface MetricDetailProps<T> {
  title: string;
  /** Fórmula / regra usada no cálculo. */
  formula: React.ReactNode;
  /** Filtros ativos que o detalhamento respeita. */
  scope?: string;
  /** Barra de filtros / ações no topo do modal. */
  toolbar?: React.ReactNode;
  columns: DetailColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  footer?: React.ReactNode[];
  notes?: React.ReactNode;
  emptyText?: string;
  onClose: () => void;
}

export function MetricDetailModal<T>({ title, formula, scope, toolbar, columns, rows, rowKey, footer, notes, emptyText, onClose }: MetricDetailProps<T>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // Foco entra no modal, fica preso nele (Tab) e volta para o card ao fechar.
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="mc-modal-overlay" role="presentation" onClick={onClose}>
      <div ref={dialogRef} className="mc-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="mc-modal-head">
          <div>
            <h3>{title}</h3>
            {scope && <span className="mc-modal-scope">{scope}</span>}
          </div>
          <button ref={closeRef} type="button" className="mc-modal-close" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        {toolbar && <div className="mc-modal-toolbar">{toolbar}</div>}
        <div className="mc-modal-formula">{formula}</div>
        <div className="mc-modal-body">
          {rows.length === 0 ? (
            <p className="mc-modal-empty">{emptyText ?? 'Nada a mostrar com os filtros atuais.'}</p>
          ) : (
            <div className="mc-modal-table-wrap">
              <table className="mc-modal-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} className={c.align === 'right' ? 'is-right' : ''}>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={rowKey(r)}>
                      {columns.map((c) => (
                        <td key={c.key} className={c.align === 'right' ? 'is-right' : ''}>
                          {c.render(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {footer && (
                  <tfoot>
                    <tr>
                      {footer.map((f, i) => (
                        <td key={i} className={columns[i]?.align === 'right' ? 'is-right' : ''}>
                          {f}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          {notes && <div className="mc-modal-notes">{notes}</div>}
        </div>
      </div>
    </div>
  );
}
