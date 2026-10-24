import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, Flag, Gauge, KeyRound, LogOut, Moon, PackageSearch, Search, Smartphone, Sun, Target, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { SellerAvatar } from '../components/SellerAvatar';
import { MetricCard, MetricDetailModal, MetricGrid } from '../components/metrics/MetricPanel';
import { fetchMySales, fetchMyWeeklyGoals } from '../lib/accessApi';
import { fetchSellerStock, type SellerStockItem } from '../lib/finance/stockApi';
import { classifyStockItem, isControlItem, STOCK_CATEGORIES, type ClassifiedStockItem, type StockCategory } from '../lib/finance/stockMetrics';
import { normalizeName } from '../lib/finance/appleProducts';
import { formatInstantBR, formatWallDateTime, storeToday } from '../lib/finance/dates';
import { formatRange } from '../lib/finance/dashboard';
import { brl } from '../lib/finance/format';
import {
  buildPortalSummary,
  groupByOrder,
  isDeviceItem,
  ITEM_STATUS_LABELS,
  PORTAL_PRESET_LABELS,
  portalRange,
  type PortalGoal,
  type PortalOrder,
  type PortalPreset,
  type PortalSale,
} from '../lib/sellerPortal';
import { BrandLogo } from '../components/brand/BrandLogo';
import './SellerPortal.css';

const PAGE = 40;
const units = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'aparelho' : 'aparelhos'}`;
const firstName = (name: string | null | undefined) => {
  const n = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
};

/**
 * Painel do Vendedor: desempenho individual, minhas vendas e estoque com preço de venda.
 * Todos os dados chegam já restritos ao vendedor logado (funções seller_portal_* no banco e
 * mercadophone-estoque sem custo) — esta tela não escolhe vendedor nem recebe custo/lucro.
 */
export function SellerPortal() {
  const { access, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const today = storeToday();

  const [preset, setPreset] = useState<PortalPreset>('week');
  const [custom, setCustom] = useState({ from: today, to: today });
  const range = useMemo(() => portalRange(preset, today, custom), [preset, today, custom]);

  const [sales, setSales] = useState<PortalSale[]>([]);
  const [goals, setGoals] = useState<PortalGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([fetchMySales(range), fetchMyWeeklyGoals(range)])
      .then(([s, g]) => {
        if (!alive) return;
        setSales(s);
        setGoals(g);
      })
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  const summary = useMemo(() => buildPortalSummary(range, today, sales, goals), [range, today, sales, goals]);
  const name = firstName(access?.sellerName);

  return (
    <div className="sp-page">
      <header className="sp-header">
        <div className="sp-brand">
          <BrandLogo on="dark" className="sp-logo" />
          <span className="sp-brand-label">Painel do Vendedor</span>
        </div>
        <div className="sp-header-actions">
          <button
            type="button"
            className={`sleek-theme-switch ${theme === 'dark' ? 'dark-active' : ''}`}
            onClick={toggleTheme}
            aria-label="Alternar tema claro/escuro"
            aria-pressed={theme === 'dark'}
            title="Alternar tema claro/escuro"
          >
            <Sun size={13} color="#ffffff" className="switch-icon-sun" aria-hidden="true" />
            <Moon size={13} color="#ffffff" className="switch-icon-moon" aria-hidden="true" />
            <span className="switch-thumb" />
          </button>
          <Link to="/definir-senha" className="sp-icon-btn" aria-label="Alterar senha" title="Alterar senha">
            <KeyRound size={18} />
          </Link>
          <button type="button" className="sp-icon-btn" onClick={signOut} aria-label="Sair" title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="sp-main">
        <section className="sp-hello" aria-label="Identificação">
          <SellerAvatar name={access?.sellerName ?? ''} photoUrl={access?.photoUrl ?? null} size="lg" />
          <div className="sp-hello-text">
            <h1>Olá{name ? `, ${name}` : ''}!</h1>
            <p>
              {access?.sellerName}
              {access?.mpSellerId && <span className="sp-muted"> · Vendedor MercadoPhone #{access.mpSellerId}</span>}
            </p>
          </div>
        </section>

        <section className="sp-filter" aria-label="Período">
          <div className="sp-segmented" role="tablist" aria-label="Período">
            {(Object.keys(PORTAL_PRESET_LABELS) as PortalPreset[]).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={preset === p} className={preset === p ? 'is-active' : ''} onClick={() => setPreset(p)}>
                {PORTAL_PRESET_LABELS[p]}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="sp-dates">
              <label>
                De
                <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
              </label>
              <label>
                Até
                <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
              </label>
            </div>
          )}
          <span className="sp-range">
            <CalendarRange size={14} /> {formatRange(range)}
          </span>
        </section>

        {error && (
          <p className="sp-alert" role="alert">
            {error}
          </p>
        )}

        <MetricGrid>
          <MetricCard
            icon={<Smartphone size={18} />}
            tone="blue"
            badge="Vendidos"
            label="Aparelhos vendidos"
            loading={loading}
            value={units(summary.sold)}
            caption="iPhones vendidos por você no período (unidades)"
          />
          <MetricCard
            icon={<Target size={18} />}
            tone="purple"
            badge="Meta"
            label="Meta semanal"
            loading={loading}
            value={summary.goal == null ? 'Sem meta definida' : units(summary.goal)}
            caption={summary.goal == null ? summary.goalNote : `Progresso: ${Math.round(summary.progressPct ?? 0)}%`}
          />
          <MetricCard
            icon={<TrendingUp size={18} />}
            tone="teal"
            badge={summary.projection.kind === 'final' ? 'Realizado' : 'Estimativa'}
            label={summary.projection.kind === 'final' ? 'Resultado da semana' : 'Projeção semanal'}
            loading={loading}
            value={
              summary.projection.value == null
                ? 'Indisponível'
                : summary.projection.kind === 'final'
                  ? units(summary.projection.value)
                  : `≈ ${units(Math.round(summary.projection.value))}`
            }
            caption={summary.projection.note || undefined}
          />
          <MetricCard
            icon={<Flag size={18} />}
            tone="amber"
            badge="Faltam"
            label="Faltam para a meta"
            loading={loading}
            value={summary.remaining.value == null ? '—' : summary.remaining.reached ? 'Meta alcançada! 🎉' : units(summary.remaining.value)}
            caption={summary.remaining.value == null ? 'Sem meta definida para o período.' : summary.remaining.reached ? `Você vendeu ${units(summary.sold)} de ${units(summary.goal!)}.` : 'Meta semanal − aparelhos vendidos'}
          />
          <MetricCard
            icon={<Gauge size={18} />}
            tone="green"
            badge="Ritmo"
            label="Ritmo necessário"
            loading={loading}
            value={summary.pace.text}
            caption={summary.pace.caption}
          />
        </MetricGrid>

        <GoalProgress loading={loading} sold={summary.sold} goal={summary.goal} pct={summary.progressPct} weekly={summary.weekly} />

        <MySales sales={sales} loading={loading} rangeLabel={formatRange(range)} />

        <AvailableStock />
      </main>
    </div>
  );
}

function GoalProgress({ loading, sold, goal, pct, weekly }: { loading: boolean; sold: number; goal: number | null; pct: number | null; weekly: boolean }) {
  const width = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <section className="sp-card sp-progress" aria-label="Progresso da meta semanal">
      <div className="sp-section-head">
        <h2>Progresso da meta semanal</h2>
        {goal != null && !loading && <strong className={pct != null && pct >= 100 ? 'sp-ok' : ''}>{Math.round(pct ?? 0)}%</strong>}
      </div>
      {goal == null ? (
        <p className="sp-muted">{weekly ? 'Sem meta definida para esta semana.' : 'Escolha uma semana completa para acompanhar a meta.'}</p>
      ) : (
        <>
          <div
            className="sp-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={goal}
            aria-valuenow={sold}
            aria-label={`${sold} de ${goal} aparelhos`}
          >
            <span className={`sp-bar-fill ${pct != null && pct >= 100 ? 'is-done' : ''}`} style={{ width: `${loading ? 0 : width}%` }} />
          </div>
          <p className="sp-muted">
            {loading ? 'carregando…' : `${units(sold)} de ${units(goal)}`}
          </p>
        </>
      )}
    </section>
  );
}

function MySales({ sales, loading, rangeLabel }: { sales: PortalSale[]; loading: boolean; rangeLabel: string }) {
  const [query, setQuery] = useState('');
  const [onlyDevices, setOnlyDevices] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [openOrder, setOpenOrder] = useState<PortalOrder | null>(null);
  const orders = useMemo(() => groupByOrder(sales), [sales]);

  useEffect(() => setLimit(PAGE), [sales, query, onlyDevices]);

  const rows = useMemo(() => {
    const q = normalizeName(query);
    return sales.filter((s) => {
      if (onlyDevices && !isDeviceItem(s)) return false;
      if (!q) return true;
      return normalizeName(`${s.product_name ?? ''} ${s.mp_order_id ?? ''}`).includes(q);
    });
  }, [sales, query, onlyDevices]);

  const openFor = (s: PortalSale) => setOpenOrder(orders.find((o) => o.key === (s.mp_order_id ?? `item:${s.id}`)) ?? null);

  return (
    <section className="sp-card" aria-label="Minhas vendas">
      <div className="sp-section-head">
        <h2>Minhas Vendas</h2>
        <span className="sp-muted">{loading ? 'carregando…' : `${rows.length} item(ns) · ${rangeLabel}`}</span>
      </div>
      <div className="sp-toolbar">
        <label className="sp-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Buscar produto ou nº do pedido" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar nas minhas vendas" />
        </label>
        <label className="sp-check">
          <input type="checkbox" checked={onlyDevices} onChange={(e) => setOnlyDevices(e.target.checked)} /> Só iPhones
        </label>
      </div>
      {!loading && rows.length === 0 ? (
        <p className="sp-empty">Nenhuma venda sua neste período.</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Pedido</th>
                <th>Produto</th>
                <th className="is-right">Qtd.</th>
                <th className="is-right">Valor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((s) => (
                <tr key={s.id} className="is-clickable" onClick={() => openFor(s)} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openFor(s))} aria-label={`Ver pedido ${s.mp_order_id ?? ''}`}>
                  <td data-label="Data">{formatWallDateTime(s.sold_at)}</td>
                  <td data-label="Pedido">{s.mp_order_id ? `#${s.mp_order_id}` : '—'}</td>
                  <td data-label="Produto" className="sp-product">{s.product_name ?? 'Produto sem nome'}</td>
                  <td data-label="Qtd." className="is-right">{s.quantity}</td>
                  <td data-label="Valor" className="is-right">{brl(Number(s.amount))}</td>
                  <td data-label="Status">
                    <span className={`sp-status ${s.item_status === 'active' ? 'is-ok' : 'is-off'}`}>{ITEM_STATUS_LABELS[s.item_status] ?? s.item_status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <button type="button" className="sp-more" onClick={() => setLimit((l) => l + PAGE)}>
          Mostrar mais ({rows.length - limit} restantes)
        </button>
      )}
      {openOrder && (
        <MetricDetailModal
          title={openOrder.orderId ? `Pedido #${openOrder.orderId}` : 'Venda'}
          scope={formatWallDateTime(openOrder.soldAt)}
          formula="Somente os itens vendidos por você neste pedido. Itens de outros vendedores do mesmo pedido não aparecem."
          columns={[
            { key: 'p', header: 'Produto', render: (r: PortalSale) => r.product_name ?? 'Produto sem nome' },
            { key: 'q', header: 'Qtd.', align: 'right', render: (r: PortalSale) => r.quantity },
            { key: 'v', header: 'Valor', align: 'right', render: (r: PortalSale) => brl(Number(r.amount)) },
            { key: 's', header: 'Status', render: (r: PortalSale) => ITEM_STATUS_LABELS[r.item_status] ?? r.item_status },
          ]}
          rows={openOrder.items}
          rowKey={(r) => r.id}
          footer={['Total (sem cancelados)', String(openOrder.units), brl(openOrder.total), '']}
          onClose={() => setOpenOrder(null)}
        />
      )}
    </section>
  );
}

type StockStatus = 'available' | 'all';
type StockSort = 'name' | 'priceAsc' | 'priceDesc' | 'qty';

function AvailableStock() {
  const [items, setItems] = useState<ClassifiedStockItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | StockCategory>('Produtos Apple');
  const [status, setStatus] = useState<StockStatus>('available');
  const [sort, setSort] = useState<StockSort>('name');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchSellerStock()
      .then((r) => {
        if (!alive) return;
        // Campos ausentes por segurança (custo/IMEI/datas) entram vazios só para reaproveitar a classificação.
        const classified = r.items
          .map((i: SellerStockItem) => classifyStockItem({ ...i, cost: null, imei: null, entryDate: null, updatedAt: null }))
          .filter((i) => !isControlItem(i));
        setItems(classified);
        setFetchedAt(r.fetchedAt);
        setComplete(r.complete);
      })
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce]);

  useEffect(() => setLimit(PAGE), [query, category, status, sort]);

  const rows = useMemo(() => {
    const q = normalizeName(query);
    const filtered = items.filter((i) => {
      if (status === 'available' && !i.available) return false;
      if (category !== 'all' && i.category !== category) return false;
      if (!q) return true;
      return normalizeName([i.description, i.group, i.model, i.color, i.storage, i.condition, i.id].filter(Boolean).join(' ')).includes(q);
    });
    const byName = (a: ClassifiedStockItem, b: ClassifiedStockItem) => a.description.localeCompare(b.description, 'pt-BR');
    const price = (i: ClassifiedStockItem) => i.price ?? Number.POSITIVE_INFINITY;
    return filtered.sort((a, b) => {
      if (sort === 'priceAsc') return price(a) - price(b) || byName(a, b);
      if (sort === 'priceDesc') return (b.price ?? -1) - (a.price ?? -1) || byName(a, b);
      if (sort === 'qty') return b.quantity - a.quantity || byName(a, b);
      return byName(a, b);
    });
  }, [items, query, category, status, sort]);

  const totalUnits = rows.reduce((a, i) => a + i.quantity, 0);

  return (
    <section className="sp-card" aria-label="Estoque disponível">
      <div className="sp-section-head">
        <h2>
          <PackageSearch size={18} aria-hidden /> Estoque Disponível
        </h2>
        <span className="sp-muted">
          {loading ? 'consultando o MercadoPhone…' : `${rows.length} produto(s) · ${totalUnits.toLocaleString('pt-BR')} unidade(s)`}
          {fetchedAt && !loading && ` · atualizado ${formatInstantBR(fetchedAt)}`}
        </span>
      </div>
      <div className="sp-toolbar">
        <label className="sp-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Buscar modelo, cor, capacidade…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar no estoque" />
        </label>
        <select value={category} onChange={(e) => setCategory(e.target.value as 'all' | StockCategory)} aria-label="Categoria">
          <option value="all">Todas as categorias</option>
          {STOCK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StockStatus)} aria-label="Disponibilidade">
          <option value="available">Disponíveis para venda</option>
          <option value="all">Todos os status</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as StockSort)} aria-label="Ordenar">
          <option value="name">Ordenar: nome</option>
          <option value="priceAsc">Menor preço</option>
          <option value="priceDesc">Maior preço</option>
          <option value="qty">Maior quantidade</option>
        </select>
      </div>
      {!complete && !loading && <p className="sp-alert is-soft">O MercadoPhone não confirmou o total de itens: a lista pode estar incompleta.</p>}
      {error ? (
        <div className="sp-empty">
          <p>{error}</p>
          <button type="button" className="sp-more" onClick={() => setNonce((n) => n + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : !loading && rows.length === 0 ? (
        <p className="sp-empty">Nenhum produto encontrado com esses filtros.</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Modelo</th>
                <th>Cor</th>
                <th>Capacidade</th>
                <th className="is-right">Qtd.</th>
                <th className="is-right">Preço de venda</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? null
                : rows.slice(0, limit).map((i) => (
                    <tr key={i.id}>
                      <td data-label="Produto" className="sp-product">
                        {i.description}
                        {i.condition && <span className="sp-tag">{i.condition}</span>}
                        {i.battery != null && i.battery > 0 && <span className="sp-tag">Bateria {i.battery}%</span>}
                      </td>
                      <td data-label="Modelo">{i.model ?? i.group}</td>
                      <td data-label="Cor">{i.color ?? '—'}</td>
                      <td data-label="Capacidade">{i.storage ?? '—'}</td>
                      <td data-label="Qtd." className="is-right">{i.quantity.toLocaleString('pt-BR')}</td>
                      <td data-label="Preço" className="is-right sp-price">{i.price != null && i.price > 0 ? brl(i.price) : 'Consultar'}</td>
                      <td data-label="Status">
                        <span className={`sp-status ${i.available ? 'is-ok' : 'is-off'}`}>{i.available ? 'Disponível' : i.availability}</span>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <button type="button" className="sp-more" onClick={() => setLimit((l) => l + PAGE)}>
          Mostrar mais ({rows.length - limit} restantes)
        </button>
      )}
    </section>
  );
}
