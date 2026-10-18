import React from 'react';
import { attainmentTone } from '../../lib/finance/ui';
import { ArrowDown, EyeOff } from 'lucide-react';
import { SellerAvatar } from '../SellerAvatar';
import type { MonthContext, SellerFinance } from '../../lib/finance/calc';
import type { RankingSortKey } from '../../lib/finance/ui';
import { brl, int, pct } from '../../lib/finance/format';
import { PctWithBar } from './FinancePrimitives';

interface Props {
  rows: SellerFinance[];
  ctx: MonthContext;
  sortKey: RankingSortKey;
  onSort: (key: RankingSortKey) => void;
  onOpenSeller: (sellerId: string) => void;
  footer: { label: string; totals: Omit<SellerFinance, 'seller'> } | null;
}

function SortHeader({
  k,
  current,
  onSort,
  children,
  align = 'right',
}: {
  k: RankingSortKey;
  current: RankingSortKey;
  onSort: (k: RankingSortKey) => void;
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  const active = current === k;
  return (
    <th className={`align-${align}`} aria-sort={active ? 'descending' : 'none'}>
      <button type="button" className={`fin-th-btn ${active ? 'is-active' : ''}`} onClick={() => onSort(k)}>
        {children}
        {active && <ArrowDown size={12} />}
      </button>
    </th>
  );
}

export function ProfitRankingTable({ rows, ctx, sortKey, onSort, onOpenSeller, footer }: Props) {
  return (
    <div className="fin-table-wrap">
      <table className="fin-table fin-ranking-table">
        <thead>
          <tr>
            <th className="align-left col-rank">#</th>
            <SortHeader k="name" current={sortKey} onSort={onSort} align="left">
              Vendedor
            </SortHeader>
            <SortHeader k="target" current={sortKey} onSort={onSort}>
              Meta (lucro)
            </SortHeader>
            <th className="align-right">Pior cenário</th>
            <SortHeader k="profit" current={sortKey} onSort={onSort}>
              Lucro realizado
            </SortHeader>
            <SortHeader k="pctTarget" current={sortKey} onSort={onSort} align="left">
              % Meta
            </SortHeader>
            <SortHeader k="pctWorst" current={sortKey} onSort={onSort} align="left">
              % Pior cenário
            </SortHeader>
            <SortHeader k="gap" current={sortKey} onSort={onSort}>
              Falta p/ meta
            </SortHeader>
            <SortHeader k="revenue" current={sortKey} onSort={onSort}>
              Faturamento
            </SortHeader>
            <th className="align-right">Custo</th>
            <SortHeader k="margin" current={sortKey} onSort={onSort}>
              Margem
            </SortHeader>
            <SortHeader k="orders" current={sortKey} onSort={onSort}>
              Pedidos
            </SortHeader>
            <SortHeader k="devices" current={sortKey} onSort={onSort}>
              Aparelhos
            </SortHeader>
            <th className="align-right">Acessórios</th>
            <SortHeader k="avgIphoneProfit" current={sortKey} onSort={onSort}>
              Lucro/iPhone
            </SortHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const partial = s.reconciledItems < s.items;
            return (
              <tr key={s.seller.id} className="is-clickable" onClick={() => onOpenSeller(s.seller.id)}>
                <td className="col-rank fin-rank">{String(i + 1).padStart(2, '0')}</td>
                <td className="align-left">
                  <button
                    type="button"
                    className="fin-seller-cell"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSeller(s.seller.id);
                    }}
                    aria-label={`Abrir resultado de ${s.seller.name}`}
                  >
                    <SellerAvatar name={s.seller.name} photoUrl={s.seller.photo_url} size="sm" />
                    <span className="fin-seller-name">
                      {s.seller.name}
                      <span className="fin-seller-tags">
                        {!s.seller.show_in_ranking && (
                          <span className="fin-tag" title="Fora do ranking público (continua no total da operação)">
                            <EyeOff size={11} /> oculto
                          </span>
                        )}
                        {s.goalReached && <span className="fin-tag tone-profit">Meta batida</span>}
                        {partial && <span className="fin-tag tone-warn">parcial</span>}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="align-right num">{s.target != null ? brl(s.target) : <span className="fin-muted">Sem meta</span>}</td>
                <td className="align-right num">{s.worst != null ? brl(s.worst) : <span className="fin-muted">—</span>}</td>
                <td className={`align-right num strong ${s.profit < 0 ? 'tone-deficit' : 'tone-profit'}`}>{brl(s.profit)}</td>
                <td>
                  <PctWithBar value={s.pctTarget} tone={attainmentTone(s.pctTarget, ctx)} />
                </td>
                <td>
                  <PctWithBar value={s.pctWorst} tone="profit" />
                </td>
                <td className={`align-right num ${s.gap ? 'tone-deficit' : ''}`}>
                  {s.gap == null ? '—' : s.gap === 0 ? <span className="tone-profit">Meta batida</span> : brl(s.gap)}
                </td>
                <td className="align-right num">{brl(s.revenue)}</td>
                <td className="align-right num">{brl(s.cost)}</td>
                <td className="align-right num">{pct(s.margin)}</td>
                <td className="align-right num">{int(s.orders)}</td>
                <td className="align-right num">{int(s.devices)}</td>
                <td className="align-right num">{int(s.accessories)}</td>
                <td className="align-right num">{brl(s.avgIphoneProfit)}</td>
              </tr>
            );
          })}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              <td />
              <td className="align-left">{footer.label}</td>
              <td className="align-right num">{brl(footer.totals.target, 'Sem meta')}</td>
              <td className="align-right num">{brl(footer.totals.worst)}</td>
              <td className={`align-right num strong ${footer.totals.profit < 0 ? 'tone-deficit' : 'tone-profit'}`}>
                {brl(footer.totals.profit)}
              </td>
              <td>
                <PctWithBar value={footer.totals.pctTarget} tone={attainmentTone(footer.totals.pctTarget, ctx)} />
              </td>
              <td>
                <PctWithBar value={footer.totals.pctWorst} tone="profit" />
              </td>
              <td className="align-right num">{brl(footer.totals.gap)}</td>
              <td className="align-right num">{brl(footer.totals.revenue)}</td>
              <td className="align-right num">{brl(footer.totals.cost)}</td>
              <td className="align-right num">{pct(footer.totals.margin)}</td>
              <td className="align-right num">{int(footer.totals.orders)}</td>
              <td className="align-right num">{int(footer.totals.devices)}</td>
              <td className="align-right num">{int(footer.totals.accessories)}</td>
              <td className="align-right num">{brl(footer.totals.avgIphoneProfit)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
