import React, { useMemo, useState } from 'react';
import { attainmentTone } from '../../lib/finance/ui';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { financeCategory, isActive, isReconciled, type FinanceSale, type MonthContext, type SellerFinance } from '../../lib/finance/calc';
import { brl, int, pct } from '../../lib/finance/format';
import { formatDateBR } from '../../lib/finance/dates';
import type { SaleOrderDetails } from '../../lib/saleDetails';
import { CategoryProfitChart } from './FinanceCharts';
import { PctWithBar } from './FinancePrimitives';
import { useFinanceSource } from './useFinance';

interface Props {
  row: SellerFinance;
  ctx: MonthContext;
  sales: FinanceSale[];
  productNames: Map<string, string>;
  sellerNames: Map<string, string>;
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'Aguardando conciliação',
  mismatch: 'Lucro divergente',
  ambiguous: 'Correspondência ambígua',
  not_found: 'Sem pedido no histórico',
};

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="fin-metric">
      <span className="fin-metric-label">{label}</span>
      <span className={`fin-metric-value ${tone ?? ''}`}>{value}</span>
      {hint && <span className="fin-metric-hint">{hint}</span>}
    </div>
  );
}

/**
 * Detalhe financeiro de um vendedor no mês: indicadores, composição por categoria e itens vendidos.
 * Compartilhado pelo painel lateral e pelo relatório completo do vendedor.
 */
export function SellerFinanceDetail({ row, ctx, sales, productNames, sellerNames }: Props) {
  const items = useMemo(
    () =>
      sales
        .filter((s) => s.seller_id === row.seller.id)
        .sort((a, b) => b.sold_at.localeCompare(a.sold_at) || (a.external_id ?? '').localeCompare(b.external_id ?? '')),
    [sales, row.seller.id]
  );
  const activeItems = items.filter(isActive);
  const excluded = items.length - activeItems.length;
  const [showExcluded, setShowExcluded] = useState(false);
  const listed = showExcluded ? items : activeItems;

  return (
    <div className="fin-detail">
      <div className="fin-metric-grid">
        <Metric label="Lucro realizado" value={brl(row.profit)} tone={row.profit < 0 ? 'tone-deficit' : 'tone-profit'} />
        <Metric label="Faturamento" value={brl(row.revenue)} />
        <Metric label="Custo" value={brl(row.cost)} />
        <Metric label="Margem" value={pct(row.margin)} />
        <Metric label="Pedidos com participação" value={int(row.orders)} />
        <Metric label="Ticket médio por pedido" value={brl(row.ticket)} />
        <Metric label="Lucro médio por iPhone" value={brl(row.avgIphoneProfit)} />
        <Metric label="Média por produto" value={brl(row.avgPerUnit)} hint="Receita ÷ unidades" />
        <Metric label="Aparelhos · Acessórios" value={`${int(row.devices)} · ${int(row.accessories)}`} hint={row.gifts ? `${int(row.gifts)} brinde(s) fora da contagem` : undefined} />
      </div>

      <div className="fin-detail-goal">
        <div>
          <span className="fin-metric-label">Meta</span>
          <strong className="tone-goal">{row.target != null ? brl(row.target) : 'Sem meta'}</strong>
        </div>
        <div>
          <span className="fin-metric-label">Pior cenário</span>
          <strong className="tone-worst">{row.worst != null ? brl(row.worst) : '—'}</strong>
        </div>
        <div>
          <span className="fin-metric-label">% da meta</span>
          <PctWithBar value={row.pctTarget} tone={attainmentTone(row.pctTarget, ctx)} />
        </div>
        <div>
          <span className="fin-metric-label">Falta</span>
          <strong className={row.gap ? 'tone-deficit' : 'tone-profit'}>
            {row.gap == null ? '—' : row.gap === 0 ? 'Meta batida' : brl(row.gap)}
          </strong>
        </div>
        <div>
          <span className="fin-metric-label">{ctx.phase === 'past' ? 'Fechamento' : 'Projeção'}</span>
          <strong>{row.projection != null ? brl(row.projection) : 'Indisponível'}</strong>
        </div>
        <div>
          <span className="fin-metric-label">Meta-base de hoje</span>
          <strong>{row.neededPerDay != null && ctx.phase === 'current' ? brl(row.neededPerDay) : '—'}</strong>
        </div>
      </div>

      <h4 className="fin-subtitle">Lucro por tipo de produto</h4>
      <CategoryProfitChart byCategory={row.byCategory} />

      <div className="fin-items-head">
        <h4 className="fin-subtitle">
          Itens vendidos <span className="fin-count">{int(activeItems.length)}</span>
        </h4>
        {excluded > 0 && (
          <label className="fin-check">
            <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
            Mostrar {int(excluded)} cancelado(s)/removido(s)
          </label>
        )}
      </div>
      {listed.length === 0 ? (
        <p className="fin-muted">Nenhum item no período.</p>
      ) : (
        <div className="fin-table-wrap">
          <table className="fin-table fin-items-table">
            <thead>
              <tr>
                <th className="align-left">Data</th>
                <th className="align-left">Produto · cliente</th>
                <th className="align-right">Qtd</th>
                <th className="align-right">Receita</th>
                <th className="align-right">Custo</th>
                <th className="align-right">Lucro</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((s) => (
                <ItemRow key={s.id} sale={s} productName={productNames.get(s.product_id) ?? 'Produto não identificado'} sellerNames={sellerNames} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ItemRow({ sale, productName, sellerNames }: { sale: FinanceSale; productName: string; sellerNames: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const category = financeCategory(productName, sale.amount);
  const reconciled = isReconciled(sale);
  const inactive = !isActive(sale);
  return (
    <>
      <tr className={`is-clickable ${inactive ? 'is-inactive' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <td className="align-left nowrap">
          <span className="fin-expander">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          {formatDateBR(sale.sold_date)}
        </td>
        <td className="align-left">
          <span className="fin-product">{productName}</span>
          <span className="fin-product-meta">
            {category}
            {sale.mp_order_id && ` · pedido ${sale.mp_order_id}`}
            {' · '}
            {sale.customer_name ?? 'cliente não informado'}
            {inactive && ` · ${sale.item_status === 'cancelled' ? 'cancelado' : 'removido do pedido'}`}
          </span>
        </td>
        <td className="align-right num">{int(sale.quantity)}</td>
        <td className="align-right num">{reconciled ? brl(sale.revenue) : <span className="fin-muted">{brl(sale.amount)}*</span>}</td>
        <td className="align-right num">{reconciled ? brl(sale.cost) : <span className="fin-muted">—</span>}</td>
        <td className={`align-right num strong ${!reconciled ? '' : (sale.profit ?? 0) < 0 ? 'tone-deficit' : 'tone-profit'}`}>
          {reconciled ? brl(sale.profit) : <span className="tone-warn fin-small">{STATUS_TEXT[sale.financial_status] ?? 'Pendente'}</span>}
        </td>
      </tr>
      {open && (
        <tr className="fin-item-detail-row">
          <td colSpan={6}>
            <OrderDetail sale={sale} sellerNames={sellerNames} />
          </td>
        </tr>
      )}
    </>
  );
}

function OrderDetail({ sale, sellerNames }: { sale: FinanceSale; sellerNames: Map<string, string> }) {
  const source = useFinanceSource();
  const [state, setState] = useState<{ loading: boolean; details: SaleOrderDetails | null; error: string | null }>({
    loading: true,
    details: null,
    error: null,
  });
  React.useEffect(() => {
    let alive = true;
    source
      .loadOrderDetails(sale.external_id)
      .then((details) => alive && setState({ loading: false, details, error: null }))
      .catch((err) => alive && setState({ loading: false, details: null, error: String(err?.message ?? err) }));
    return () => {
      alive = false;
    };
  }, [source, sale.external_id]);

  const unitRevenue = sale.revenue != null && sale.quantity > 0 ? sale.revenue / sale.quantity : null;
  return (
    <div className="fin-order-detail">
      <div className="fin-order-grid">
        <span>
          <em>Pedido</em>
          {sale.mp_order_id ?? 'Não informado'}
        </span>
        <span>
          <em>Valor pago pelo cliente (linha)</em>
          {brl(sale.amount)}
        </span>
        <span>
          <em>Receita líquida (linha)</em>
          {brl(sale.revenue, 'Não conciliada')}
        </span>
        <span>
          <em>Receita por unidade</em>
          {brl(unitRevenue)}
        </span>
        <span>
          <em>Lucro informado pelo Mercado Phone</em>
          {brl(sale.profit_reported, 'Não informado')}
        </span>
        <span>
          <em>Situação financeira</em>
          {sale.financial_note ?? (isReconciled(sale) ? 'Conciliado' : STATUS_TEXT[sale.financial_status] ?? 'Pendente')}
        </span>
      </div>
      {state.loading ? (
        <p className="fin-muted">
          <Loader2 size={13} className="fin-spin" /> Carregando pedido original…
        </p>
      ) : state.error ? (
        <p className="tone-deficit">Não foi possível carregar o pedido: {state.error}</p>
      ) : !state.details ? (
        <p className="fin-muted">Pedido original não disponível (venda importada antes do webhook). Pagamento: Não informado.</p>
      ) : (
        <div className="fin-order-grid">
          <span>
            <em>Cliente (pedido)</em>
            {state.details.customerName ?? 'Não informado'}
          </span>
          <span>
            <em>Pagamento</em>
            {state.details.payments.length > 0
              ? state.details.payments.map((p) => `${p.description ?? 'Não informado'} ${brl(p.amount, '')}`).join(' · ')
              : 'Não informado'}
          </span>
          <span>
            <em>Tipo de venda</em>
            {state.details.saleType ?? 'Não informado'}
          </span>
          <span>
            <em>Itens do pedido</em>
            {state.details.items
              .map((it) => `${it.name ?? 'Item'}${it.sellerId ? ` (${sellerNames.get(it.sellerId) ?? 'vendedor'})` : ''}`)
              .join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}
