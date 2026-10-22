import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SellerFinanceSection } from '../components/finance/SellerFinanceSection';
import { useFinanceParams } from '../components/finance/useFinance';
import {
  ArrowLeft, Eye, MessageSquare, CheckCircle2, XCircle,
  ShoppingBag, TrendingUp, Clock, Star, Smartphone, Headphones
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { ConversationSummaryModal, type ConversationData, type ChatMessage } from '../components/ConversationSummaryModal';
import { SoldProductsModal, type ProductTypeFilter } from '../components/SoldProductsModal';
import { SellerAvatar } from '../components/SellerAvatar';
import { tooltipStyle, useChartTheme } from '../lib/chartTheme';
import {
  fetchSellerById,
  fetchSalesInRange,
  fetchConversationsBySeller,
  fetchConversationMessages,
  fetchProducts,
  classifyProductCategory,
  getMonthRange,
} from '../lib/api';
import { buildTranscript } from '../lib/transcript';
import type { Seller, Conversation } from '../lib/database.types';
import './SellerReport.css';

const WEEKDAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

interface ReportData {
  seller: Seller;
  received: number;
  responded: number;
  lost: number;
  productsSold: number;
  devicesSold: number;
  accessoriesSold: number;
  conversionRate: number;
  avgResponseTime: string;
  avgScore: string;
  chartData: { day: string; respondidas: number; perdidas: number; taxa: number }[];
  conversations: Conversation[];
}

export function SellerReport() {
  const { id } = useParams();
  const chart = useChartTheme();
  const [selectedConversation, setSelectedConversation] = useState<ConversationData | null>(null);
  const [soldProductsCategory, setSoldProductsCategory] = useState<ProductTypeFilter | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  // Competência vinda do ranking financeiro (?mes=AAAA-MM); sem parâmetro, mês atual.
  const { month } = useFinanceParams();

  useEffect(() => {
    if (!id) return;
    const now = new Date();
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
      const productsSold = devicesSold + accessoriesSold;

      const success = conversations.filter((c) => c.result_type === 'success').length;
      const lost = conversations.filter((c) => c.result_type === 'loss').length;
      const total = conversations.length;

      const durations = conversations.map((c) => c.duration_seconds).filter((d): d is number => d != null);
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

      const scores = conversations.map((c) => c.score).filter((s): s is number => s != null);
      const avgScoreValue = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

      const days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i)));
      const chartData = days.map((d) => {
        const dayConvs = conversations.filter((c) => sameDay(new Date(c.occurred_at), d));
        const respondidas = dayConvs.filter((c) => c.result_type === 'success').length;
        const perdidas = dayConvs.filter((c) => c.result_type === 'loss').length;
        const dayTotal = dayConvs.length;
        return {
          day: WEEKDAY_NAMES[d.getDay()],
          respondidas,
          perdidas,
          taxa: dayTotal > 0 ? Math.round((respondidas / dayTotal) * 100) : 0,
        };
      });

      setData({
        seller,
        received: total,
        responded: total,
        lost,
        productsSold,
        devicesSold,
        accessoriesSold,
        conversionRate: total > 0 ? Math.round((success / total) * 100) : 0,
        avgResponseTime: formatDuration(avgDuration),
        avgScore: avgScoreValue != null ? `${avgScoreValue.toFixed(1)} / 10` : '—',
        chartData,
        conversations,
      });
    });
  }, [id, month]);

  const handleOpenSummary = async (conv: Conversation) => {
    if (!data) return;
    const messages = await fetchConversationMessages(conv.id);
    const occurred = new Date(conv.occurred_at);

    // Autores e ordem vêm exatamente do banco — sem inferir remetente nem preencher com conversa de exemplo.
    const chatHistory: ChatMessage[] = buildTranscript(messages, { clientName: conv.client_name });

    if (import.meta.env.DEV) {
      // TEMPORÁRIO: ordem final exibida, para comparar com o Kommo durante a validação.
      console.debug(
        '[kommo-transcript]',
        conv.external_id,
        messages.map((m) => ({ id: m.external_id, sent_at: m.sent_at, seq: m.received_seq, sender: m.sender, name: m.sender_name }))
      );
    }

    setSelectedConversation({
      id: conv.id,
      client: conv.client_name,
      date: `${occurred.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })} - ${occurred.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      product: conv.product ?? '—',
      result: conv.result ?? (conv.result_type === 'success' ? 'Venda Fechada' : conv.result_type === 'loss' ? 'Perdido' : 'Em andamento'),
      resultType: conv.result_type ?? 'open',
      seller: data.seller.name,
      summary: conv.summary ?? '',
      keyPoints: conv.key_points,
      metrics: {
        duration: formatDuration(conv.duration_seconds),
        messagesCount: conv.messages_count ?? chatHistory.length,
        sentiment: conv.sentiment ?? '—',
        score: conv.score != null ? `${conv.score.toFixed(1)} / 10` : '—',
        objectionsCount: conv.objections ?? '—',
      },
      aiAnalysis: {
        strengths: conv.strengths,
        improvements: conv.improvements,
      },
      chatHistory,
    });
  };

  const handleCloseSummary = () => {
    setSelectedConversation(null);
  };

  const chartColor = chart.series[0];
  const gridColor = chart.grid;

  const resolvedConversations = data?.conversations ?? [];

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
        <div className="seller-kpi-card">
          <MessageSquare size={22} className="seller-kpi-icon" />
          <span className="seller-kpi-value">{data?.received ?? 0}</span>
          <span className="seller-kpi-label">RECEBIDAS</span>
        </div>
        <div className="seller-kpi-card">
          <CheckCircle2 size={22} className="seller-kpi-icon" />
          <span className="seller-kpi-value">{data?.responded ?? 0}</span>
          <span className="seller-kpi-label">RESPONDIDAS</span>
        </div>
        <div className="seller-kpi-card">
          <XCircle size={22} className="seller-kpi-icon" />
          <span className="seller-kpi-value">{data?.lost ?? 0}</span>
          <span className="seller-kpi-label">PERDIDAS</span>
        </div>
        <div className="seller-kpi-card">
          <Clock size={22} className="seller-kpi-icon" />
          <span className="seller-kpi-value">{data?.avgResponseTime ?? '—'}</span>
          <span className="seller-kpi-label">T.M.R.</span>
        </div>
        <div className="seller-kpi-card">
          <Star size={22} className="seller-kpi-icon" />
          <span className="seller-kpi-value">{data?.avgScore ?? '—'}</span>
          <span className="seller-kpi-label">AVALIAÇÃO</span>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="seller-charts-grid">
        <div className="seller-chart-card">
          <h3 className="seller-chart-title">Conversas Respondidas vs Perdidas</h3>
          <div style={{ width: '100%', height: '240px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.chartData ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: chart.axis, fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: chart.axis, fontSize: 12}} />
                <Tooltip
                  contentStyle={tooltipStyle(chart)}
                />
                <Bar dataKey="respondidas" name="Respondidas" fill={chartColor} radius={[4, 4, 0, 0]} />
                <Bar dataKey="perdidas" name="Perdidas" fill={chart.danger} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="seller-chart-card">
          <h3 className="seller-chart-title">Taxa de Conversão (%)</h3>
          <div style={{ width: '100%', height: '240px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.chartData ?? []}>
                <defs>
                  <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chart.series[1]} stopOpacity={0.35}/>
                    <stop offset="95%" stopColor={chart.series[1]} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: chart.axis, fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: chart.axis, fontSize: 12}} unit="%" />
                <Tooltip
                  contentStyle={tooltipStyle(chart)}
                />
                <Area type="monotone" dataKey="taxa" name="Taxa de Conversão" stroke={chart.series[1]} strokeWidth={3} fill="url(#colorConv)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Auditoria de Conversas */}
      <div className="card">
        <h2 className="h2" style={{marginBottom: '20px'}}>Auditoria de Conversas</h2>
        {resolvedConversations.length === 0 ? (
          <p className="text-muted" style={{ padding: '24px 0', textAlign: 'center' }}>
            Nenhuma conversa registrada ainda.
          </p>
        ) : (
          <table style={{width: '100%', textAlign: 'left', borderCollapse: 'collapse'}}>
            <thead>
              <tr style={{borderBottom: '1px solid var(--border-color)'}}>
                <th style={{padding: '12px 0', color: 'var(--text-muted)', fontWeight: 500}}>Cliente</th>
                <th style={{padding: '12px 0', color: 'var(--text-muted)', fontWeight: 500}}>Data</th>
                <th style={{padding: '12px 0', color: 'var(--text-muted)', fontWeight: 500}}>Produto</th>
                <th style={{padding: '12px 0', color: 'var(--text-muted)', fontWeight: 500}}>Resultado</th>
                <th style={{padding: '12px 0', color: 'var(--text-muted)', fontWeight: 500}}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {resolvedConversations.map(conv => (
                <tr key={conv.id} style={{borderBottom: '1px solid var(--border-color)'}}>
                  <td style={{padding: '16px 0', fontWeight: 500}}>{conv.client_name}</td>
                  <td style={{padding: '16px 0', color: 'var(--text-muted)'}}>
                    {new Date(conv.occurred_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{padding: '16px 0', color: 'var(--text-muted)'}}>{conv.product ?? '—'}</td>
                  <td style={{padding: '16px 0'}}>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '100px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: conv.result_type === 'success' ? 'var(--success-soft)' : conv.result_type === 'loss' ? 'var(--danger-soft)' : 'var(--action-primary-soft)',
                      color: conv.result_type === 'success' ? 'var(--success)' : conv.result_type === 'loss' ? 'var(--danger)' : 'var(--accent-text)'
                    }}>
                      {conv.result ?? (conv.result_type === 'success' ? 'Venda Fechada' : conv.result_type === 'loss' ? 'Perdido' : 'Em andamento')}
                    </span>
                  </td>
                  <td style={{padding: '16px 0'}}>
                    <button
                      onClick={() => handleOpenSummary(conv)}
                      style={{
                        color: 'var(--accent-text)',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        transition: 'background-color 0.15s ease'
                      }}
                      className="hover-btn"
                    >
                      <Eye size={14} /> Ver Resumo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Conversation Summary Report Modal */}
      <ConversationSummaryModal
        conversation={selectedConversation}
        onClose={handleCloseSummary}
      />

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
