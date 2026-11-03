import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { AWAITING_CATEGORIES, AWAITING_CATEGORY_LABEL, type AwaitingBreakdown, type AwaitingCategory } from '../../lib/supervisor/awaiting';
import { int } from '../../lib/finance/format';
import { AnimatedText } from '../ui/AnimatedNumber';
import { AnimatedBar } from '../ui/AnimatedBar';

interface Props {
  breakdown: AwaitingBreakdown;
  /** Rótulo do período (ex.: "Outubro de 2026", "31/10/2026"). */
  periodLabel: string;
  /** Lista de conversas de uma categoria, com os filtros atuais. */
  linkTo: (category: AwaitingCategory) => string;
}

/** "Clientes sem resposta" conciliado: total e as cinco situações que o compõem, cada uma abre a lista. */
export function AwaitingCard({ breakdown, periodLabel, linkTo }: Props) {
  const { total, counts, reconciled } = breakdown;
  return (
    <section className="sv-panel sv-awaiting" aria-label="Clientes sem resposta">
      <div className="sv-awaiting-summary">
        <header className="sv-awaiting-head">
          <h2 className="sv-panel-title">Clientes sem resposta</h2>
          {reconciled ? (
            <span className="sv-awaiting-badge is-ok">Conferida</span>
          ) : (
            <span className="sv-awaiting-badge is-warn">Divergente</span>
          )}
        </header>
        <span className="sv-awaiting-period">{periodLabel}</span>
        <strong className={`sv-awaiting-total ${total > 0 ? 'tone-deficit' : 'tone-profit'}`}>
          <AnimatedText text={int(total)} />
        </strong>
        <span className="sv-awaiting-sub">Conversas que terminaram o período com resposta pendente</span>
        {!reconciled && <span className="sv-awaiting-sub sv-warn">As categorias não fecham com o total: conferir os dados do período.</span>}
      </div>
      <ul className="sv-awaiting-list">
        {AWAITING_CATEGORIES.map((c) => {
          const n = counts[c];
          const share = total > 0 ? (n / total) * 100 : 0;
          const row = (
            <>
              <span className="sv-awaiting-label">{AWAITING_CATEGORY_LABEL[c]}</span>
              <span className="sv-awaiting-value">
                <AnimatedText text={int(n)} />
              </span>
              {n > 0 && <ChevronRight size={15} className="sv-awaiting-chevron" aria-hidden="true" />}
              <span className="sv-awaiting-bar" aria-hidden="true">
                <AnimatedBar className={`sv-awaiting-fill is-${c}`} pct={share} />
              </span>
            </>
          );
          return (
            <li key={c}>
              {n > 0 ? (
                <Link to={linkTo(c)} className="sv-awaiting-row" aria-label={`${AWAITING_CATEGORY_LABEL[c]}: ${int(n)} ${n === 1 ? 'conversa' : 'conversas'} — ver lista`}>
                  {row}
                </Link>
              ) : (
                <div className="sv-awaiting-row is-empty">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
