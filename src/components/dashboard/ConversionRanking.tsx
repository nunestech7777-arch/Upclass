import React from 'react';
import { Link } from 'react-router-dom';
import { MessagesSquare } from 'lucide-react';
import { SellerAvatar } from '../SellerAvatar';
import { EmptyState, PctWithBar } from '../finance/FinancePrimitives';
import { MIN_ATTENDANCES, type ConversionRow } from '../../lib/finance/conversionRanking';
import { int, pct } from '../../lib/finance/format';



interface Props {
  rows: ConversionRow[] | null;
  /** Período analisado (ex.: "01/10/2026 a 31/10/2026"). */
  periodLabel: string;
  /** 'pending' = migração 0021 ainda não aplicada. */
  failed: 'error' | 'pending' | null;
  /** O período alcança dias cujas vendas ainda podem ser lançadas. */
  salesArriving: boolean;
}

/** Vendas por atendimento: pedidos no MercadoPhone ÷ conversas atendidas no Kommo. */
export function ConversionRanking({ rows: allRows, periodLabel, failed, salesArriving }: Props) {
  // Só quem tem atendimentos no Kommo no período (sem vínculo ou sem atendimento fica de fora).
  const rows = allRows?.filter((r) => r.status === 'ranked' || r.status === 'insufficient') ?? null;
  const ranked = rows?.filter((r) => r.status === 'ranked') ?? [];
  const maxIndex = Math.max(...ranked.map((r) => r.index ?? 0), 1);

  return (
    <section id="ranking-conversao" className="fin-panel dv-conversion" aria-label="Ranking de conversão">
      <div className="fin-ranking-head">
        <h2 className="fin-panel-title is-large">
          <MessagesSquare size={20} className="tone-goal" />
          Ranking de Conversão
          <span className="fin-count">{periodLabel}</span>
        </h2>
        {salesArriving && <span className="fin-tag tone-warn">Vendas em lançamento</span>}
      </div>

      {failed === 'pending' && !rows ? (
        <EmptyState title="Contagem de atendimentos ainda não ativada">Ativação pendente no banco (migração 0021).</EmptyState>
      ) : failed && !rows ? (
        <EmptyState title="Atendimentos do Kommo indisponíveis">Tente atualizar o Dashboard.</EmptyState>
      ) : !rows ? (
        <div className="dv-conversion-loading" role="status" aria-label="Carregando atendimentos">
          <span className="dv-skel is-row" />
          <span className="dv-skel is-row" />
          <span className="dv-skel is-row" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhum atendimento no Kommo no período">Sem vendedores para comparar.</EmptyState>
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table dv-rank-table">
            <caption className="uc-sr-only">Vendas por atendimento por vendedor, {periodLabel}</caption>
            <thead>
              <tr>
                <th className="align-left col-rank">#</th>
                <th className="align-left">Vendedor</th>
                <th className="align-right">Atendimentos Kommo</th>
                <th className="align-right">Vendas MercadoPhone</th>
                <th className="align-left">Vendas por atendimento</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seller.id} className={r.status === 'ranked' ? undefined : 'dv-conversion-pending'}>
                  <td className="col-rank fin-rank">{r.position ? String(r.position).padStart(2, '0') : <span aria-label="Sem posição">—</span>}</td>
                  <td className="align-left">
                    <Link to={`/vendedores/${r.seller.id}`} className="fin-seller-cell" title="Abrir relatório do vendedor">
                      <SellerAvatar name={r.seller.name} photoUrl={r.seller.photo_url} size="sm" />
                      <span className="fin-seller-name">{r.seller.name}</span>
                    </Link>
                  </td>
                  <td className="align-right num">{r.attendances == null ? <span className="fin-muted">—</span> : int(r.attendances)}</td>
                  <td className="align-right num">{int(r.orders)}</td>
                  <td className="align-left">
                    {r.status === 'ranked' ? (
                      <PctWithBar value={((r.index ?? 0) / maxIndex) * 100} tone="goal" label={pct(r.index)} />
                    ) : (
                      <span className="fin-muted">
                        Menos de {MIN_ATTENDANCES} atendimentos
                        {r.status === 'insufficient' && r.index != null ? ` · ${pct(r.index)}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
