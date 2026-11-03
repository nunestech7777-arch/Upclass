import React, { useEffect, useState, useMemo } from 'react';
import { EmptyState } from '../components/brand/BrandLogo';
import { Link } from 'react-router-dom';
import {
  Smartphone,
  Headphones,
  Package,
  TrendingUp,
  Crown,
  Trophy,
  ArrowRight,
  Sparkles,
  Camera,
  CircleDollarSign,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { usePeriod } from '../context/PeriodContext';
import { addDays } from '../lib/finance/dates';
import { SellerAvatar } from '../components/SellerAvatar';
import { SellerPhotoModal } from '../components/SellerPhotoModal';
import {
  fetchVisibleSellers,
  fetchSalesInRange,
  fetchProducts,
  computeSellerPerformance,
  type SellerPerformance,
} from '../lib/api';
import type { Seller } from '../lib/database.types';
import './Sellers.css';
import { AnimatedText } from '../components/ui/AnimatedNumber';
import { useConversionRanking } from '../components/dashboard/useConversionRanking';
import { useCardLink } from '../components/ui/useCardLink';
import { cardLinks } from '../lib/cardLinks';
import { conversionLeader, conversionText, sortByConversion } from '../lib/finance/conversionRanking';
import { int, pct } from '../lib/finance/format';

type RankingType = 'iphones' | 'accessories' | 'sales' | 'conversion';


const localDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Card do vendedor: o card inteiro abre o relatório (foto e botão continuam com o clique próprio). */
function SellerCardLink({ to, className, children }: { to: string; className: string; children: React.ReactNode }) {
  const link = useCardLink(to);
  return (
    <div className={className} {...link}>
      {children}
    </div>
  );
}

export function Sellers() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [performance, setPerformance] = useState<SellerPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [rankingType, setRankingType] = useState<RankingType>('iphones');
  const { range } = usePeriod();
  const [editingPhotoSeller, setEditingPhotoSeller] = useState<Seller | null>(null);

  useEffect(() => {
    // Fim exclusivo: meia-noite do dia seguinte ao último dia do período geral.
    const start = localDate(range.from);
    const end = localDate(addDays(range.to, 1));
    setLoading(true);
    Promise.all([
      fetchVisibleSellers(),
      fetchSalesInRange(start, end),
      fetchProducts(),
    ])
      .then(([sellers, sales, products]) => {
        setPerformance(computeSellerPerformance(sellers, sales, products));
      })
      .finally(() => setLoading(false));
  }, [range]);

  // Compute Leaders for the Podium Highlights
  const leaderIphones = useMemo(() => {
    if (performance.length === 0) return null;
    return [...performance].sort((a, b) => b.devicesSold - a.devicesSold || b.sold - a.sold)[0];
  }, [performance]);

  const leaderAccessories = useMemo(() => {
    if (performance.length === 0) return null;
    return [...performance].sort((a, b) => b.accessoriesSold - a.accessoriesSold || b.sold - a.sold)[0];
  }, [performance]);

  const leaderTotal = useMemo(() => {
    if (performance.length === 0) return null;
    return [...performance].sort((a, b) => b.sold - a.sold)[0];
  }, [performance]);

  // Atendimentos Kommo × pedidos MercadoPhone do mesmo período: a mesma conta do Dashboard.
  const conversion = useConversionRanking(range);
  const leaderConversion = useMemo(() => conversionLeader(conversion.rows), [conversion.rows]);
  const conversionById = useMemo(() => new Map((conversion.rows ?? []).map((r) => [r.seller.id, r])), [conversion.rows]);
  const conversionValue = (sellerId: string) =>
    conversion.rows ? conversionText(conversionById.get(sellerId), pct) : conversion.failed === 'pending' ? 'Ativação pendente' : conversion.failed ? 'Indisponível' : '…';

  // Ranked List based on active tab. "Por Conversão" usa a ordem e as posições do Ranking de Conversão
  // (mesma função do Dashboard); quem não se classifica fica sem posição.
  const rankedSellers = useMemo(() => {
    const byVolume = (a: SellerPerformance, b: SellerPerformance) => b.sold - a.sold;
    if (rankingType === 'conversion') {
      return sortByConversion(performance, conversion.rows ?? [], byVolume).map(({ item, position }) => ({ ...item, rank: position }));
    }
    return [...performance]
      .sort((a, b) => {
        if (rankingType === 'iphones') {
          return b.devicesSold - a.devicesSold || b.sold - a.sold;
        }
        if (rankingType === 'accessories') {
          return b.accessoriesSold - a.accessoriesSold || b.sold - a.sold;
        }
        return byVolume(a, b);
      })
      .map((item, index): SellerPerformance & { rank: number | null } => ({ ...item, rank: index + 1 }));
  }, [performance, rankingType, conversion.rows]);

  const getRankBadge = (rank: number | null) => {
    // Conversão ainda carregando: posição indefinida, não "sem posição".
    if (rank == null && rankingType === 'conversion' && !conversion.rows) {
      return { text: '…', color: 'var(--text-muted)', bg: 'var(--surface-subtle)', border: '1px solid var(--border-color)' };
    }
    if (rank == null) {
      return { text: 'Sem posição', color: 'var(--text-muted)', bg: 'var(--surface-subtle)', border: '1px solid var(--border-color)' };
    }
    const labelSuffix = 
      rankingType === 'iphones' ? 'em iPhones' :
      rankingType === 'accessories' ? 'em Acessórios' :
      rankingType === 'conversion' ? 'em Conversão' : 'Geral';

    if (rank === 1) {
      return { 
        text: `1º Lugar ${labelSuffix}`, 
        color: 'var(--gold)', 
        bg: 'color-mix(in srgb, var(--gold) 14%, transparent)',
        border: '1px solid color-mix(in srgb, var(--gold) 30%, transparent)'
      };
    }
    if (rank === 2) {
      return { 
        text: `2º Lugar`, 
        color: 'var(--text-primary)', 
        bg: 'var(--surface-muted)',
        border: '1px solid var(--border-color)'
      };
    }
    if (rank === 3) {
      return { 
        text: `3º Lugar`, 
        color: isDark ? '#f97316' : '#c2410c', 
        bg: isDark ? 'rgba(249, 115, 22, 0.12)' : 'rgba(249, 115, 22, 0.08)',
        border: isDark ? '1px solid rgba(249, 115, 22, 0.25)' : '1px solid rgba(249, 115, 22, 0.15)'
      };
    }
    return { 
      text: `${rank}º Lugar`, 
      color: 'var(--text-muted)', 
      bg: 'var(--surface-subtle)',
      border: '1px solid var(--border-color)'
    };
  };

  return (
    <div className="sellers-page-container">
      {/* Header & Tabs */}
      <div className="sellers-header-row">
        <div>
          <h1 className="h1 flex-center gap-2" style={{ justifyContent: 'flex-start' }}>
            <Trophy size={26} color="var(--accent-text)" />
            Ranking de Vendedores
          </h1>
          <Link
            to="/resultado-financeiro"
            className="sellers-profit-link"
          >
            <CircleDollarSign size={15} />
            Ver ranking de lucro e metas financeiras
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Tab Controls */}
        <div className="sellers-tabs-container">
          <button
            className={`seller-tab-btn ${rankingType === 'iphones' ? 'active' : ''}`}
            onClick={() => setRankingType('iphones')}
          >
            <Smartphone size={16} />
            Mais iPhones
          </button>
          <button
            className={`seller-tab-btn ${rankingType === 'accessories' ? 'active' : ''}`}
            onClick={() => setRankingType('accessories')}
          >
            <Headphones size={16} />
            Mais Acessórios
          </button>
          <button
            className={`seller-tab-btn ${rankingType === 'sales' ? 'active' : ''}`}
            onClick={() => setRankingType('sales')}
          >
            <Package size={16} />
            Total Geral
          </button>
          <button
            className={`seller-tab-btn ${rankingType === 'conversion' ? 'active' : ''}`}
            onClick={() => setRankingType('conversion')}
          >
            <TrendingUp size={16} />
            Por Conversão
          </button>
        </div>
      </div>

      {/* Leaders Podium Cards */}
      <div className="sellers-leaders-grid">
        <div 
          className={`leader-card ${rankingType === 'iphones' ? 'active-leader' : ''}`}
          onClick={() => setRankingType('iphones')}
        >
          {leaderIphones?.seller?.photo_url ? (
            <SellerAvatar
              name={leaderIphones.seller.name}
              photoUrl={leaderIphones.seller.photo_url}
              size="sm"
              rank={1}
            />
          ) : (
            <div className="leader-icon-badge iphones">
              <Smartphone size={22} />
            </div>
          )}
          <div className="leader-info">
            <span className="leader-label">Líder em iPhones</span>
            <span className="leader-name">{leaderIphones ? leaderIphones.seller.name : '—'}</span>
            <span className="leader-score">
              {leaderIphones ? `${leaderIphones.devicesSold} aparelhos` : '0'}
            </span>
          </div>
        </div>

        <div 
          className={`leader-card ${rankingType === 'accessories' ? 'active-leader' : ''}`}
          onClick={() => setRankingType('accessories')}
        >
          {leaderAccessories?.seller?.photo_url ? (
            <SellerAvatar
              name={leaderAccessories.seller.name}
              photoUrl={leaderAccessories.seller.photo_url}
              size="sm"
              rank={1}
            />
          ) : (
            <div className="leader-icon-badge accessories">
              <Headphones size={22} />
            </div>
          )}
          <div className="leader-info">
            <span className="leader-label">Líder em Acessórios</span>
            <span className="leader-name">{leaderAccessories ? leaderAccessories.seller.name : '—'}</span>
            <span className="leader-score" style={{ color: 'var(--chart-2)' }}>
              {leaderAccessories ? `${leaderAccessories.accessoriesSold} un.` : '0'}
            </span>
          </div>
        </div>

        <div 
          className={`leader-card ${rankingType === 'sales' ? 'active-leader' : ''}`}
          onClick={() => setRankingType('sales')}
        >
          {leaderTotal?.seller?.photo_url ? (
            <SellerAvatar
              name={leaderTotal.seller.name}
              photoUrl={leaderTotal.seller.photo_url}
              size="sm"
              rank={1}
            />
          ) : (
            <div className="leader-icon-badge total">
              <Package size={22} />
            </div>
          )}
          <div className="leader-info">
            <span className="leader-label">Maior Volume Total</span>
            <span className="leader-name">{leaderTotal ? leaderTotal.seller.name : '—'}</span>
            <span className="leader-score" style={{ color: 'var(--accent-text)' }}>
              {leaderTotal ? `${leaderTotal.sold} produtos` : '0'}
            </span>
          </div>
        </div>

        <div 
          className={`leader-card ${rankingType === 'conversion' ? 'active-leader' : ''}`}
          onClick={() => setRankingType('conversion')}
        >
          {leaderConversion?.seller?.photo_url ? (
            <SellerAvatar
              name={leaderConversion.seller.name}
              photoUrl={leaderConversion.seller.photo_url}
              size="sm"
              rank={1}
            />
          ) : (
            <div className="leader-icon-badge conversion">
              <Sparkles size={22} />
            </div>
          )}
          <div className="leader-info">
            <span className="leader-label">Maior Conversão</span>
            <span className="leader-name">{leaderConversion ? leaderConversion.seller.name : '—'}</span>
            <span className="leader-score" style={{ color: 'var(--chart-3)' }}>
              {leaderConversion
                ? `${pct(leaderConversion.index)} por atendimento`
                : conversion.rows
                  ? 'Sem dados suficientes'
                  : conversion.failed === 'pending'
                    ? 'Ativação pendente'
                    : conversion.failed
                      ? 'Indisponível'
                      : '…'}
            </span>
          </div>
        </div>
      </div>

      {!loading && rankedSellers.length === 0 && (
        <div className="card">
          <EmptyState title="Nenhum vendedor cadastrado ainda">Os vendedores aparecem aqui após a sincronização com o Mercado Phone.</EmptyState>
        </div>
      )}

      {/* Sellers Cards Grid */}
      <div className={`seller-grid uc-reload-scope ${loading ? 'is-reloading' : ''}`}>
        {rankedSellers.map(({ seller, sold, devicesSold, accessoriesSold, rank }) => {
          const badge = getRankBadge(rank);
          const conv = conversionById.get(seller.id);

          return (
            <SellerCardLink
              key={seller.id}
              to={cardLinks.seller(seller.id)}
              className={`seller-card ${rank === 1 ? 'rank-1' : ''}`}
            >
              <span 
                className="seller-rank-badge"
                style={{
                  color: badge.color,
                  backgroundColor: badge.bg,
                  border: badge.border,
                }}
              >
                {rank === 1 && <Crown size={14} />}
                {badge.text}
              </span>

              {/* Avatar do Vendedor em Destaque */}
              <div className="seller-card-avatar-wrap">
                <SellerAvatar
                  name={seller.name}
                  photoUrl={seller.photo_url}
                  size="xl"
                  rank={rank ?? undefined}
                  editable
                  onEdit={() => setEditingPhotoSeller(seller)}
                />
              </div>

              <div className="seller-header-info">
                <h2 className="seller-name">{seller.name}</h2>
                <span className="seller-role">Vendedor(a)</span>
              </div>

              {/* Stats Breakdown Box */}
              <div className="seller-stats-box">
                <div className={`seller-stat-row ${rankingType === 'iphones' ? 'highlight-metric' : ''}`}>
                  <span className="seller-stat-label">
                    <Smartphone size={14} />
                    iPhones Vendidos
                  </span>
                  <span className="seller-stat-val">
                    <AnimatedText text={`${devicesSold} un.`} />
                  </span>
                </div>

                <div className={`seller-stat-row ${rankingType === 'accessories' ? 'highlight-metric' : ''}`}>
                  <span className="seller-stat-label">
                    <Headphones size={14} />
                    Acessórios Vendidos
                  </span>
                  <span className="seller-stat-val">
                    <AnimatedText text={`${accessoriesSold} un.`} />
                  </span>
                </div>

                <div className={`seller-stat-row ${rankingType === 'sales' ? 'highlight-metric' : ''}`}>
                  <span className="seller-stat-label">
                    <Package size={14} />
                    Total Geral
                  </span>
                  <span className="seller-stat-val">
                    <AnimatedText text={`${sold} un.`} />
                  </span>
                </div>

                <div className={`seller-stat-row ${rankingType === 'conversion' ? 'highlight-metric' : ''}`}>
                  <span className="seller-stat-label">
                    <TrendingUp size={14} />
                    Taxa de Conversão
                  </span>
                  <span className="seller-stat-val" style={{ color: 'var(--accent-text)' }}>
                    <AnimatedText text={conversionValue(seller.id)} />
                  </span>
                </div>
                {conv?.attendances != null && (
                  <span className="seller-stat-origin">
                    {int(conv.attendances)} atendimentos · {int(conv.orders)} vendas
                    {conv.status === 'insufficient' ? ' · poucos atendimentos' : ''}
                  </span>
                )}
              </div>

              <Link 
                to={`/vendedores/${seller.id}`} 
                className="btn-primary seller-btn-report"
              >
                Ver Relatório Completo
                <ArrowRight size={14} />
              </Link>
            </SellerCardLink>
          );
        })}
      </div>

      {/* Modal para Editar/Trocar/Remover Foto */}
      {editingPhotoSeller && (
        <SellerPhotoModal
          seller={editingPhotoSeller}
          onClose={() => setEditingPhotoSeller(null)}
          onSaved={(updatedSeller) => {
            setPerformance((prev) =>
              prev.map((item) =>
                item.seller.id === updatedSeller.id
                  ? { ...item, seller: { ...item.seller, photo_url: updatedSeller.photo_url } }
                  : item
              )
            );
          }}
        />
      )}
    </div>
  );
}
