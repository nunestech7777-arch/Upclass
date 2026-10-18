import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, MessageSquareOff, Trophy } from 'lucide-react';
import { SellerAvatar } from '../SellerAvatar';
import { EmptyState, PctWithBar } from '../finance/FinancePrimitives';
import { RANK_SORT_LABELS, sortSellerRows, type DeviceRankRow, type RankSortKey, type SellerDashRow } from '../../lib/finance/dashboard';
import type { ConversionStatus } from '../../lib/finance/financeApi';
import { brl, int, pct } from '../../lib/finance/format';

type Tab = 'profit' | 'margin' | 'devices';

const TAB_TITLES: Record<Tab, string> = {
  profit: 'Ranking de Lucro por Vendedor',
  margin: 'Ranking de Margem por Vendedor',
  devices: 'Ranking de Aparelhos por Vendedor',
};

function Th({ k, current, onSort, children, left }: { k: RankSortKey; current: RankSortKey; onSort: (k: RankSortKey) => void; children: React.ReactNode; left?: boolean }) {
  const active = current === k;
  return (
    <th className={left ? 'align-left' : 'align-right'} aria-sort={active ? 'descending' : 'none'}>
      <button type="button" className={`fin-th-btn ${active ? 'is-active' : ''}`} onClick={() => onSort(k)}>
        {children}
        {active && <ArrowDown size={12} />}
      </button>
    </th>
  );
}

function SellerCell({ row, month }: { row: SellerDashRow; month: string }) {
  return (
    <Link to={`/vendedores/${row.seller.id}?mes=${month}`} className="fin-seller-cell" title="Abrir relatório do vendedor">
      <SellerAvatar name={row.seller.name} photoUrl={row.seller.photo_url} size="sm" />
      <span className="fin-seller-name">{row.seller.name}</span>
    </Link>
  );
}

export interface DeviceRankingProps {
  rows: DeviceRankRow[];
  /** Mês de referência das metas (ex.: "Outubro de 2026"). */
  monthLabel: string;
  /** Metas individuais disponíveis no banco (migração 0014). */
  goalsAvailable: boolean;
  /** Aparelhos vendidos no período em toda a operação (cards), para conferência. */
  operationDevices: number;
  onOpenSeller: (sellerId: string) => void;
}

interface Props {
  rows: SellerDashRow[];
  month: string;
  operation: { profit: number; revenue: number; orders: number };
  devices: DeviceRankingProps;
}

/** Rankings por vendedor do ITEM: lucro bruto e margem, com ordenação. */
export function SellerRankings({ rows, month, operation, devices }: Props) {
  const [tab, setTab] = useState<Tab>('profit');
  const [sortKey, setSortKey] = useState<RankSortKey>('profit');
  const effective: RankSortKey = tab === 'margin' ? 'margin' : sortKey;
  const sorted = sortSellerRows(rows, effective);
  const total = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost, profit: a.profit + r.profit, devices: a.devices + r.devices, accessories: a.accessories + r.accessories, units: a.units + r.units }), { revenue: 0, cost: 0, profit: 0, devices: 0, accessories: 0, units: 0 });
  const totalMargin = total.revenue > 0 ? (total.profit / total.revenue) * 100 : null;
  const maxMargin = Math.max(...rows.map((r) => r.margin ?? 0), 1);

  return (
    <section className="fin-panel" aria-label="Ranking por vendedor">
      <div className="fin-ranking-head">
        <h2 className="fin-panel-title is-large">
          <Trophy size={20} className="tone-profit" />
          {TAB_TITLES[tab]}
          <span className="fin-count">{int(tab === 'devices' ? devices.rows.length : rows.length)} vendedores</span>
        </h2>
        <div className="dv-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'profit'} className={tab === 'profit' ? 'is-active' : ''} onClick={() => setTab('profit')}>
            Ranking por Lucro
          </button>
          <button type="button" role="tab" aria-selected={tab === 'margin'} className={tab === 'margin' ? 'is-active' : ''} onClick={() => setTab('margin')}>
            Ranking por Margem
          </button>
          <button type="button" role="tab" aria-selected={tab === 'devices'} className={tab === 'devices' ? 'is-active' : ''} onClick={() => setTab('devices')}>
            Ranking por Aparelhos
          </button>
        </div>
      </div>
      {tab === 'profit' && (
        <label className="fin-sort dv-sort">
          Ordenar por
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as RankSortKey)} aria-label="Ordenar ranking por">
            {(Object.keys(RANK_SORT_LABELS) as RankSortKey[]).map((k) => (
              <option key={k} value={k}>
                {RANK_SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}

      {tab === 'devices' ? (
        <DeviceRankingTable {...devices} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhum vendedor no ranking">Mostre vendedores em Vendedores para vê-los aqui.</EmptyState>
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table dv-rank-table">
            <thead>
              <tr>
                <th className="align-left col-rank">#</th>
                <th className="align-left">Vendedor</th>
                {tab === 'profit' && (
                  <>
                    <Th k="devices" current={effective} onSort={setSortKey}>Aparelhos</Th>
                    <Th k="accessories" current={effective} onSort={setSortKey}>Acessórios</Th>
                  </>
                )}
                {tab === 'margin' && <th className="align-right">Unidades</th>}
                <Th k="revenue" current={effective} onSort={setSortKey}>Faturamento</Th>
                <th className="align-right">Custo</th>
                <Th k="profit" current={effective} onSort={setSortKey}>Lucro bruto</Th>
                <Th k="margin" current={effective} onSort={setSortKey} left={tab === 'margin'}>Margem</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.seller.id}>
                  <td className="col-rank fin-rank">{String(i + 1).padStart(2, '0')}</td>
                  <td className="align-left">
                    <SellerCell row={r} month={month} />
                    {r.reconciledItems < r.items && <span className="fin-tag tone-warn">parcial</span>}
                  </td>
                  {tab === 'profit' && (
                    <>
                      <td className="align-right num">{int(r.devices)}</td>
                      <td className="align-right num">{int(r.accessories)}</td>
                    </>
                  )}
                  {tab === 'margin' && <td className="align-right num">{int(r.units)}</td>}
                  <td className="align-right num">{brl(r.revenue)}</td>
                  <td className="align-right num">{brl(r.cost)}</td>
                  <td className={`align-right num strong ${r.profit < 0 ? 'tone-deficit' : 'tone-profit'}`}>{brl(r.profit)}</td>
                  <td className={tab === 'margin' ? 'align-left' : 'align-right num'}>
                    {tab === 'margin' ? (
                      r.margin == null ? (
                        <span className="fin-muted">—</span>
                      ) : (
                        <PctWithBar value={(r.margin / maxMargin) * 100} tone="profit" label={pct(r.margin)} />
                      )
                    ) : (
                      pct(r.margin)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className="align-left">Total dos {rows.length} vendedores</td>
                {tab === 'profit' && (
                  <>
                    <td className="align-right num">{int(total.devices)}</td>
                    <td className="align-right num">{int(total.accessories)}</td>
                  </>
                )}
                {tab === 'margin' && <td className="align-right num">{int(total.units)}</td>}
                <td className="align-right num">{brl(total.revenue)}</td>
                <td className="align-right num">{brl(total.cost)}</td>
                <td className={`align-right num ${total.profit < 0 ? 'tone-deficit' : 'tone-profit'}`}>{brl(total.profit)}</td>
                <td className={tab === 'margin' ? 'align-left' : 'align-right num'}>{pct(totalMargin)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {tab !== 'devices' && (
      <p className="fin-muted fin-small fin-table-note">
        Lucro bruto = faturamento − custo dos produtos (receita líquida e custo histórico do Mercado Phone, sem despesas nem comissões). Margem = lucro ÷ faturamento
        (indisponível com faturamento zero). Cada item vai para o vendedor do item. Operação inteira no período (inclui vendedores ocultos e brindes): lucro {brl(operation.profit)},
        faturamento {brl(operation.revenue)}, {int(operation.orders)} vendas.
      </p>
      )}
    </section>
  );
}

/** Conversão depende de oportunidades com resultado (CRM): sem dados reais, não inventamos percentuais. */
export function ConversionNotice({ status }: { status: ConversionStatus | null | undefined }) {
  return (
    <section className="fin-panel dv-conversion" aria-label="Ranking de conversão">
      <h2 className="fin-panel-title">
        <MessageSquareOff size={18} className="tone-warn" />
        Ranking de Conversão
      </h2>
      <p>
        <strong>Indisponível por falta de dados.</strong> A conversão (vendas convertidas ÷ oportunidades) exige oportunidades do CRM com resultado de ganho ou perda.
        {status ? (
          <>
            {' '}
            Hoje há {int(status.conversations)} conversas importadas do Kommo, e {int(status.classified)} com resultado classificado.
          </>
        ) : (
          ' Não foi possível consultar o estado das conversas agora.'
        )}{' '}
        Para ativar este ranking, a integração precisa importar as oportunidades (leads) e seus status — fora do escopo desta etapa. Nenhum percentual é exibido para não induzir a 0% falsos.
      </p>
    </section>
  );
}

function DeviceRankingTable({ rows, monthLabel, goalsAvailable, operationDevices, onOpenSeller }: DeviceRankingProps) {
  if (rows.length === 0) return <EmptyState title="Nenhum vendedor no ranking">Mostre vendedores em Vendedores para vê-los aqui.</EmptyState>;
  const monthBasis = rows[0].basisIsMonth;
  const anyGoal = rows.some((r) => r.target != null);
  const total = rows.reduce((a, r) => ({ sold: a.sold + r.sold, revenue: a.revenue + r.revenue, profit: a.profit + r.profit }), { sold: 0, revenue: 0, profit: 0 });
  const hidden = operationDevices - total.sold;

  return (
    <>
      {!goalsAvailable && (
        <p className="fin-notice is-partial dv-device-notice">
          <span>Não foi possível carregar as metas individuais de aparelhos (confira se a migração 0014 foi aplicada): os vendedores aparecem sem meta.</span>
        </p>
      )}
      {goalsAvailable && monthBasis && anyGoal && (
        <p className="fin-notice dv-device-notice">
          <span>
            As metas são <strong>mensais</strong>. Como o período filtrado não é o mês inteiro, meta, % e faltantes comparam as metas de {monthLabel} com o{' '}
            <strong>acumulado do mês</strong> (mostrado em “no mês”); a coluna “Aparelhos vendidos” mostra só o período filtrado.
          </span>
        </p>
      )}
      <div className="fin-table-wrap">
        <table className="fin-table dv-rank-table">
          <thead>
            <tr>
              <th className="align-left col-rank">#</th>
              <th className="align-left">Vendedor</th>
              <th className="align-right">Aparelhos vendidos</th>
              <th className="align-right">Meta de aparelhos{monthBasis ? ' (mensal)' : ''}</th>
              <th className="align-left">% da meta</th>
              <th className="align-right">Aparelhos faltantes</th>
              <th className="align-right">Faturamento com aparelhos</th>
              <th className="align-right">Lucro bruto com aparelhos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.seller.id}>
                <td className="col-rank fin-rank">{String(i + 1).padStart(2, '0')}</td>
                <td className="align-left">
                  <button type="button" className="fin-seller-cell" onClick={() => onOpenSeller(r.seller.id)} title="Ver os aparelhos vendidos no período" aria-label={`Ver aparelhos vendidos por ${r.seller.name}`}>
                    <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                    <span className="fin-seller-name">{r.seller.name}</span>
                  </button>
                  {r.reconciledItems < r.items && <span className="fin-tag tone-warn">parcial</span>}
                </td>
                <td className="align-right num">
                  <span className="strong tone-profit">{int(r.sold)}</span>
                </td>
                <td className="align-right num">{r.target != null ? int(r.target) : <span className="fin-muted">Sem meta</span>}</td>
                <td>
                  {r.target != null ? (
                    <div className="fc-pct">
                      <PctWithBar value={r.pct} tone={(r.pct ?? 0) >= 100 ? 'profit' : 'goal'} />
                      {monthBasis && <span className="fc-pct-line">no mês: {int(r.monthSold)}</span>}
                    </div>
                  ) : (
                    <span className="fin-muted">Sem meta</span>
                  )}
                </td>
                <td className="align-right num">
                  {r.target == null ? <span className="fin-muted">—</span> : r.remaining === 0 ? <span className="fc-reached">META ATINGIDA</span> : <span className="strong tone-deficit">{int(r.remaining)}</span>}
                </td>
                <td className="align-right num">{brl(r.revenue)}</td>
                <td className={`align-right num strong ${r.profit < 0 ? 'tone-deficit' : 'tone-profit'}`}>{brl(r.profit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td className="align-left">Total dos {rows.length} vendedores</td>
              <td className="align-right num tone-profit">{int(total.sold)}</td>
              <td />
              <td />
              <td />
              <td className="align-right num">{brl(total.revenue)}</td>
              <td className={`align-right num ${total.profit < 0 ? 'tone-deficit' : 'tone-profit'}`}>{brl(total.profit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="fin-muted fin-small fin-table-note">
        Aparelho = produto iPhone, atribuído ao vendedor de cada item (acessórios, Apple Watch e vendas canceladas não entram). Faturamento e lucro bruto são só dos
        aparelhos, itens conciliados. Aparelhos do período em toda a operação: {int(operationDevices)}
        {hidden > 0 ? ` (${int(hidden)} de vendedores ocultos do ranking)` : ''}.
      </p>
    </>
  );
}
