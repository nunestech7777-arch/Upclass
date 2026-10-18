import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Smartphone,
  Headphones,
  ShoppingBag,
  Search,
  Calendar,
  User,
  DollarSign,
  TrendingUp,
  CreditCard,
  ArrowUpDown,
  Download,
  Tag,
  ShieldCheck,
  BatteryCharging,
  Layers,
} from 'lucide-react';
import {
  fetchProducts,
  fetchSellers,
  fetchSalesInRange,
  fetchAllSales,
  classifyProductCategory,
  getMonthRange,
  getDayRange,
} from '../lib/api';
import type { Sale, Product, Seller } from '../lib/database.types';
import { formatDateBR, formatWallDateTime, wallClock } from '../lib/finance/dates';
import './SoldProductsModal.css';

export type ProductTypeFilter = 'all' | 'Aparelhos' | 'Acessórios';
export type PeriodFilterOption = 'today' | '7days' | '30days' | 'month' | 'custom' | 'all';

export interface SoldProductsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: ProductTypeFilter;
  initialSellerId?: string | null;
  initialPeriod?: PeriodFilterOption;
  /** Período exato (AAAA-MM-DD) vindo do filtro do Dashboard; sobrepõe `initialPeriod`. */
  initialStartDate?: string;
  initialEndDate?: string;
  sellerName?: string;
}

export interface EnrichedSoldItem {
  id: string;
  saleId: string;
  soldAt: string;
  quantity: number;
  totalAmount: number;
  unitPrice: number;

  // Product Data
  productId: string;
  productName: string;
  category: 'Aparelhos' | 'Acessórios';
  brand: string | null;
  code: string;
  imei: string | null;
  batteryHealth: string | null;

  // Parsed iPhone Specs
  capacity: string | null;
  color: string | null;
  grade: string | null;

  // Cost & Profit
  unitCost: number | null;
  totalCost: number | null;
  profit: number | null;
  marginPercent: number | null;

  // Seller Data
  sellerId: string;
  sellerName: string;

  // Cliente informado pelo histórico do MercadoPhone; pagamento não é armazenado por item.
  customerName: string;
}

function parseCapacity(name: string): string | null {
  const match = name.match(/\b(16|32|64|128|256|512)\s*GB\b|\b(1|2)\s*TB\b/i);
  return match ? match[0].toUpperCase() : null;
}

function parseColor(name: string): string | null {
  const colorKeywords = [
    'Titânio Natural', 'Titânio Preto', 'Titânio Branco', 'Titânio Azul', 'Desert Titanium',
    'Sierra Blue', 'Alpine Green', 'Midnight', 'Starlight', 'Space Gray', 'Cinza Espacial',
    'Deep Purple', 'Roxo Profundo', 'Grafite', 'Graphite', 'Preto', 'Black', 'Branco', 'White',
    'Azul', 'Blue', 'Vermelho', 'Red', 'Verde', 'Green', 'Dourado', 'Gold', 'Prata', 'Silver',
    'Cinza', 'Gray', 'Roxo', 'Purple', 'Rosa', 'Pink', 'Amarelo', 'Yellow', 'Coral'
  ];
  for (const c of colorKeywords) {
    const regex = new RegExp(`\\b${c}\\b`, 'i');
    if (regex.test(name)) {
      return c;
    }
  }
  return null;
}

function parseGrade(name: string, batteryHealth: string | null): string | null {
  if (batteryHealth) {
    return `Bateria ${batteryHealth}`;
  }
  const gradeMatch = name.match(/\b(Grade\s+[A-C]|Excelente|Muito Bom|Bom|Lacrado|Novo|Seminovo|Vitrine)\b/i);
  return gradeMatch ? gradeMatch[0] : null;
}

function formatCurrency(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return '—';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return formatDateBR(wallClock(iso).date);
}

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  return formatWallDateTime(iso).replace(' às ', ' às ');
}

export function SoldProductsModal({
  isOpen,
  onClose,
  initialCategory = 'all',
  initialSellerId = null,
  initialPeriod = 'month',
  initialStartDate,
  initialEndDate,
  sellerName,
}: SoldProductsModalProps) {
  // Filters state
  const [selectedCategory, setSelectedCategory] = useState<ProductTypeFilter>(initialCategory);
  const [selectedSellerId, setSelectedSellerId] = useState<string>(initialSellerId ?? 'all');
  const [period, setPeriod] = useState<PeriodFilterOption>(initialPeriod);
  const [searchQuery, setSearchQuery] = useState('');

  // Custom date range
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  // Sorting
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'name'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Raw Database Data
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync props when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedCategory(initialCategory);
      if (initialSellerId) {
        setSelectedSellerId(initialSellerId);
      }
      if (initialStartDate && initialEndDate) {
        setCustomStartDate(initialStartDate);
        setCustomEndDate(initialEndDate);
        setPeriod('custom');
      } else {
        setPeriod(initialPeriod);
      }
    }
  }, [isOpen, initialCategory, initialSellerId, initialPeriod, initialStartDate, initialEndDate]);

  // Fetch sales based on period
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoading(true);

    const now = new Date();
    let fetchSalesPromise: Promise<Sale[]>;

    if (period === 'today') {
      const { start, end } = getDayRange(now);
      fetchSalesPromise = fetchSalesInRange(start, end);
    } else if (period === '7days') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      fetchSalesPromise = fetchSalesInRange(start, end);
    } else if (period === '30days') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      fetchSalesPromise = fetchSalesInRange(start, end);
    } else if (period === 'month') {
      const { start, end } = getMonthRange(now);
      fetchSalesPromise = fetchSalesInRange(start, end);
    } else if (period === 'custom') {
      const start = new Date(`${customStartDate}T00:00:00`);
      const end = new Date(`${customEndDate}T23:59:59`);
      fetchSalesPromise = fetchSalesInRange(start, end);
    } else {
      fetchSalesPromise = fetchAllSales();
    }

    Promise.all([
      fetchSalesPromise,
      fetchProducts(),
      fetchSellers(),
    ])
      .then(([salesData, productsData, sellersData]) => {
        if (!isMounted) return;
        setSales(salesData);
        setProducts(productsData);
        setSellers(sellersData);
      })
      .catch((err) => {
        console.error('Erro ao carregar dados de produtos vendidos:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, period, customStartDate, customEndDate]);

  // Enrich sales with product, seller, and conversation/customer info
  const enrichedItems = useMemo<EnrichedSoldItem[]>(() => {
    const productMap = new Map(products.map((p) => [p.id, p]));
    const sellerMap = new Map(sellers.map((s) => [s.id, s]));


    return sales
      .filter((sale) => {
        const product = productMap.get(sale.product_id);
        const productName = product?.name ?? 'Produto não identificado';
        const category: 'Aparelhos' | 'Acessórios' = classifyProductCategory(productName);
        const amount = Number(sale.amount) || 0;
        // Regra de negócios: Acessório só conta como venda real se valor de venda > 0.
        // Brindes e cortesias com valor R$ 0,00 ou nulo não entram nas métricas de produtos/acessórios vendidos.
        if (category === 'Acessórios' && amount <= 0) {
          return false;
        }
        return true;
      })
      .map((sale) => {
        const product = productMap.get(sale.product_id);
        const seller = sellerMap.get(sale.seller_id);
        const productName = product?.name ?? 'Produto não identificado';
        const category: 'Aparelhos' | 'Acessórios' = classifyProductCategory(productName);
        const unitPrice = sale.quantity > 0 ? sale.amount / sale.quantity : sale.amount;

      // Extract details
      const capacity = category === 'Aparelhos' ? parseCapacity(productName) : null;
      const color = category === 'Aparelhos' ? parseColor(productName) : null;
      const grade = category === 'Aparelhos' ? parseGrade(productName, product?.battery_health ?? null) : null;

      // Cliente da venda no MercadoPhone (histórico de vendas). Sem vínculo comprovado, não informado.
      const customerName = sale.customer_name?.trim() || 'Não informado';

      // Custo histórico e lucro conciliados com o MercadoPhone (módulo financeiro). `products.price`
      // é preço de venda do cadastro e nunca é usado como custo.
      const reconciled = sale.financial_status === 'ok' && sale.cost != null && sale.profit != null;
      const totalCost = reconciled ? Number(sale.cost) : null;
      const unitCost = totalCost != null && sale.quantity > 0 ? totalCost / sale.quantity : null;
      const profit = reconciled ? Number(sale.profit) : null;
      const revenue = reconciled && sale.revenue != null ? Number(sale.revenue) : null;
      const marginPercent = profit != null && revenue ? Math.round((profit / revenue) * 100) : null;

      return {
        id: sale.id,
        saleId: sale.id,
        soldAt: sale.sold_at,
        quantity: sale.quantity,
        totalAmount: sale.amount,
        unitPrice,
        productId: sale.product_id,
        productName,
        category,
        brand: product?.brand ?? null,
        code: product?.code ?? sale.product_id.slice(0, 8),
        imei: product?.imei ?? null,
        batteryHealth: product?.battery_health ?? null,
        capacity,
        color,
        grade,
        unitCost,
        totalCost,
        profit,
        marginPercent,
        sellerId: sale.seller_id,
        sellerName: seller?.name ?? 'Vendedor Geral',
        customerName,
      };
    });
  }, [sales, products, sellers]);

  // Filter enriched items
  const filteredItems = useMemo(() => {
    return enrichedItems
      .filter((item) => {
        // Category filter
        if (selectedCategory !== 'all' && item.category !== selectedCategory) {
          return false;
        }
        // Seller filter
        if (selectedSellerId !== 'all' && item.sellerId !== selectedSellerId) {
          return false;
        }
        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchesName = item.productName.toLowerCase().includes(q);
          const matchesCustomer = item.customerName.toLowerCase().includes(q);
          const matchesImei = item.imei?.toLowerCase().includes(q) ?? false;
          const matchesCode = item.code.toLowerCase().includes(q);
          const matchesSeller = item.sellerName.toLowerCase().includes(q);
          const matchesColor = item.color?.toLowerCase().includes(q) ?? false;
          const matchesCap = item.capacity?.toLowerCase().includes(q) ?? false;
          if (!matchesName && !matchesCustomer && !matchesImei && !matchesCode && !matchesSeller && !matchesColor && !matchesCap) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === 'date') {
          diff = new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime();
        } else if (sortBy === 'amount') {
          diff = b.totalAmount - a.totalAmount;
        } else if (sortBy === 'name') {
          diff = a.productName.localeCompare(b.productName);
        }
        return sortOrder === 'desc' ? diff : -diff;
      });
  }, [enrichedItems, selectedCategory, selectedSellerId, searchQuery, sortBy, sortOrder]);

  // Compute Summary KPIs
  const summaryMetrics = useMemo(() => {
    let totalUnits = 0;
    let totalIphones = 0;
    let totalAccessories = 0;
    let totalRevenue = 0;
    let totalCost: number | null = 0;
    let totalProfit: number | null = 0;
    let hasCostData = false;

    for (const item of filteredItems) {
      totalUnits += item.quantity;
      totalRevenue += item.totalAmount;
      if (item.category === 'Aparelhos') {
        totalIphones += item.quantity;
      } else {
        totalAccessories += item.quantity;
      }
      if (item.totalCost != null) {
        hasCostData = true;
        totalCost = (totalCost ?? 0) + item.totalCost;
        totalProfit = (totalProfit ?? 0) + (item.profit ?? 0);
      }
    }

    const avgTicket = totalUnits > 0 ? totalRevenue / totalUnits : 0;

    return {
      totalUnits,
      totalIphones,
      totalAccessories,
      totalRevenue,
      totalCost: hasCostData ? totalCost : null,
      totalProfit: hasCostData ? totalProfit : null,
      avgTicket,
    };
  }, [filteredItems]);

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredItems.length === 0) return;
    const headers = [
      'ID Venda',
      'Data',
      'Produto',
      'Categoria',
      'Capacidade',
      'Cor',
      'IMEI',
      'Quantidade',
      'Valor Unitário',
      'Valor Total',
      'Cliente',
      'Vendedor',
      'Custo (conciliado)',
      'Lucro (conciliado)',
    ];
    const rows = filteredItems.map((item) => [
      item.saleId,
      formatDateTime(item.soldAt),
      `"${item.productName.replace(/"/g, '""')}"`,
      item.category,
      item.capacity ?? '',
      item.color ?? '',
      item.imei ?? '',
      item.quantity,
      item.unitPrice.toFixed(2),
      item.totalAmount.toFixed(2),
      `"${item.customerName.replace(/"/g, '""')}"`,
      `"${item.sellerName.replace(/"/g, '""')}"`,
      item.totalCost != null ? item.totalCost.toFixed(2) : '',
      item.profit != null ? item.profit.toFixed(2) : '',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(';'), ...rows.map((e) => e.join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `produtos_vendidos_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  const getTitle = () => {
    if (selectedCategory === 'Aparelhos') return 'iPhones Vendidos';
    if (selectedCategory === 'Acessórios') return 'Acessórios Vendidos';
    return 'Total de Produtos Vendidos';
  };

  const getSubtitle = () => {
    let base = `${filteredItems.length} registro(s) encontrado(s)`;
    if (sellerName && selectedSellerId !== 'all') {
      base += ` • Vendedor: ${sellerName}`;
    }
    return base;
  };

  return (
    <div className="modal-overlay sold-modal-overlay" onClick={onClose}>
      <div className="sold-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="sold-modal-header">
          <div className="sold-modal-title-group">
            <div className={`sold-modal-icon-badge ${selectedCategory}`}>
              {selectedCategory === 'Aparelhos' ? (
                <Smartphone size={24} />
              ) : selectedCategory === 'Acessórios' ? (
                <Headphones size={24} />
              ) : (
                <ShoppingBag size={24} />
              )}
            </div>
            <div>
              <div className="sold-modal-header-top">
                <h2 className="sold-modal-title">{getTitle()}</h2>
                <span className="sold-modal-badge">{filteredItems.length} {filteredItems.length === 1 ? 'item' : 'itens'}</span>
              </div>
              <p className="sold-modal-subtitle">{getSubtitle()}</p>
            </div>
          </div>

          <div className="sold-modal-actions-top">
            <button
              className="sold-modal-btn-action"
              onClick={handleExportCSV}
              disabled={filteredItems.length === 0}
              title="Exportar dados para CSV"
            >
              <Download size={16} />
              <span>Exportar</span>
            </button>
            <button className="sold-modal-close-btn" onClick={onClose} aria-label="Fechar modal">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Category Tab Switcher */}
        <div className="sold-modal-tabs">
          <button
            className={`sold-modal-tab ${selectedCategory === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            <Layers size={16} />
            <span>Todos os Produtos</span>
            <span className="tab-count">{enrichedItems.length}</span>
          </button>
          <button
            className={`sold-modal-tab iphones ${selectedCategory === 'Aparelhos' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('Aparelhos')}
          >
            <Smartphone size={16} />
            <span>iPhones / Aparelhos</span>
            <span className="tab-count">{enrichedItems.filter((i) => i.category === 'Aparelhos').length}</span>
          </button>
          <button
            className={`sold-modal-tab acessorios ${selectedCategory === 'Acessórios' ? 'active' : ''}`}
            onClick={() => setSelectedCategory('Acessórios')}
          >
            <Headphones size={16} />
            <span>Acessórios</span>
            <span className="tab-count">{enrichedItems.filter((i) => i.category === 'Acessórios').length}</span>
          </button>
        </div>

        {/* Summary Metric Strip */}
        <div className="sold-summary-grid">
          <div className="sold-summary-card">
            <div className="summary-card-icon" style={{ backgroundColor: 'rgba(10, 37, 255, 0.1)', color: 'var(--primary)' }}>
              <ShoppingBag size={18} />
            </div>
            <div className="summary-card-content">
              <span className="summary-card-label">Quantidade Total</span>
              <span className="summary-card-value">{summaryMetrics.totalUnits} un.</span>
              <span className="summary-card-sub">
                {summaryMetrics.totalIphones} iPhones • {summaryMetrics.totalAccessories} Acessórios
              </span>
            </div>
          </div>

          <div className="sold-summary-card">
            <div className="summary-card-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10B981' }}>
              <DollarSign size={18} />
            </div>
            <div className="summary-card-content">
              <span className="summary-card-label">Valor Total Vendido</span>
              <span className="summary-card-value">{formatCurrency(summaryMetrics.totalRevenue)}</span>
              <span className="summary-card-sub positive">Faturamento no período</span>
            </div>
          </div>

          <div className="sold-summary-card">
            <div className="summary-card-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B' }}>
              <TrendingUp size={18} />
            </div>
            <div className="summary-card-content">
              <span className="summary-card-label">Média por Produto</span>
              <span className="summary-card-value">{formatCurrency(summaryMetrics.avgTicket)}</span>
              <span className="summary-card-sub">Valor vendido ÷ unidades</span>
            </div>
          </div>

          <div className="sold-summary-card">
            <div className="summary-card-icon" style={{ backgroundColor: 'rgba(139, 92, 246, 0.1)', color: '#8B5CF6' }}>
              <CreditCard size={18} />
            </div>
            <div className="summary-card-content">
              <span className="summary-card-label">Lucro (conciliado)</span>
              <span className="summary-card-value">{summaryMetrics.totalProfit != null ? formatCurrency(summaryMetrics.totalProfit) : '—'}</span>
              <span className="summary-card-sub">
                {summaryMetrics.totalProfit != null ? 'Custo histórico do Mercado Phone' : 'Custo ainda não conciliado'}
              </span>
            </div>
          </div>
        </div>

        {/* Filters Controls Bar */}
        <div className="sold-filters-section">
          <div className="sold-search-box">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Buscar por modelo, cliente, IMEI, vendedor, cor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={() => setSearchQuery('')} aria-label="Limpar busca">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="sold-filters-group">
            {/* Period Dropdown */}
            <div className="filter-select-wrapper">
              <Calendar size={14} className="select-icon" />
              <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodFilterOption)}>
                <option value="month">Mês Atual</option>
                <option value="today">Hoje</option>
                <option value="7days">Últimos 7 dias</option>
                <option value="30days">Últimos 30 dias</option>
                <option value="custom">Personalizado</option>
                <option value="all">Todo o Histórico</option>
              </select>
            </div>

            {/* Seller Filter */}
            <div className="filter-select-wrapper">
              <User size={14} className="select-icon" />
              <select value={selectedSellerId} onChange={(e) => setSelectedSellerId(e.target.value)}>
                <option value="all">Todos os Vendedores</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>


            {/* Sort Dropdown */}
            <div className="filter-select-wrapper">
              <ArrowUpDown size={14} className="select-icon" />
              <select
                value={`${sortBy}_${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split('_');
                  setSortBy(field as 'date' | 'amount' | 'name');
                  setSortOrder(order as 'asc' | 'desc');
                }}
              >
                <option value="date_desc">Mais Recentes</option>
                <option value="date_asc">Mais Antigos</option>
                <option value="amount_desc">Maior Valor</option>
                <option value="amount_asc">Menor Valor</option>
                <option value="name_asc">Nome (A-Z)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Custom Date Range Picker Strip */}
        {period === 'custom' && (
          <div className="custom-date-strip">
            <span className="custom-date-label">Intervalo personalizado:</span>
            <div className="date-input-group">
              <label>De:</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
              />
            </div>
            <div className="date-input-group">
              <label>Até:</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Modal Body / Table / Card List */}
        <div className="sold-modal-body">
          {loading ? (
            <div className="sold-loading-container">
              <div className="sold-spinner" />
              <p>Carregando produtos vendidos...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="sold-empty-state">
              <div className="empty-icon-box">
                <Search size={32} />
              </div>
              <h3>Nenhum produto encontrado</h3>
              <p>Não há vendas registradas para os filtros e período selecionados.</p>
              <button
                className="btn-primary reset-filter-btn"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setSelectedSellerId('all');
                  setPeriod('month');
                }}
              >
                Redefinir Filtros
              </button>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="sold-table-container desktop-only">
                <table className="sold-table">
                  <thead>
                    <tr>
                      <th>PRODUTO / MODELO</th>
                      {selectedCategory === 'Aparelhos' ? (
                        <>
                          <th>ESPECIFICAÇÕES</th>
                          <th>IMEI / IDENTIFICADOR</th>
                        </>
                      ) : selectedCategory === 'Acessórios' ? (
                        <>
                          <th>CATEGORIA</th>
                          <th>QUANTIDADE</th>
                        </>
                      ) : (
                        <>
                          <th>TIPO / DETALHES</th>
                          <th>QTD</th>
                        </>
                      )}
                      <th>CLIENTE</th>
                      <th>VENDEDOR</th>
                      <th>VALOR DE VENDA</th>
                      <th>LUCRO</th>
                      <th>DATA DA VENDA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr key={item.id} className="sold-table-row">
                        {/* Product Name Column */}
                        <td>
                          <div className="product-cell-group">
                            <div className={`product-cell-icon ${item.category}`}>
                              {item.category === 'Aparelhos' ? <Smartphone size={16} /> : <Headphones size={16} />}
                            </div>
                            <div className="product-cell-text">
                              <span className="product-title-text">{item.productName}</span>
                              <span className="product-code-sub">Cód: {item.code}</span>
                            </div>
                          </div>
                        </td>

                        {/* Specs / Details Column */}
                        {selectedCategory === 'Aparelhos' ? (
                          <>
                            <td>
                              <div className="specs-badges-group">
                                {item.capacity && <span className="spec-badge capacity">{item.capacity}</span>}
                                {item.color && <span className="spec-badge color">{item.color}</span>}
                                {item.grade && (
                                  <span className="spec-badge grade">
                                    <BatteryCharging size={11} /> {item.grade}
                                  </span>
                                )}
                                {!item.capacity && !item.color && !item.grade && <span className="text-muted">—</span>}
                              </div>
                            </td>
                            <td>
                              {item.imei ? (
                                <span className="imei-badge" title={item.imei}>
                                  <ShieldCheck size={12} /> {item.imei}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          </>
                        ) : selectedCategory === 'Acessórios' ? (
                          <>
                            <td>
                              <span className="category-tag acessorio">
                                <Tag size={12} /> Acessório
                              </span>
                            </td>
                            <td>
                              <span className="qty-tag">{item.quantity} un.</span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <div className="type-badge-container">
                                <span className={`category-tag ${item.category === 'Aparelhos' ? 'aparelho' : 'acessorio'}`}>
                                  {item.category === 'Aparelhos' ? 'iPhone' : 'Acessório'}
                                </span>
                                {item.capacity && <span className="spec-badge capacity">{item.capacity}</span>}
                                {item.color && <span className="spec-badge color">{item.color}</span>}
                              </div>
                            </td>
                            <td>
                              <span className="qty-tag">{item.quantity} un.</span>
                            </td>
                          </>
                        )}

                        {/* Customer Column */}
                        <td>
                          <div className="customer-cell">
                            <div className="customer-avatar">
                              <User size={13} />
                            </div>
                            <span className="customer-name-text">{item.customerName}</span>
                          </div>
                        </td>

                        {/* Seller Column */}
                        <td>
                          <div className="seller-cell">
                            <span className="seller-name-text">{item.sellerName}</span>
                          </div>
                        </td>

                        {/* Amount Column */}
                        <td>
                          <div className="amount-cell">
                            <span className="amount-main">{formatCurrency(item.totalAmount)}</span>
                            {item.quantity > 1 && (
                              <span className="amount-unit-sub">{formatCurrency(item.unitPrice)}/un</span>
                            )}
                          </div>
                        </td>

                        {/* Lucro conciliado (custo histórico do Mercado Phone) */}
                        <td>
                          <div className="amount-cell">
                            <span className="amount-main">{item.profit != null ? formatCurrency(item.profit) : '—'}</span>
                            <span className="amount-unit-sub">
                              {item.totalCost != null ? `custo ${formatCurrency(item.totalCost)}` : 'Custo não conciliado'}
                            </span>
                          </div>
                        </td>

                        {/* Date Column */}
                        <td>
                          <div className="date-cell" title={formatDateTime(item.soldAt)}>
                            <span className="date-main">{formatDate(item.soldAt)}</span>
                            <span className="date-time-sub">
                              {wallClock(item.soldAt).time}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards View */}
              <div className="sold-cards-mobile-list mobile-only">
                {filteredItems.map((item) => (
                  <div key={item.id} className="sold-mobile-card">
                    <div className="mobile-card-header">
                      <div className="mobile-card-title-group">
                        <div className={`product-cell-icon ${item.category}`}>
                          {item.category === 'Aparelhos' ? <Smartphone size={16} /> : <Headphones size={16} />}
                        </div>
                        <div>
                          <h4 className="mobile-product-title">{item.productName}</h4>
                          <span className="mobile-date-text">{formatDateTime(item.soldAt)}</span>
                        </div>
                      </div>
                      <span className="mobile-amount-badge">{formatCurrency(item.totalAmount)}</span>
                    </div>

                    <div className="mobile-card-specs">
                      {item.capacity && <span className="spec-badge capacity">{item.capacity}</span>}
                      {item.color && <span className="spec-badge color">{item.color}</span>}
                      {item.grade && (
                        <span className="spec-badge grade">
                          <BatteryCharging size={11} /> {item.grade}
                        </span>
                      )}
                      <span className="qty-tag">{item.quantity} un.</span>
                      <span className="qty-tag">
                        {item.profit != null ? `Lucro ${formatCurrency(item.profit)}` : 'Custo não conciliado'}
                      </span>
                    </div>

                    {item.imei && (
                      <div className="mobile-imei-row">
                        <span className="mobile-label">IMEI:</span>
                        <span className="mobile-val imei-val">{item.imei}</span>
                      </div>
                    )}

                    <div className="mobile-card-footer">
                      <div className="mobile-info-item">
                        <span className="mobile-label">Cliente:</span>
                        <span className="mobile-val">{item.customerName}</span>
                      </div>
                      <div className="mobile-info-item">
                        <span className="mobile-label">Vendedor:</span>
                        <span className="mobile-val">{item.sellerName}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="sold-modal-footer">
          <div className="footer-left-info">
            <span>Exibindo <strong>{filteredItems.length}</strong> de <strong>{enrichedItems.length}</strong> itens</span>
          </div>
          <button className="btn-secondary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
