import { formatDateBR, wallClock } from '../lib/finance/dates';
import React, { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/brand/BrandLogo';
import {
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  ShoppingBag,
  SlidersHorizontal,
  Trophy,
  CircleDollarSign,
  TrendingUp,
  Receipt,
} from 'lucide-react';
import './Sales.css';
import {
  fetchProducts,
  fetchSellers,
  fetchSalesInRange,
  classifyProductCategory,
  getMonthRange,
  getWeekRange,
  getDayRange,
  fetchSaleOrderDetails,
} from '../lib/api';
import { parseSaleExternalId, summarizeSaleItems } from '../lib/saleDetails';
import { computeSalesMetrics, type OrderProfit, type ProductRank } from '../lib/finance/salesMetrics';
import { normalizeName } from '../lib/finance/appleProducts';
import { MetricCard, MetricDetailModal, MetricGrid, StickyFilterBar } from '../components/metrics/MetricPanel';
import type { SaleOrderDetails } from '../lib/saleDetails';
import type { Sale, Product, Seller } from '../lib/database.types';

export type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'custom';

export interface SaleRow extends Sale {
  productName: string;
  productCategory: 'Aparelhos' | 'Acessórios';
  sellerName: string;
}

// `sold_at` é o relógio da loja gravado como UTC: strings usam wallClock (sem converter fuso).
function formatDate(isoOrDate: string | Date): string {
  if (typeof isoOrDate === 'string') return formatDateBR(wallClock(isoOrDate).date);
  return isoOrDate.toLocaleDateString('pt-BR');
}

function formatDateTime(iso: string): string {
  const w = wallClock(iso);
  return `${formatDateBR(w.date)} ${w.time}`;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatOptionalCurrency(value: number | null): string {
  return value == null ? '—' : formatCurrency(value);
}

function toISODateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISODateInput(val: string): Date {
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Retorna o intervalo { start, end, label } para o preset escolhido */
export function calculateDateRange(preset: DatePreset, customStart: Date, customEnd: Date): { start: Date; end: Date; label: string } {
  const now = new Date();

  switch (preset) {
    case 'today': {
      const { start, end } = getDayRange(now);
      return { start, end, label: `Hoje (${formatDate(start)})` };
    }
    case 'yesterday': {
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const { start, end } = getDayRange(yesterday);
      return { start, end, label: `Ontem (${formatDate(start)})` };
    }
    case 'this_week': {
      const { start, end } = getWeekRange(now);
      const displayEnd = new Date(end.getTime() - 86400000);
      return { start, end, label: `Esta semana (${formatDate(start)} a ${formatDate(displayEnd)})` };
    }
    case 'this_month': {
      const { start, end } = getMonthRange(now);
      const monthName = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return { start, end, label: `Este mês (${monthName})` };
    }
    case 'last_month': {
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const { start, end } = getMonthRange(lastMonthDate);
      const monthName = start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return { start, end, label: `Mês anterior (${monthName})` };
    }
    case 'custom': {
      const start = new Date(customStart.getFullYear(), customStart.getMonth(), customStart.getDate(), 0, 0, 0, 0);
      const end = new Date(customEnd.getFullYear(), customEnd.getMonth(), customEnd.getDate() + 1, 0, 0, 0, 0);
      return {
        start,
        end,
        label: `${formatDate(customStart)} a ${formatDate(customEnd)}`,
      };
    }
  }
}

// ============================================================
// Modal de Período Personalizado
// ============================================================
interface CustomRangeModalProps {
  initialStart: Date;
  initialEnd: Date;
  onApply: (start: Date, end: Date) => void;
  onClose: () => void;
}

function CustomRangeModal({ initialStart, initialEnd, onApply, onClose }: CustomRangeModalProps) {
  const [startDateStr, setStartDateStr] = useState(() => toISODateInput(initialStart));
  const [endDateStr, setEndDateStr] = useState(() => toISODateInput(initialEnd));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const start = parseISODateInput(startDateStr);
    const end = parseISODateInput(endDateStr);
    if (start > end) {
      alert('A data inicial não pode ser posterior à data final.');
      return;
    }
    onApply(start, end);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sales-modal-shell" onClick={(e) => e.stopPropagation()}>
        <div className="sales-modal-header">
          <h3 className="sales-modal-title">Selecionar Período Personalizado</h3>
          <button className="sales-modal-close-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="sales-modal-body">
            <div className="custom-date-inputs">
              <div className="custom-date-field">
                <label>Data Inicial</label>
                <input
                  type="date"
                  value={startDateStr}
                  onChange={(e) => setStartDateStr(e.target.value)}
                  required
                />
              </div>

              <div className="custom-date-field">
                <label>Data Final</label>
                <input
                  type="date"
                  value={endDateStr}
                  onChange={(e) => setEndDateStr(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="sales-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary">
              Aplicar Período
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Modal de Detalhes da Venda
// ============================================================
type OrderState =
  | { status: 'loading' }
  | { status: 'ready'; details: SaleOrderDetails }
  | { status: 'missing' }
  | { status: 'error' };

function SaleDetailModal({
  sale,
  sellerNames,
  onClose,
}: {
  sale: SaleRow;
  sellerNames: Map<string, string>;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<OrderState>({ status: 'loading' });
  const unitPrice = sale.quantity > 0 ? sale.amount / sale.quantity : sale.amount;
  const orderId = parseSaleExternalId(sale.external_id)?.orderId ?? null;

  useEffect(() => {
    let isMounted = true;
    fetchSaleOrderDetails(sale.external_id)
      .then((details) => {
        if (isMounted) setOrder(details ? { status: 'ready', details } : { status: 'missing' });
      })
      .catch((err) => {
        console.error('Erro ao buscar detalhes da venda:', err);
        if (isMounted) setOrder({ status: 'error' });
      });
    return () => {
      isMounted = false;
    };
  }, [sale.external_id]);

  const details = order.status === 'ready' ? order.details : null;
  const currentItem = details?.items[details.currentItemIndex] ?? null;
  const isCanceled = Boolean(details && (details.canceledAt || (details.status && details.status.toLowerCase() !== 'concluido')));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="sales-modal-shell sales-detail-shell" onClick={(e) => e.stopPropagation()}>
        <div className="sales-modal-header">
          <div>
            <h3 className="sales-modal-title">Detalhes da Venda</h3>
            <p className="text-muted text-sm" style={{ marginTop: '2px' }}>
              Realizada em {formatDateTime(sale.sold_at)}
              {orderId && ` · Venda nº ${orderId}`}
            </p>
          </div>
          <button className="sales-modal-close-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="sales-modal-body">
          <div className="sales-detail-item sales-detail-customer">
            <span className="sales-detail-label">Cliente</span>
            {order.status === 'loading' && <span className="sales-detail-val sales-detail-placeholder">Carregando...</span>}
            {details && (
              <span className={`sales-detail-val ${details.customerName ? '' : 'sales-detail-placeholder'}`}>
                {details.customerName ?? 'Não informado pelo MercadoPhone'}
              </span>
            )}
            {order.status === 'missing' && (
              <span className="sales-detail-val sales-detail-placeholder">Não disponível para esta venda</span>
            )}
            {order.status === 'error' && (
              <span className="sales-detail-val sales-detail-placeholder">Não foi possível carregar</span>
            )}
          </div>

          {isCanceled && details && (
            <div className="sales-detail-notice danger">
              Situação no MercadoPhone: <strong>{details.status ?? 'cancelada'}</strong>
              {details.canceledAt && ` · cancelada em ${details.canceledAt}`}
              {details.cancelReason && ` · ${details.cancelReason}`}
            </div>
          )}

          <div className="sales-detail-grid">
            <div className="sales-detail-item full-width">
              <span className="sales-detail-label">Item selecionado</span>
              <span className="sales-detail-val">{sale.productName}</span>
            </div>

            <div className="sales-detail-item">
              <span className="sales-detail-label">Categoria</span>
              <span className="sales-detail-val">
                <span className={`category-badge ${sale.productCategory === 'Aparelhos' ? 'aparelhos' : 'acessorios'}`}>
                  {sale.productCategory}
                </span>
              </span>
            </div>

            <div className="sales-detail-item">
              <span className="sales-detail-label">Vendedor do Item</span>
              <span className="sales-detail-val">{sale.sellerName}</span>
            </div>

            <div className="sales-detail-item">
              <span className="sales-detail-label">Quantidade</span>
              <span className="sales-detail-val">{sale.quantity} un.</span>
            </div>

            <div className="sales-detail-item">
              <span className="sales-detail-label">Preço Unitário</span>
              <span className="sales-detail-val">{formatCurrency(unitPrice)}</span>
            </div>

            {currentItem?.imei && (
              <div className="sales-detail-item">
                <span className="sales-detail-label">IMEI</span>
                <span className="sales-detail-val sales-detail-mono">{currentItem.imei}</span>
              </div>
            )}

            {currentItem?.serialNumber && (
              <div className="sales-detail-item">
                <span className="sales-detail-label">Nº de Série</span>
                <span className="sales-detail-val sales-detail-mono">{currentItem.serialNumber}</span>
              </div>
            )}

            {currentItem?.discount != null && currentItem.discount > 0 && (
              <div className="sales-detail-item">
                <span className="sales-detail-label">Desconto no Item</span>
                <span className="sales-detail-val">{formatCurrency(currentItem.discount)}</span>
              </div>
            )}

            <div className="sales-detail-item full-width">
              <span className="sales-detail-label">Valor do Item</span>
              <span className="sales-detail-val" style={{ color: 'var(--accent-text)', fontSize: '18px' }}>
                {formatCurrency(sale.amount)}
                {sale.amount === 0 && sale.productCategory === 'Acessórios' && (
                  <span className="text-muted text-sm" style={{ marginLeft: '8px', fontWeight: 400 }}>
                    (Brinde / Cortesia)
                  </span>
                )}
              </span>
            </div>
          </div>

          {details && (
            <>
              {(details.orderSellerName || details.saleType || details.deliveryType || details.salesChannel) && (
                <div className="sales-detail-grid">
                  {details.orderSellerName && (
                    <div className="sales-detail-item">
                      <span className="sales-detail-label">Vendedor da Venda</span>
                      <span className="sales-detail-val">{details.orderSellerName}</span>
                    </div>
                  )}
                  {details.saleType && (
                    <div className="sales-detail-item">
                      <span className="sales-detail-label">Tipo de Venda</span>
                      <span className="sales-detail-val">{details.saleType}</span>
                    </div>
                  )}
                  {details.deliveryType && (
                    <div className="sales-detail-item">
                      <span className="sales-detail-label">Entrega</span>
                      <span className="sales-detail-val">{details.deliveryType}</span>
                    </div>
                  )}
                  {details.salesChannel && (
                    <div className="sales-detail-item">
                      <span className="sales-detail-label">Canal de Venda</span>
                      <span className="sales-detail-val">{details.salesChannel}</span>
                    </div>
                  )}
                </div>
              )}

              {details.items.length > 1 && (
                <div className="sales-detail-section">
                  <span className="sales-detail-label">Itens desta venda ({details.items.length})</span>
                  {(() => {
                    const summary = summarizeSaleItems(details.items);
                    return (
                      <span className="sales-detail-summary">
                        Esta venda: <strong>{summary.devices} {summary.devices === 1 ? 'aparelho' : 'aparelhos'}</strong> ·{' '}
                        {summary.accessories} {summary.accessories === 1 ? 'acessório' : 'acessórios'} · {summary.gifts}{' '}
                        {summary.gifts === 1 ? 'brinde' : 'brindes'}
                      </span>
                    );
                  })()}
                  <ul className="sales-detail-list">
                    {details.items.map((item, index) => {
                      const itemSeller = item.sellerId ? sellerNames.get(item.sellerId) : undefined;
                      return (
                        <li key={index} className={index === details.currentItemIndex ? 'is-current' : undefined}>
                          <span className="sales-detail-list-name">
                            {item.name ?? 'Item sem descrição'}
                            <span className="sales-detail-list-meta">
                              {itemSeller && `Vendedor: ${itemSeller}`}
                              {itemSeller && item.quantity != null && ' · '}
                              {item.quantity != null && `Quantidade: ${item.quantity}`}
                            </span>
                          </span>
                          <span className="sales-detail-list-amount">
                            {item.total === 0 && <span className="sales-detail-gift">Brinde</span>}
                            {formatOptionalCurrency(item.total)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {details.payments.length > 0 && (
                <div className="sales-detail-section">
                  <span className="sales-detail-label">Formas de Pagamento</span>
                  <ul className="sales-detail-list">
                    {details.payments.map((payment, index) => (
                      <li key={index}>
                        <span className="sales-detail-list-name">{payment.description ?? 'Não informada'}</span>
                        <span className="sales-detail-list-amount">{formatOptionalCurrency(payment.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="sales-detail-section">
                <ul className="sales-detail-list">
                  {details.discount != null && details.discount > 0 && (
                    <li>
                      <span className="sales-detail-list-name">Desconto na venda</span>
                      <span className="sales-detail-list-amount">{formatCurrency(details.discount)}</span>
                    </li>
                  )}
                  <li className="sales-detail-total">
                    <span className="sales-detail-list-name">Total da venda</span>
                    <span className="sales-detail-list-amount">{formatOptionalCurrency(details.total)}</span>
                  </li>
                </ul>
              </div>
            </>
          )}

          {details && details.currentItemIndex === -1 && (
            <div className="sales-detail-notice">
              Este item não aparece na versão mais recente desta venda no MercadoPhone — a venda pode ter sido
              editada depois do registro.
            </div>
          )}

          {order.status === 'missing' && (
            <div className="sales-detail-notice">
              O MercadoPhone não enviou os dados completos desta venda (cliente, pagamento e demais itens). Isso
              acontece com vendas importadas antes da integração por webhook.
            </div>
          )}

          {order.status === 'error' && (
            <div className="sales-detail-notice danger">
              Não foi possível carregar os dados do cliente e do pagamento. Feche e abra os detalhes novamente.
            </div>
          )}
        </div>

        <div className="sales-modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Página Principal de Vendas
// ============================================================
export function Sales() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);

  // Filtro de Período Principal no Topo Direito
  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: now,
    };
  });
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);

  // Vendas carregadas para o período ativo
  const [sales, setSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(true);

  // Filtros Secundários da Tabela
  const [productFilter, setProductFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'Aparelhos' | 'Acessórios'>('all');
  const [sellerFilter, setSellerFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Modal de Detalhes da Venda
  const [detailSale, setDetailSale] = useState<SaleRow | null>(null);
  // Detalhamento dos cards
  const [metricDetail, setMetricDetail] = useState<'units' | 'ranking' | 'revenue' | 'profit' | 'avg' | null>(null);
  // Filtro de categoria no modal de Ranking de Produtos Vendidos
  const [rankingCategoryFilter, setRankingCategoryFilter] = useState<'all' | 'Aparelhos' | 'Acessórios'>('all');

  // Paginação da Tabela
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 15;

  // 1. Carga inicial de Produtos e Vendedores
  useEffect(() => {
    Promise.all([fetchProducts(), fetchSellers()])
      .then(([prods, sels]) => {
        setProducts(prods);
        setSellers(sels);
      })
      .finally(() => setLoadingBase(false));
  }, []);

  // 2. Intervalo de data atual calculado
  const activeRange = useMemo(() => {
    return calculateDateRange(datePreset, customRange.start, customRange.end);
  }, [datePreset, customRange]);

  // 3. Busca de vendas sempre que o intervalo ativo mudar
  useEffect(() => {
    let isMounted = true;
    setLoadingSales(true);

    fetchSalesInRange(activeRange.start, activeRange.end)
      .then((data) => {
        if (isMounted) {
          setSales(data);
          setCurrentPage(1);
        }
      })
      .catch((err) => console.error('Erro ao buscar vendas:', err))
      .finally(() => {
        if (isMounted) setLoadingSales(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeRange]);

  // Mapeamentos
  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const sellerMap = useMemo(() => new Map(sellers.map((s) => [s.id, s])), [sellers]);
  const sellerNames = useMemo(() => new Map(sellers.map((s) => [s.id, s.name])), [sellers]);

  // Vendas mapeadas com categoria e nomes
  const salesRows: SaleRow[] = useMemo(() => {
    return sales
      .map((sale) => {
        const product = productMap.get(sale.product_id);
        const seller = sellerMap.get(sale.seller_id);
        const productName = product?.name ?? 'Produto removido';
        return {
          ...sale,
          productName,
          productCategory: classifyProductCategory(productName),
          sellerName: seller?.name ?? 'Vendedor removido',
        };
      })
      .sort((a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime());
  }, [sales, productMap, sellerMap]);

  // ============================================================
  // FILTRAGEM DA TABELA
  // ============================================================
  const filteredSales = useMemo(() => {
    let list = salesRows;

    if (productFilter !== 'all') {
      list = list.filter((r) => r.product_id === productFilter);
    }
    if (categoryFilter !== 'all') {
      list = list.filter((r) => r.productCategory === categoryFilter);
    }
    if (sellerFilter !== 'all') {
      list = list.filter((r) => r.seller_id === sellerFilter);
    }
    if (search.trim()) {
      // Sem diferenciar acento/maiúscula ("pelicula" acha "PELÍCULA"), como na aba Estoque.
      const q = normalizeName(search);
      list = list.filter((r) => normalizeName(r.productName).includes(q));
    }

    return list;
  }, [salesRows, productFilter, categoryFilter, sellerFilter, search]);

  // ============================================================
  // 5 INDICADORES — sobre as vendas FILTRADAS (período + produto + categoria + vendedor + busca)
  // ============================================================
  const metrics = useMemo(() => {
    // Uma linha de `sales` é um ITEM; uma venda pode ter vários itens. Mesmas regras do Dashboard
    // (aparelho = iPhone; acessório = valor > 0; brinde fora; faturamento/lucro só conciliados).
    const names = new Map([...productMap.values()].map((p) => [p.id, p.name]));
    const rows = filteredSales.map((s) => ({
      ...(s as unknown as Parameters<typeof computeSalesMetrics>[0][number]),
      mp_order_id: s.mp_order_id ?? parseSaleExternalId(s.external_id)?.orderId ?? null,
    }));
    return computeSalesMetrics(rows, names);
  }, [filteredSales, productMap]);
  const topRank = metrics.ranking[0] ?? null;
  const filterScope = [
    activeRange.label,
    productFilter !== 'all' ? productMap.get(productFilter)?.name : null,
    categoryFilter !== 'all' ? categoryFilter : null,
    sellerFilter !== 'all' ? sellerNames.get(sellerFilter) : null,
    search.trim() ? `busca “${search.trim()}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Faturamento: só itens pagos pendentes mudam o total. Lucro: brinde pendente também (custo desconhecido).
  const revenuePendingNote =
    metrics.pendingPaidItems > 0
      ? `Parcial: ${metrics.pendingPaidItems} item(ns) pago(s) ainda não conciliado(s) (${formatCurrency(metrics.pendingAmount)}) fora da soma`
      : null;
  const pendingNote =
    metrics.pendingItems > 0 ? `Parcial: ${metrics.pendingItems} item(ns) ainda não conciliado(s) (custo/receita pendentes) fora da soma` : null;

  // Vendas consideradas no modal de Ranking:
  // Respeita todos os filtros da página (período, produto, vendedor, busca),
  // enquanto a categoria é controlada dinamicamente pelo seletor interno [ Todos | Aparelhos | Acessórios ]
  const modalRankingSales = useMemo(() => {
    let list = salesRows;

    if (productFilter !== 'all') {
      list = list.filter((r) => r.product_id === productFilter);
    }
    if (sellerFilter !== 'all') {
      list = list.filter((r) => r.seller_id === sellerFilter);
    }
    if (search.trim()) {
      const q = normalizeName(search);
      list = list.filter((r) => normalizeName(r.productName).includes(q));
    }

    return list;
  }, [salesRows, productFilter, sellerFilter, search]);

  const modalRankingMetrics = useMemo(() => {
    const names = new Map([...productMap.values()].map((p) => [p.id, p.name]));
    const rows = modalRankingSales.map((s) => ({
      ...(s as unknown as Parameters<typeof computeSalesMetrics>[0][number]),
      mp_order_id: s.mp_order_id ?? parseSaleExternalId(s.external_id)?.orderId ?? null,
    }));
    return computeSalesMetrics(rows, names);
  }, [modalRankingSales, productMap]);

  // Linhas filtradas pela categoria selecionada dentro do modal
  const rankingRows = useMemo(() => {
    let list = modalRankingMetrics.ranking;
    if (rankingCategoryFilter !== 'all') {
      list = list.filter((r) => r.category === rankingCategoryFilter);
    }
    return list;
  }, [modalRankingMetrics.ranking, rankingCategoryFilter]);

  const rankingScope = useMemo(() => {
    const cat = rankingCategoryFilter === 'all' ? null : rankingCategoryFilter;
    return [
      activeRange.label,
      productFilter !== 'all' ? productMap.get(productFilter)?.name : null,
      cat,
      sellerFilter !== 'all' ? sellerNames.get(sellerFilter) : null,
      search.trim() ? `busca “${search.trim()}”` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }, [activeRange.label, productFilter, productMap, rankingCategoryFilter, sellerFilter, sellerNames, search]);

  const rankingToolbar = (
    <div className="mc-modal-filter-group" role="tablist" aria-label="Filtrar por categoria">
      <button
        type="button"
        role="tab"
        aria-selected={rankingCategoryFilter === 'all'}
        className={`mc-modal-filter-btn ${rankingCategoryFilter === 'all' ? 'active' : ''}`}
        onClick={() => setRankingCategoryFilter('all')}
      >
        Todos
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={rankingCategoryFilter === 'Aparelhos'}
        className={`mc-modal-filter-btn ${rankingCategoryFilter === 'Aparelhos' ? 'active' : ''}`}
        onClick={() => setRankingCategoryFilter('Aparelhos')}
      >
        Aparelhos
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={rankingCategoryFilter === 'Acessórios'}
        className={`mc-modal-filter-btn ${rankingCategoryFilter === 'Acessórios' ? 'active' : ''}`}
        onClick={() => setRankingCategoryFilter('Acessórios')}
      >
        Acessórios
      </button>
    </div>
  );

  // Paginação
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const paginatedSales = useMemo(() => {
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    return filteredSales.slice(startIdx, startIdx + PAGE_SIZE);
  }, [filteredSales, currentPage]);

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as DatePreset;
    setDatePreset(val);
    if (val === 'custom') {
      setIsCustomModalOpen(true);
    }
  };

  const isLoading = loadingBase || loadingSales;

  return (
    <div className="sales-page-container">
      {/* 1. Header com Título e Filtro de Período no Topo Direito */}
      <div className="sales-header">
        <div className="sales-header-left">
          <h1 className="sales-header-title">Vendas</h1>
          <p className="sales-header-subtitle">
            Gerencie as vendas realizadas na plataforma, acompanhe o desempenho dos vendedores e consulte o histórico por período.
          </p>
        </div>

        <div className="sales-date-filter-container">
          <div className="sales-date-filter-label">
            <Calendar size={16} color="var(--accent-text)" />
            <span>Período:</span>
          </div>

          <select
            className="sales-date-select"
            value={datePreset}
            onChange={handlePresetChange}
          >
            <option value="today">Hoje</option>
            <option value="yesterday">Ontem</option>
            <option value="this_week">Esta semana</option>
            <option value="this_month">Este mês</option>
            <option value="last_month">Mês anterior</option>
            <option value="custom">
              {datePreset === 'custom' ? `Personalizado (${activeRange.label})` : 'Período personalizado...'}
            </option>
          </select>

          {datePreset === 'custom' && (
            <button
              className="sales-custom-date-btn"
              onClick={() => setIsCustomModalOpen(true)}
              title="Ajustar datas do período personalizado"
            >
              <SlidersHorizontal size={14} />
              <span>Ajustar</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Filtros — fixos no topo durante a rolagem */}
      <StickyFilterBar
        summary={
          <>
            <strong>{filteredSales.length}</strong> {filteredSales.length === 1 ? 'item' : 'itens'} · {filterScope} · os indicadores e a listagem seguem estes filtros
          </>
        }
      >
        <div className="sales-filters-grid">
          <select
            value={productFilter}
            onChange={(e) => {
              setProductFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Todos os produtos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value as typeof categoryFilter);
              setCurrentPage(1);
            }}
          >
            <option value="all">Todas as categorias</option>
            <option value="Aparelhos">Aparelhos</option>
            <option value="Acessórios">Acessórios</option>
          </select>

          <select
            value={sellerFilter}
            onChange={(e) => {
              setSellerFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="all">Todos os vendedores</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <div className="sales-search-wrapper">
            <Search size={16} className="sales-search-icon" />
            <input
              type="text"
              className="sales-search-input"
              placeholder="Buscar por produto..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>
      </StickyFilterBar>

      {/* 3. Cinco indicadores — respondem a todos os filtros e abrem o detalhamento */}
      <MetricGrid>
        <MetricCard
          icon={<ShoppingBag size={20} />}
          tone="blue"
          badge="Volume"
          label="Produtos vendidos"
          value={`${metrics.units.toLocaleString('pt-BR')} ${metrics.units === 1 ? 'unidade' : 'unidades'}`}
          caption={`${metrics.devices} ${metrics.devices === 1 ? 'aparelho' : 'aparelhos'} · ${metrics.accessories} ${metrics.accessories === 1 ? 'acessório' : 'acessórios'} · ${metrics.orders} ${metrics.orders === 1 ? 'venda' : 'vendas'}${metrics.gifts > 0 ? ` · ${metrics.gifts} brinde(s) fora` : ''}`}
          loading={isLoading}
          onOpen={() => {
            setRankingCategoryFilter('all');
            setMetricDetail('units');
          }}
        />
        <MetricCard
          icon={<Trophy size={20} />}
          tone="green"
          badge={topRank?.category === 'Acessórios' ? 'Acessório' : 'Ranking'}
          label="Produto mais vendido"
          value={topRank ? topRank.name : 'Sem vendas'}
          caption={topRank ? `${topRank.units} ${topRank.units === 1 ? 'unidade vendida' : 'unidades vendidas'}` : 'Nenhum produto nos filtros'}
          loading={isLoading}
          onOpen={() => {
            setRankingCategoryFilter('all');
            setMetricDetail('ranking');
          }}
        />
        <MetricCard
          icon={<CircleDollarSign size={20} />}
          tone="purple"
          badge="Faturamento"
          label="Faturamento"
          value={formatCurrency(metrics.revenue)}
          caption="Valor de venda dos itens (valorTotal do Mercado Phone)"
          partial={revenuePendingNote}
          loading={isLoading}
          onOpen={() => setMetricDetail('revenue')}
        />
        <MetricCard
          icon={<TrendingUp size={20} />}
          tone="teal"
          badge="Lucro"
          label="Lucro bruto"
          value={formatCurrency(metrics.profit)}
          caption={metrics.revenue > 0 ? `Margem ${((metrics.profit / metrics.revenue) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · faturamento − custo` : 'Faturamento − custo dos produtos'}
          partial={pendingNote}
          loading={isLoading}
          onOpen={() => setMetricDetail('profit')}
        />
        <MetricCard
          icon={<Receipt size={20} />}
          tone="amber"
          badge="Média"
          label="Lucro médio por venda"
          value={metrics.avgProfitPerOrder != null ? formatCurrency(metrics.avgProfitPerOrder) : '—'}
          caption={`${metrics.reconciledOrders.length} ${metrics.reconciledOrders.length === 1 ? 'venda conciliada' : 'vendas conciliadas'}`}
          partial={metrics.pendingOrders > 0 ? `Parcial: ${metrics.pendingOrders} venda(s) com item a conciliar fora da média` : null}
          loading={isLoading}
          onOpen={() => setMetricDetail('avg')}
        />
      </MetricGrid>

      {/* 4. Tabela de Listagem de Vendas */}
      <div className="sales-table-card" style={{ opacity: isLoading ? 0.6 : 1 }}>
        <div className="sales-table-wrapper">
          <table className="sales-table">
            <thead>
              <tr>
                <th>PRODUTO</th>
                <th>CATEGORIA</th>
                <th>QUANTIDADE</th>
                <th>DATA DA COMPRA</th>
                <th>VENDEDOR</th>
                <th>AÇÕES</th>
              </tr>
            </thead>
            <tbody>
              {!isLoading && paginatedSales.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="Nenhuma venda encontrada">Ajuste o período ou os filtros selecionados.</EmptyState>
                  </td>
                </tr>
              )}
              {paginatedSales.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="product-name-cell">{row.productName}</span>
                  </td>
                  <td>
                    <span
                      className={`category-badge ${
                        row.productCategory === 'Aparelhos' ? 'aparelhos' : 'acessorios'
                      }`}
                    >
                      {row.productCategory}
                    </span>
                  </td>
                  <td className="qty-cell">{row.quantity} un.</td>
                  <td>{formatDate(row.sold_at)}</td>
                  <td>{row.sellerName}</td>
                  <td>
                    <button
                      className="sales-view-btn"
                      onClick={() => setDetailSale(row)}
                      title="Ver detalhes completos da venda"
                    >
                      <Eye size={14} />
                      <span>Visualizar</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 5. Barra de Paginação */}
        {filteredSales.length > 0 && (
          <div className="sales-pagination-bar">
            <span className="sales-pagination-info">
              Mostrando{' '}
              <strong>
                {Math.min(filteredSales.length, (currentPage - 1) * PAGE_SIZE + 1)} -{' '}
                {Math.min(filteredSales.length, currentPage * PAGE_SIZE)}
              </strong>{' '}
              de <strong>{filteredSales.length}</strong> vendas no período
            </span>

            <div className="sales-pagination-controls">
              <button
                className="sales-pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft size={16} />
                <span>Anterior</span>
              </button>

              <span className="sales-pagination-page-indicator">
                Página {currentPage} de {totalPages}
              </span>

              <button
                className="sales-pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <span>Próxima</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de Período Personalizado */}
      {isCustomModalOpen && (
        <CustomRangeModal
          initialStart={customRange.start}
          initialEnd={customRange.end}
          onApply={(start, end) => {
            setCustomRange({ start, end });
            setDatePreset('custom');
          }}
          onClose={() => setIsCustomModalOpen(false)}
        />
      )}

      {/* Detalhamento dos indicadores */}
      {metricDetail && (metricDetail === 'avg' ? (
        <MetricDetailModal<OrderProfit>
          title="Lucro médio por venda"
          scope={filterScope}
          formula={<>Lucro médio por venda = lucro bruto ÷ número de vendas (pedidos distintos). Só entram vendas com todos os itens filtrados conciliados; uma venda com vários itens conta uma vez.</>}
          columns={[
            { key: 'o', header: 'Venda', render: (o) => <strong>{o.orderId}</strong> },
            { key: 'd', header: 'Data', render: (o) => formatDate(o.soldAt) },
            { key: 's', header: 'Vendedor(es)', render: (o) => o.sellerIds.map((id) => sellerNames.get(id) ?? '—').join(', ') },
            { key: 'i', header: 'Itens', align: 'right', render: (o) => o.items },
            { key: 'f', header: 'Faturamento', align: 'right', render: (o) => formatCurrency(o.revenue) },
            { key: 'l', header: 'Lucro bruto', align: 'right', render: (o) => formatCurrency(o.profit) },
          ]}
          rows={metrics.reconciledOrders}
          rowKey={(o) => o.orderId}
          footer={[`${metrics.reconciledOrders.length} vendas`, '', '', '', '', metrics.avgProfitPerOrder != null ? `média ${formatCurrency(metrics.avgProfitPerOrder)}` : '—']}
          notes={metrics.pendingOrders > 0 ? `${metrics.pendingOrders} venda(s) com item ainda não conciliado ficaram fora (entram após a sincronização financeira).` : undefined}
          onClose={() => setMetricDetail(null)}
        />
      ) : (
        <MetricDetailModal<ProductRank>
          title={
            metricDetail === 'units'
              ? 'Produtos vendidos'
              : metricDetail === 'ranking'
                ? 'Ranking de produtos vendidos'
                : metricDetail === 'revenue'
                  ? 'Composição do faturamento'
                  : 'Composição do lucro bruto'
          }
          scope={metricDetail === 'ranking' || metricDetail === 'units' ? rankingScope : filterScope}
          toolbar={metricDetail === 'ranking' || metricDetail === 'units' ? rankingToolbar : undefined}
          formula={
            metricDetail === 'units' || metricDetail === 'ranking' ? (
              <>Unidades = soma das quantidades de cada item (aparelhos = iPhones; acessórios = pagos). Brindes (valor R$ 0) e vendas canceladas não entram. iPhones agrupados por modelo.</>
            ) : metricDetail === 'revenue' ? (
              <>Faturamento = soma do valor de venda de cada item (valorTotal do Mercado Phone), atribuído ao vendedor do item. Itens ainda não conciliados ficam fora até a sincronização. Não é lucro.</>
            ) : (
              <>Lucro bruto = faturamento − custo histórico dos produtos (Mercado Phone). Não desconta despesas, impostos ou comissões. O custo dos brindes entra no total da venda (não aparece por produto).</>
            )
          }
          columns={
            metricDetail === 'units' || metricDetail === 'ranking'
              ? [
                  { key: 'i', header: '#', render: (r) => String(rankingRows.indexOf(r) + 1).padStart(2, '0') },
                  { key: 'n', header: 'Produto', render: (r) => <strong>{r.name}</strong> },
                  { key: 'c', header: 'Categoria', render: (r) => r.category },
                  { key: 'u', header: 'Unidades', align: 'right', render: (r) => r.units },
                  { key: 'f', header: 'Faturamento', align: 'right', render: (r) => formatCurrency(r.revenue) },
                ]
              : metricDetail === 'revenue'
                ? [
                    { key: 'n', header: 'Produto', render: (r) => <strong>{r.name}</strong> },
                    { key: 'u', header: 'Unidades', align: 'right', render: (r) => r.units },
                    { key: 'f', header: 'Faturamento', align: 'right', render: (r) => formatCurrency(r.revenue) },
                    { key: 'p', header: 'A conciliar', align: 'right', render: (r) => (r.pendingItems > 0 ? `${r.pendingItems} item(ns)` : '—') },
                  ]
                : [
                    { key: 'n', header: 'Produto', render: (r) => <strong>{r.name}</strong> },
                    { key: 'u', header: 'Unidades', align: 'right', render: (r) => r.units },
                    { key: 'f', header: 'Faturamento', align: 'right', render: (r) => formatCurrency(r.revenue) },
                    { key: 'c', header: 'Custo', align: 'right', render: (r) => formatCurrency(r.cost) },
                    { key: 'l', header: 'Lucro bruto', align: 'right', render: (r) => formatCurrency(r.profit) },
                  ]
          }
          rows={
            metricDetail === 'revenue'
              ? [...metrics.ranking].sort((a, b) => b.revenue - a.revenue)
              : metricDetail === 'profit'
                ? [...metrics.ranking].sort((a, b) => b.profit - a.profit)
                : rankingRows
          }
          rowKey={(r) => `${r.category}|${r.name}`}
          footer={
            metricDetail === 'units' || metricDetail === 'ranking'
              ? [
                  '',
                  'Total',
                  '',
                  rankingRows.reduce((a, r) => a + r.units, 0),
                  formatCurrency(rankingRows.reduce((a, r) => a + r.revenue, 0)),
                ]
              : metricDetail === 'revenue'
                ? (() => {
                    // Soma das linhas (produtos vendidos; brindes não aparecem por produto).
                    const pending = metrics.ranking.reduce((a, r) => a + r.pendingItems, 0);
                    return ['Total', metrics.units, formatCurrency(metrics.revenue), pending > 0 ? `${pending} item(ns)` : '—'];
                  })()
                : [
                    'Total (inclui custo dos brindes)',
                    metrics.units,
                    formatCurrency(metrics.revenue),
                    formatCurrency(metrics.cost),
                    formatCurrency(metrics.profit),
                  ]
          }
          emptyText={
            (metricDetail === 'ranking' || metricDetail === 'units') && rankingCategoryFilter !== 'all'
              ? `Nenhum produto da categoria ${rankingCategoryFilter.toLowerCase()} vendido com os filtros atuais.`
              : undefined
          }
          notes={metricDetail === 'units' && metrics.gifts > 0 ? `${metrics.gifts} brinde(s) entregues nas vendas filtradas não contam como produto vendido.` : pendingNote ?? undefined}
          onClose={() => {
            setMetricDetail(null);
            setRankingCategoryFilter('all');
          }}
        />
      ))}

      {/* Modal de Detalhes da Venda */}
      {detailSale && (
        <SaleDetailModal
          key={detailSale.id}
          sale={detailSale}
          sellerNames={sellerNames}
          onClose={() => setDetailSale(null)}
        />
      )}
    </div>
  );
}
