import React from 'react';
import { Headphones, Smartphone } from 'lucide-react';
import type { RankedProduct } from '../lib/topProducts';
import './TopProductsRanking.css';

interface Props {
  title: string;
  kind: 'devices' | 'accessories';
  items: RankedProduct[];
  emptyText: string;
}

/** Top 5 por unidades vendidas no Painel da Loja: aparelhos em azul/ciano, acessórios em magenta. */
export function TopProductsRanking({ title, kind, items, emptyText }: Props) {
  const Icon = kind === 'devices' ? Smartphone : Headphones;
  const max = items[0]?.qty ?? 0;
  return (
    <section className={`tpr tpr-${kind}`} aria-label={title}>
      <header className="tpr-head">
        <span className="tpr-icon" aria-hidden="true"><Icon size={22} /></span>
        <h3 className="tpr-title">{title}</h3>
      </header>
      {items.length === 0 ? (
        <p className="tpr-empty" role="status">{emptyText}</p>
      ) : (
        <ol className="tpr-list">
          {items.map((p, i) => (
            <li key={p.name} className={`tpr-item ${i === 0 ? 'is-first' : ''}`}>
              <span className="tpr-pos">{i + 1}º</span>
              <span className="tpr-name" title={p.name}>{p.name}</span>
              <span className="tpr-qty">
                <b>{p.qty.toLocaleString('pt-BR')}</b> {p.qty === 1 ? 'unidade' : 'unidades'}
              </span>
              {kind === 'accessories' && (
                <span className="tpr-bar" aria-hidden="true">
                  <span style={{ width: `${max > 0 ? Math.max(4, Math.round((p.qty / max) * 100)) : 0}%` }} />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
