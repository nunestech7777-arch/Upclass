import { formatDateBR, wallClock } from '../lib/finance/dates';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  X,
  Smartphone,
  Headphones,
  ShoppingBag,
  SlidersHorizontal,
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
import { summarizeUnits, topProduct } from '../lib/finance/dashboard';
import type { FinanceSale } from '../lib/finance/calc';
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
              <span className="sales-detail-val" style={{ color: 'var(--primary)', fontSize: '18px' }}>
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
  // CÁLCULO DOS 3 CARDS PRINCIPAIS
  // ============================================================
  const metrics = useMemo(() => {
    // Uma linha de `sales` é um ITEM; uma venda pode ter vários itens (ex.: 8613940 tem 2 iPhones e
    // 4 brindes). Vendas = pedidos distintos; aparelhos/acessórios = soma das quantidades dos itens —
    // as mesmas regras e funções do Dashboard (aparelho = iPhone; acessório = valor > 0; brinde fora).
    const names = new Map([...productMap.values()].map((p) => [p.id, p.name]));
    const rows = sales.map((s) => ({
      ...s,
      mp_order_id: s.mp_order_id ?? parseSaleExternalId(s.external_id)?.orderId ?? null,
    })) as unknown as FinanceSale[];
    const units = summarizeUnits(rows, names);
    const topDevice = topProduct(rows, names, 'devices');
    const topAccessory = topProduct(rows, names, 'accessories');

    return {
      totalSalesCount: units.orders,
      units,
      topDevice: topDevice ? { name: topDevice.name, qty: topDevice.qty } : null,
      topAccessory: topAccessory ? { name: topAccessory.name, qty: topAccessory.qty } : null,
    };
  }, [sales, productMap]);

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
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.productName.toLowerCase().includes(q));
    }

    return list;
  }, [salesRows, productFilter, categoryFilter, sellerFilter, search]);

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
            <Calendar size={16} color="var(--primary)" />
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

      {/* 2. Os 3 Cards Principais Repaginados */}
      <div className="sales-cards-grid">
        {/* Card 1 — Vendas Realizadas */}
        <div className="sales-metric-card">
          <div className="sales-metric-header">
            <div className="sales-metric-icon-box sales-total">
              <ShoppingBag size={22} />
            </div>
            <span className="sales-metric-badge">Volume</span>
          </div>
          <span className="sales-metric-title">Vendas Realizadas</span>
          <div className="sales-metric-main-value">
            {isLoading ? '...' : `${metrics.totalSalesCount} ${metrics.totalSalesCount === 1 ? 'venda' : 'vendas'}`}
          </div>
          <span className="sales-metric-subtext">
            {isLoading
              ? 'no período selecionado'
              : `${metrics.units.devices} ${metrics.units.devices === 1 ? 'aparelho' : 'aparelhos'} · ${metrics.units.accessories} ${metrics.units.accessories === 1 ? 'acessório' : 'acessórios'} · ${metrics.units.gifts} ${metrics.units.gifts === 1 ? 'brinde' : 'brindes'} · ${metrics.units.items} itens`}
          </span>
        </div>

        {/* Card 2 — Aparelho Mais Vendido */}
        <div className="sales-metric-card">
          <div className="sales-metric-header">
            <div className="sales-metric-icon-box device-top">
              <Smartphone size={22} />
            </div>
            <span className="sales-metric-badge" style={{ color: '#10B981' }}>iPhone</span>
          </div>
          <span className="sales-metric-title">Aparelho Mais Vendido</span>
          <div
            className="sales-metric-main-value"
            title={metrics.topDevice?.name ?? 'Sem vendas de aparelhos'}
          >
            {isLoading
              ? '...'
              : metrics.topDevice
              ? metrics.topDevice.name
              : 'Sem vendas de aparelhos'}
          </div>
          <span className="sales-metric-subtext">
            {metrics.topDevice ? (
              <>
                <strong className="sales-metric-subtext-highlight">
                  {metrics.topDevice.qty}
                </strong>{' '}
                {metrics.topDevice.qty === 1 ? 'unidade vendida' : 'unidades vendidas'}
              </>
            ) : (
              '0 unidades vendidas'
            )}
          </span>
        </div>

        {/* Card 3 — Acessório Mais Vendido */}
        <div className="sales-metric-card">
          <div className="sales-metric-header">
            <div className="sales-metric-icon-box accessory-top">
              <Headphones size={22} />
            </div>
            <span className="sales-metric-badge" style={{ color: '#A855F7' }}>Acessório</span>
          </div>
          <span className="sales-metric-title">Acessório Mais Vendido</span>
          <div
            className="sales-metric-main-value"
            title={metrics.topAccessory?.name ?? 'Sem vendas de acessórios'}
          >
            {isLoading
              ? '...'
              : metrics.topAccessory
              ? metrics.topAccessory.name
              : 'Sem vendas de acessórios'}
          </div>
          <span className="sales-metric-subtext">
            {metrics.topAccessory ? (
              <>
                <strong className="sales-metric-subtext-highlight">
                  {metrics.topAccessory.qty}
                </strong>{' '}
                {metrics.topAccessory.qty === 1 ? 'unidade vendida' : 'unidades vendidas'}
              </>
            ) : (
              '0 unidades vendidas'
            )}
          </span>
        </div>
      </div>

      {/* 3. Filtros Secundários da Tabela */}
      <div className="sales-filters-card">
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
      </div>

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
                  <td colSpan={6} style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Nenhuma venda encontrada para o período e filtros selecionados.
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
