import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Eye, EyeOff, X } from 'lucide-react';
import type { FinanceSale, MonthContext, SellerFinance } from '../../lib/finance/calc';
import { monthLabel } from '../../lib/finance/dates';
import { SellerAvatar } from '../SellerAvatar';
import { SellerFinanceDetail } from './SellerFinanceDetail';
import { useFinanceSource } from './useFinance';

interface Props {
  row: SellerFinance;
  ctx: MonthContext;
  sales: FinanceSale[];
  productNames: Map<string, string>;
  sellerNames: Map<string, string>;
  onClose: () => void;
  onVisibilityChanged: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Painel lateral do vendedor (anexos 11 e 12): abre sobre a página, que mantém período e filtros. */
export function SellerFinanceDrawer({ row, ctx, sales, productNames, sellerNames, onClose, onVisibilityChanged }: Props) {
  const source = useFinanceSource();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = `fin-drawer-title-${row.seller.id}`;

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('.fin-drawer-close')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleVisibility = async () => {
    setSaving(true);
    try {
      await source.setSellerVisibility(row.seller.id, !row.seller.show_in_ranking);
      onVisibilityChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fin-drawer-root">
      <div className="fin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="fin-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <header className="fin-drawer-head">
          <div className="fin-drawer-identity">
            <SellerAvatar name={row.seller.name} photoUrl={row.seller.photo_url} size="md" />
            <div>
              <h2 id={titleId}>{row.seller.name}</h2>
              <span className="fin-drawer-sub">Resultado individual · {monthLabel(ctx.month)}</span>
            </div>
          </div>
          <button type="button" className="fin-icon-btn fin-drawer-close" onClick={onClose} aria-label="Fechar painel do vendedor">
            <X size={18} />
          </button>
        </header>
        <div className="fin-drawer-actions">
          <button type="button" className="fin-btn" onClick={toggleVisibility} disabled={saving}>
            {row.seller.show_in_ranking ? <EyeOff size={15} /> : <Eye size={15} />}
            {row.seller.show_in_ranking ? 'Excluir do ranking' : 'Mostrar no ranking'}
          </button>
          <Link className="fin-btn" to={`/vendedores/${row.seller.id}?mes=${ctx.month}`}>
            <ExternalLink size={15} />
            Abrir relatório completo
          </Link>
        </div>
        {!row.seller.show_in_ranking && (
          <p className="fin-drawer-note">Fora do ranking da equipe — continua somado ao resultado da operação.</p>
        )}
        <div className="fin-drawer-body">
          <SellerFinanceDetail row={row} ctx={ctx} sales={sales} productNames={productNames} sellerNames={sellerNames} />
        </div>
      </div>
    </div>
  );
}
