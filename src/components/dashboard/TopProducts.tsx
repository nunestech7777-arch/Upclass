import React, { useEffect, useRef, useState } from 'react';
import { Headphones, Smartphone, X } from 'lucide-react';
import { brl, int, pct } from '../../lib/finance/format';
import { formatDateBR, wallClock } from '../../lib/finance/dates';
import { isReconciled, type FinanceSale } from '../../lib/finance/calc';
import { confirmedMoney, type TopProduct } from '../../lib/finance/dashboard';
import { countDelay } from '../../lib/motion';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { useCardLink } from '../ui/useCardLink';
import type { To } from 'react-router-dom';

const units = (v: number | null | undefined) => `${int(v)} un.`;

interface CardProps {
  kind: 'devices' | 'accessories';
  product: TopProduct | null;
  onOpen: () => void;
  /** Destino do card (Vendas filtradas pelo produto); "Ver detalhes" continua abrindo o detalhamento. */
  to?: To | null;
}

export function TopProductCard({ kind, product, onOpen, to }: CardProps) {
  const isDevice = kind === 'devices';
  const title = isDevice ? 'Aparelho mais vendido' : 'Acessório mais vendido';
  const delay = countDelay(isDevice ? 7 : 8);
  const link = useCardLink(product ? to : null, product ? `${title}: ${product.name}` : undefined);
  return (
    <section className="fin-panel dv-top" aria-label={title} {...link}>
      <span className="fin-eyebrow">
        {isDevice ? <Smartphone size={14} /> : <Headphones size={14} />}
        {title}
      </span>
      {product ? (
        <>
          <strong className="dv-top-name">{product.name}</strong>
          <div className="dv-top-stats">
            <div>
              <span>Quantidade</span>
              <b className="tone-profit">
                <AnimatedNumber value={product.qty} format={units} delay={delay} />
              </b>
            </div>
            <div>
              <span>Participação</span>
              <b>
                <AnimatedNumber value={product.share} format={pct} delay={delay} />
              </b>
            </div>
            <div>
              <span>Faturamento gerado</span>
              <b>
                <AnimatedNumber value={confirmedMoney(product.revenue, product.rows.length, product.rows.length - product.unreconciled)} format={brl} delay={delay} />
              </b>
            </div>
          </div>
          {product.ranking.length > 1 && (
            <ul className="dv-top-rank">
              {product.ranking.slice(1, 5).map((r, i) => (
                <li key={r.name}>
                  <span>
                    {i + 2}º {r.name}
                  </span>
                  <span>{int(r.qty)} un.</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="fin-link fin-small dv-card-action" onClick={onOpen}>
            Ver detalhes →
          </button>
        </>
      ) : (
        <span className="fin-muted">Nenhuma venda de {isDevice ? 'aparelhos' : 'acessórios'} no período.</span>
      )}
    </section>
  );
}

export interface SalesItemsColumns {
  seller?: boolean;
  profit?: boolean;
  order?: boolean;
}

interface ItemsDialogProps {
  title: string;
  summary: string;
  rows: FinanceSale[];
  productNames: Map<string, string>;
  sellerNames: Map<string, string>;
  columns?: SalesItemsColumns;
  /** Controles extras acima da tabela (ex.: escolher o produto). */
  toolbar?: React.ReactNode;
  onClose: () => void;
}

/**
 * Itens vendidos (produto, quantidade, data, cliente, valor e, opcionalmente, vendedor do item,
 * lucro bruto e número da venda). Usado pelo produto mais vendido e pelo ranking por aparelhos.
 */
export function SalesItemsDialog({ title, summary, rows, productNames, sellerNames, columns = { seller: true }, toolbar, onClose }: ItemsDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fin-modal-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fin-drawer-backdrop" onClick={onClose} />
      <div className="fin-modal dv-modal" ref={ref}>
        <header className="fin-modal-head">
          <h3>{title}</h3>
          <button type="button" className="fin-icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <p className="fin-muted fin-small">{summary}</p>
        {toolbar}
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th className="align-left">Produto</th>
                <th className="align-right">Qtd</th>
                <th className="align-left">Data</th>
                {columns.order && <th className="align-left">Venda</th>}
                <th className="align-left">Cliente</th>
                {columns.seller && <th className="align-left">Vendedor do item</th>}
                <th className="align-right">Valor vendido</th>
                {columns.profit && <th className="align-right">Lucro bruto</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const w = wallClock(r.sold_at);
                return (
                  <tr key={r.id}>
                    <td className="align-left">{productNames.get(r.product_id) ?? 'Produto não identificado'}</td>
                    <td className="align-right num">{int(r.quantity)}</td>
                    <td className="align-left nowrap">
                      {formatDateBR(w.date)} {w.time}
                    </td>
                    {columns.order && <td className="align-left nowrap">{r.mp_order_id ?? <span className="fin-muted">—</span>}</td>}
                    <td className="align-left">{r.customer_name ?? <span className="fin-muted">Não informado</span>}</td>
                    {columns.seller && <td className="align-left">{sellerNames.get(r.seller_id) ?? 'Vendedor não cadastrado'}</td>}
                    <td className="align-right num">{isReconciled(r) ? brl(r.revenue) : <span className="fin-muted">{brl(r.amount)}</span>}</td>
                    {columns.profit && (
                      <td className={`align-right num ${isReconciled(r) ? ((r.profit ?? 0) < 0 ? 'tone-deficit' : 'tone-profit') : ''}`}>
                        {isReconciled(r) ? brl(r.profit) : <span className="fin-muted">—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface DialogProps {
  title: string;
  product: TopProduct;
  productNames: Map<string, string>;
  sellerNames: Map<string, string>;
  onClose: () => void;
}

/** Itens do produto mais vendido; o seletor permite ver qualquer outro produto (não só o top 5). */
export function TopProductDialog({ title, product, productNames, sellerNames, onClose }: DialogProps) {
  const [selected, setSelected] = useState<string>(product.name);
  const group = selected === '__all__' ? null : product.all.find((g) => g.name === selected) ?? product.all[0];
  const rows = group ? group.rows : product.all.flatMap((g) => g.rows).sort((a, b) => b.sold_at.localeCompare(a.sold_at));
  const qty = group ? group.qty : product.all.reduce((a, g) => a + g.qty, 0);
  const revenue = rows.reduce((a, r) => a + (isReconciled(r) ? Number(r.revenue) : 0), 0);
  return (
    <SalesItemsDialog
      title={`${title}: ${group ? group.name : 'todos os produtos'}`}
      summary={`${int(qty)} unidade(s) · ${int(rows.length)} item(ns) · faturamento ${brl(confirmedMoney(revenue, rows.length, rows.filter(isReconciled).length))}`}
      rows={rows}
      productNames={productNames}
      sellerNames={sellerNames}
      columns={{ seller: true }}
      toolbar={
        <label className="fin-sort dv-product-select">
          Produto
          <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Escolher produto">
            <option value="__all__">Todos ({int(product.all.length)} produtos)</option>
            {product.all.map((g, i) => (
              <option key={g.name} value={g.name}>
                {i + 1}º {g.name} — {int(g.qty)} un.
              </option>
            ))}
          </select>
        </label>
      }
      onClose={onClose}
    />
  );
}
