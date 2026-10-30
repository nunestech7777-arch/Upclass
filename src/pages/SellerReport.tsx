import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SellerFinanceSection } from '../components/finance/SellerFinanceSection';
import { useFinanceParams } from '../components/finance/useFinance';
import { ArrowLeft, ArrowRight, BrainCircuit, ShoppingBag, TrendingUp, Smartphone, Headphones } from 'lucide-react';
import { SoldProductsModal, type ProductTypeFilter } from '../components/SoldProductsModal';
import { SellerAvatar } from '../components/SellerAvatar';
import {
  fetchSellerById,
  fetchSalesInRange,
  fetchConversationsBySeller,
  fetchProducts,
  classifyProductCategory,
  getMonthRange,
} from '../lib/api';
import type { Seller } from '../lib/database.types';
import './SellerReport.css';

interface ReportData {
  seller: Seller;
  productsSold: number;
  devicesSold: number;
  accessoriesSold: number;
  conversionRate: number;
}

/**
 * Relatório do vendedor: vendas e resultado financeiro. Conversas do Kommo, tempo de resposta e
 * avaliações ficam no Meu Supervisor (/supervisor), que recebe o link com o vendedor já filtrado.
 */
export function SellerReport() {
  const { id } = useParams();
  const [soldProductsCategory, setSoldProductsCategory] = useState<ProductTypeFilter | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  // Competência vinda do ranking financeiro (?mes=AAAA-MM); sem parâmetro, mês atual.
  const { month } = useFinanceParams();

  useEffect(() => {
    if (!id) return;
    const [year, monthNumber] = month.split('-').map(Number);
    const { start, end } = getMonthRange(new Date(year, monthNumber - 1, 1));

    Promise.all([
      fetchSellerById(id),
      fetchSalesInRange(start, end),
      fetchConversationsBySeller(id),
      fetchProducts(),
    ]).then(([seller, monthSales, conversations, products]) => {
      const productMap = new Map(products.map((p) => [p.id, p]));
      const sellerSales = monthSales.filter((s) => s.seller_id === id);

      const devicesSold = sellerSales
        .filter((s) => classifyProductCategory(productMap.get(s.product_id)?.name) === 'Aparelhos')
        .reduce((sum, s) => sum + s.quantity, 0);
      const accessoriesSold = sellerSales
        .filter((s) => classifyProductCategory(productMap.get(s.product_id)?.name) === 'Acessórios' && Number(s.amount) > 0)
        .reduce((sum, s) => sum + s.quantity, 0);

      const success = conversations.filter((c) => c.result_type === 'success').length;
      const total = conversations.length;

      setData({
        seller,
        productsSold: devicesSold + accessoriesSold,
        devicesSold,
        accessoriesSold,
        conversionRate: total > 0 ? Math.round((success / total) * 100) : 0,
      });
    });
  }, [id, month]);

  return (
    <div className="seller-report-container">
      <div className="flex-between" style={{marginBottom: '8px'}}>
        <div className="flex-center gap-4">
          <Link to="/vendedores" className="btn-primary" style={{backgroundColor: 'transparent', color: 'var(--text-dark)', border: '1px solid var(--border-color)'}}>
            <ArrowLeft size={16} /> Voltar
          </Link>
          <div className="flex-center gap-3">
            {data && (
              <SellerAvatar
                name={data.seller.name}
                photoUrl={data.seller.photo_url}
                size="md"
              />
            )}
            <h1 className="h1">Relatório do Vendedor{data ? `: ${data.seller.name}` : ''}</h1>
          </div>
        </div>
      </div>

      {id && <SellerFinanceSection sellerId={id} />}

      {/* Top Metric Cards */}
      <div className="seller-metrics-grid">
        <div
          className="seller-kpi-card clickable"
          onClick={() => setSoldProductsCategory('Aparelhos')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSoldProductsCategory('Aparelhos')}
          title="Clique para ver os iPhones vendidos"
        >
          <Smartphone size={22} className="seller-kpi-icon" style={{ color: 'var(--accent-text)' }} />
          <span className="seller-kpi-value">{data?.devicesSold ?? 0}</span>
          <span className="seller-kpi-label">IPHONES</span>
          <span className="seller-kpi-hint">Ver detalhes →</span>
        </div>
        <div
          className="seller-kpi-card clickable"
          onClick={() => setSoldProductsCategory('Acessórios')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSoldProductsCategory('Acessórios')}
          title="Clique para ver os Acessórios vendidos"
        >
          <Headphones size={22} className="seller-kpi-icon" style={{ color: 'var(--success)' }} />
          <span className="seller-kpi-value">{data?.accessoriesSold ?? 0}</span>
          <span className="seller-kpi-label">ACESSÓRIOS</span>
          <span className="seller-kpi-hint">Ver detalhes →</span>
        </div>
        <div
          className="seller-kpi-card clickable"
          onClick={() => setSoldProductsCategory('all')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSoldProductsCategory('all')}
          title="Clique para ver todos os produtos vendidos"
        >
          <ShoppingBag size={22} className="seller-kpi-icon" />
          <span className="seller-kpi-value">{data?.productsSold ?? 0}</span>
          <span className="seller-kpi-label">TOTAL PRODUTOS</span>
          <span className="seller-kpi-hint">Ver detalhes →</span>
        </div>
        <div className="seller-kpi-card">
          <TrendingUp size={22} className="seller-kpi-icon" />
          <span className="seller-kpi-value">{data?.conversionRate ?? 0}%</span>
          <span className="seller-kpi-label">CONVERSÃO</span>
        </div>
      </div>

      {/* Atendimentos do Kommo: agora no Meu Supervisor */}
      {id && (
        <Link to={`/supervisor/vendedores?vendedor=${id}`} className="card seller-supervisor-link">
          <span className="seller-supervisor-icon" aria-hidden="true">
            <BrainCircuit size={20} />
          </span>
          <span className="seller-supervisor-text">
            <strong>Atendimentos e conversas no Meu Supervisor</strong>
            <span className="text-muted text-sm">
              Conversas do WhatsApp e Instagram, tempo de resposta, clientes sem resposta e avaliações deste vendedor.
            </span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      )}

      {/* Sold Products Detailed Modal */}
      <SoldProductsModal
        isOpen={soldProductsCategory !== null}
        onClose={() => setSoldProductsCategory(null)}
        initialCategory={soldProductsCategory ?? 'all'}
        initialSellerId={id}
        sellerName={data?.seller.name}
        initialPeriod="month"
      />
    </div>
  );
}
