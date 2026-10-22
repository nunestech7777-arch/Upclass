import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/brand/BrandLogo';
import { Search, Smartphone, Headphones, Plus, X, Boxes, Trophy, CircleDollarSign, Wallet, TrendingUp, RefreshCw, Gift, Wrench, Apple } from 'lucide-react';
import './Inventory.css';
import { insertProduct } from '../lib/api';
import { fetchLiveStock } from '../lib/finance/stockApi';
import { StockTurnoverPanel } from '../components/inventory/StockTurnoverPanel';
import {
  STOCK_CATEGORIES,
  classifyStockItem,
  computeStockMetrics,
  filterStock,
  hasCost,
  hasPrice,
  isControlItem,
  isSellable,
  type ClassifiedStockItem,
  type StockCategory,
  type StockFilters,
  type StockItem,
} from '../lib/finance/stockMetrics';
import { APPLE_TYPES, type AppleType } from '../lib/finance/appleProducts';
import { MetricCard, MetricDetailModal, MetricGrid, StickyFilterBar, type DetailColumn } from '../components/metrics/MetricPanel';

const emptyFormData = {
  name: '',
  category: 'Aparelhos' as 'Aparelhos' | 'Acessórios',
  brand: '',
  imei: '',
  batteryHealth: '',
  price: '',
  location: '',
  stock: '1',
  minStock: '0',
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v: number) => BRL.format(v);
const int = (v: number) => v.toLocaleString('pt-BR');
const units = (n: number) => `${int(n)} ${n === 1 ? 'unidade' : 'unidades'}`;
const AUTO_REFRESH_MS = 5 * 60 * 1000;

type Detail = 'quantity' | 'ranking' | 'potential' | 'cost' | 'profit';

function CategoryIcon({ item, size = 14 }: { item: ClassifiedStockItem; size?: number }) {
  if (item.category === 'Produtos Apple') return item.appleType === 'iPhone' ? <Smartphone size={size} /> : <Apple size={size} />;
  if (item.category === 'Brindes') return <Gift size={size} />;
  if (item.category === 'Peças') return <Wrench size={size} />;
  if (item.category === 'Outros aparelhos') return <Smartphone size={size} />;
  return <Headphones size={size} />;
}

const badgeClass = (c: StockCategory) => (c === 'Produtos Apple' || c === 'Outros aparelhos' ? 'aparelhos' : 'acessorios');
const typeLabel = (i: ClassifiedStockItem) => i.appleType ?? i.category;

export function Inventory() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [registerError, setRegisterError] = useState<string | null>(null);
  // Só a resposta mais recente vale (intervalo, volta à aba e botão podem se sobrepor).
  const requestSeq = useRef(0);
  const lastLoad = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<StockFilters>({ category: 'all', appleType: 'all', status: 'available', search: '' });
  const [detail, setDetail] = useState<Detail | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyFormData);

  // Estoque ao vivo do MercadoPhone; recarrega a cada 5 min com a aba visível e ao voltar para ela.
  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    lastLoad.current = Date.now();
    setLoading(true);
    setError(null);
    fetchLiveStock()
      .then((r) => {
        if (seq !== requestSeq.current) return;
        setItems(r.items);
        setFetchedAt(r.fetchedAt);
        setComplete(r.complete);
      })
      .catch((err) => seq === requestSeq.current && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => seq === requestSeq.current && setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const tick = window.setInterval(() => document.visibilityState === 'visible' && load(), AUTO_REFRESH_MS);
    // Voltar para a aba recarrega só se a última leitura tiver mais de 1 minuto (evita rajadas na API).
    const onVisible = () => document.visibilityState === 'visible' && Date.now() - lastLoad.current > 60_000 && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const control = useMemo(() => items.filter(isControlItem), [items]);
  const classified = useMemo(() => items.filter((i) => !isControlItem(i)).map(classifyStockItem), [items]);
  const filtered = useMemo(() => filterStock(classified, filters), [classified, filters]);
  const m = useMemo(() => computeStockMetrics(filtered), [filtered]);
  const top = m.ranking[0];

  const set = (patch: Partial<StockFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const statusLabel = filters.status === 'available' ? 'disponíveis para venda' : filters.status === 'unavailable' ? 'indisponíveis (laboratório/reserva)' : 'em todas as situações';
  const scope = [
    filters.category === 'all' ? 'Todas as categorias' : filters.category,
    filters.appleType !== 'all' ? filters.appleType : null,
    statusLabel,
    filters.search ? `busca “${filters.search}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const pricePartial =
    m.missingPrice.items > 0 ? `Parcial: ${m.missingPrice.items} produto(s) vendável(is) sem preço (${units(m.missingPrice.units)}) fora do valor` : null;
  const costPartial = m.missingCost.items > 0 ? `Parcial: ${m.missingCost.items} produto(s) sem custo (${units(m.missingCost.units)}) fora do custo` : null;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setRegisterError(null);
    try {
      await insertProduct({
        name: formData.name,
        category: formData.category,
        brand: formData.brand || null,
        location: formData.location || null,
        stock: Number(formData.stock) || 0,
        min_stock: Number(formData.minStock) || 0,
        price: Number(formData.price) || 0,
        imei: formData.category === 'Aparelhos' ? (formData.imei || null) : null,
        battery_health: formData.category === 'Aparelhos' ? (formData.batteryHealth || null) : null,
      });
      setIsModalOpen(false);
      setFormData(emptyFormData);
      setSavedNote('Produto cadastrado no painel. Os indicadores desta tela usam o estoque do Mercado Phone: para entrar nas contas, cadastre-o também lá.');
    } catch (err) {
      setRegisterError(`Não foi possível cadastrar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const itemCol: DetailColumn<ClassifiedStockItem> = {
    key: 'p',
    header: 'Produto',
    render: (i) => (
      <>
        <strong>{i.description}</strong>
        <div className="mc-muted">
          {typeLabel(i)} · {i.availability}
        </div>
      </>
    ),
  };
  const qtyCol: DetailColumn<ClassifiedStockItem> = { key: 'q', header: 'Qtd.', align: 'right', render: (i) => int(i.quantity) };
  const priceOf = (i: ClassifiedStockItem) =>
    !isSellable(i) ? <span className="mc-muted">brinde</span> : hasPrice(i) ? money(i.price!) : <span className="mc-warn">sem preço</span>;
  const costOf = (i: ClassifiedStockItem) => (hasCost(i) ? money(i.cost!) : <span className="mc-warn">sem custo</span>);
  const byValue = (f: (i: ClassifiedStockItem) => number) => [...filtered].sort((a, b) => f(b) - f(a) || a.description.localeCompare(b.description, 'pt-BR'));
  const potentialOf = (i: ClassifiedStockItem) => (isSellable(i) && hasPrice(i) ? i.price! * i.quantity : 0);
  const costTotalOf = (i: ClassifiedStockItem) => (hasCost(i) ? i.cost! * i.quantity : 0);

  const detailModal = (() => {
    if (!detail) return null;
    const common = { scope, onClose: () => setDetail(null), rowKey: (i: ClassifiedStockItem) => i.id };
    if (detail === 'quantity')
      return (
        <MetricDetailModal
          {...common}
          title="Produtos em estoque"
          formula={<>Quantidade = soma das unidades em estoque dos produtos filtrados. Unidades vendidas não aparecem (saem do estoque do Mercado Phone).</>}
          columns={[itemCol, { key: 'c', header: 'Situação', render: (i) => i.availability }, qtyCol]}
          rows={byValue((i) => i.quantity)}
          footer={['Total', '', int(m.units)]}
          notes={
            control.length > 0 && (
              <>
                Fora da contagem (itens de controle do Mercado Phone, não são mercadoria):{' '}
                {control.map((c) => `${c.description} (${int(c.quantity)})`).join('; ')}.
              </>
            )
          }
        />
      );
    if (detail === 'ranking')
      return (
        <MetricDetailModal
          title="Ranking de produtos em estoque"
          scope={scope}
          onClose={() => setDetail(null)}
          formula={<>Produtos agrupados por modelo (iPhones pelo modelo, ex.: “iPhone 17 Pro Max”) e ordenados pela quantidade disponível.</>}
          rowKey={(r) => `${r.category}|${r.appleType}|${r.group}`}
          columns={[
            { key: 'i', header: '#', render: (r) => String(m.ranking.indexOf(r) + 1).padStart(2, '0') },
            { key: 'g', header: 'Produto', render: (r) => <strong>{r.group}</strong> },
            { key: 't', header: 'Tipo', render: (r) => r.appleType ?? r.category },
            { key: 'u', header: 'Unidades', align: 'right', render: (r) => int(r.units) },
            { key: 'v', header: 'Valor potencial', align: 'right', render: (r) => money(r.potential) },
          ]}
          rows={m.ranking}
        />
      );
    if (detail === 'potential')
      return (
        <MetricDetailModal
          {...common}
          title="Composição do valor potencial de venda"
          formula={<>Valor potencial = Σ (quantidade disponível × preço de venda unitário cadastrado). É uma projeção, não faturamento realizado. Brindes não têm preço de venda; produto vendável sem preço fica de fora (nenhum valor é inventado).</>}
          columns={[itemCol, qtyCol, { key: 'pr', header: 'Preço unit.', align: 'right', render: priceOf }, { key: 't', header: 'Total', align: 'right', render: (i) => money(potentialOf(i)) }]}
          rows={byValue(potentialOf)}
          footer={['Total', int(m.units), '', money(m.potential)]}
          notes={pricePartial}
        />
      );
    if (detail === 'cost')
      return (
        <MetricDetailModal
          {...common}
          title="Custo total do estoque"
          formula={<>Custo total = Σ (quantidade disponível × custo unitário registrado no Mercado Phone). Preço de venda nunca é usado como custo. Inclui o custo dos brindes em estoque.</>}
          columns={[itemCol, qtyCol, { key: 'c', header: 'Custo unit.', align: 'right', render: costOf }, { key: 't', header: 'Total', align: 'right', render: (i) => money(costTotalOf(i)) }]}
          rows={byValue(costTotalOf)}
          footer={['Total', int(m.units), '', money(m.cost)]}
          notes={costPartial}
        />
      );
    return (
      <MetricDetailModal
        {...common}
        title="Lucro bruto potencial"
        formula={<>Lucro bruto potencial = valor potencial de venda − custo total do estoque. Estimativa pelos preços cadastrados: não é lucro realizado e não desconta impostos, comissões ou despesas. Brindes entram só no custo.</>}
        columns={[
          itemCol,
          qtyCol,
          { key: 'c', header: 'Custo unit.', align: 'right', render: costOf },
          { key: 'pr', header: 'Preço unit.', align: 'right', render: priceOf },
          {
            key: 'l',
            header: 'Lucro potencial',
            align: 'right',
            // Sem custo (ou vendável sem preço) a linha não tem lucro confiável: não mostra um valor "cheio".
            render: (i) => (!hasCost(i) || (isSellable(i) && !hasPrice(i)) ? <span className="mc-warn">incompleto</span> : money(potentialOf(i) - costTotalOf(i))),
          },
        ]}
        rows={byValue((i) => potentialOf(i) - costTotalOf(i))}
        footer={['Total', int(m.units), '', '', money(m.profit)]}
        notes={
          !m.complete && (
            <>
              Resultado parcial — {[pricePartial, costPartial].filter(Boolean).map((t) => t!.replace(/^Parcial: /, '')).join(' · ')}. Produto sem custo entra com o preço
              cheio (lucro superestimado); produto vendável sem preço entra só com o custo (lucro subestimado). Corrija o cadastro no Mercado Phone para o valor ficar
              definitivo.
            </>
          )
        }
      />
    );
  })();

  // Tipos Apple primeiro (iPhone, MacBook, iPad…), depois as demais categorias.
  const plural: Record<string, [string, string]> = { iPhone: ['iPhone', 'iPhones'], MacBook: ['MacBook', 'MacBooks'], iPad: ['iPad', 'iPads'] };
  const breakdownText = [...m.breakdown]
    .sort((a, b) => Number(APPLE_TYPES.includes(b.label as AppleType)) - Number(APPLE_TYPES.includes(a.label as AppleType)))
    .slice(0, 4)
    .map((b) => `${int(b.units)} ${plural[b.label] ? plural[b.label][b.units === 1 ? 0 : 1] : APPLE_TYPES.includes(b.label as AppleType) ? b.label : b.label.toLowerCase()}`)
    .join(' · ');

  return (
    <div className="flex-col gap-6 inventory-page" style={{ width: '100%' }}>
      <div className="inventory-title-row">
        <div>
          <h1 className="h1">Estoque</h1>
          <p className="text-muted inventory-subtitle">
            Estoque atual do Mercado Phone, ao vivo: unidades disponíveis, valor potencial de venda, custo e lucro bruto potencial.
          </p>
        </div>
      </div>

      {!complete && !error && (
        <div className="inventory-error" role="status">
          O Mercado Phone não confirmou o total de itens do estoque: a lista e os indicadores podem estar incompletos. Use “Atualizar” em instantes.
        </div>
      )}

      {error && (
        <div className="inventory-error" role="alert">
          {error}{' '}
          <button type="button" className="btn-secondary" onClick={load}>
            Tentar de novo
          </button>
        </div>
      )}

      <StickyFilterBar
        summary={
          <>
            <strong>{int(filtered.length)}</strong> produto(s) · {scope}
            {fetchedAt && <> · Mercado Phone ao vivo, atualizado às {new Date(fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>}
          </>
        }
      >
        <div className="inventory-filters">
          <div className="search-bar inventory-search">
            <Search size={18} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Buscar por produto, modelo, cor, IMEI..."
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
              aria-label="Buscar no estoque"
            />
          </div>
          <select value={filters.category} onChange={(e) => set({ category: e.target.value as StockFilters['category'], appleType: 'all' })} aria-label="Categoria">
            <option value="all">Todas as categorias</option>
            {STOCK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filters.appleType}
            onChange={(e) => set({ appleType: e.target.value as 'all' | AppleType, category: e.target.value === 'all' ? filters.category : 'Produtos Apple' })}
            aria-label="Tipo de produto Apple"
          >
            <option value="all">Todos os tipos</option>
            {APPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={filters.status} onChange={(e) => set({ status: e.target.value as StockFilters['status'] })} aria-label="Situação do estoque">
            <option value="available">Disponível para venda</option>
            <option value="unavailable">Indisponível (laboratório/reserva)</option>
            <option value="all">Todas as situações</option>
          </select>
          <div className="inventory-filter-actions">
            <button type="button" className="btn-secondary inventory-refresh" onClick={load} disabled={loading} title="Atualizar com o Mercado Phone">
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              <span>Atualizar</span>
            </button>
            <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
              <Plus size={18} />
              Novo Produto
            </button>
          </div>
        </div>
      </StickyFilterBar>

      {savedNote && (
        <p className="inventory-note" role="status">
          {savedNote}
        </p>
      )}

      <MetricGrid>
        <MetricCard
          icon={<Boxes size={20} />}
          tone="blue"
          badge="Quantidade"
          label="Produtos em estoque"
          value={units(m.units)}
          caption={m.units > 0 ? breakdownText : 'Nenhuma unidade nos filtros'}
          loading={loading && items.length === 0}
          onOpen={() => setDetail('quantity')}
        />
        <MetricCard
          icon={<Trophy size={20} />}
          tone="green"
          badge="Ranking"
          label="Produto com maior estoque"
          value={top ? top.group : '—'}
          caption={top ? `${units(top.units)} ${top.units === 1 ? 'disponível' : 'disponíveis'}` : 'Sem produtos nos filtros'}
          loading={loading && items.length === 0}
          onOpen={() => setDetail('ranking')}
        />
        <MetricCard
          icon={<CircleDollarSign size={20} />}
          tone="purple"
          badge="Projeção"
          label="Valor potencial de venda"
          value={money(m.potential)}
          caption="Se tudo for vendido pelos preços cadastrados"
          partial={pricePartial}
          loading={loading && items.length === 0}
          onOpen={() => setDetail('potential')}
        />
        <MetricCard
          icon={<Wallet size={20} />}
          tone="amber"
          badge="Investido"
          label="Custo total do estoque"
          value={money(m.cost)}
          caption="Custos registrados das unidades em estoque"
          partial={costPartial}
          loading={loading && items.length === 0}
          onOpen={() => setDetail('cost')}
        />
        <MetricCard
          icon={<TrendingUp size={20} />}
          tone="teal"
          badge="Estimativa"
          label="Lucro bruto potencial"
          value={money(m.profit)}
          caption={m.potential > 0 ? `Margem potencial ${((m.profit / m.potential) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · não é lucro realizado` : 'Não é lucro realizado'}
          partial={m.complete ? null : 'Estimativa parcial: há produtos sem preço ou custo'}
          loading={loading && items.length === 0}
          onOpen={() => setDetail('profit')}
        />
      </MetricGrid>

      <StockTurnoverPanel items={classified} />

      <div className="inventory-container">
        <div className="inventory-table-card" style={{ opacity: loading && items.length > 0 ? 0.7 : 1 }}>
          <table className="inventory-table">
            <thead>
              <tr>
                <th>PRODUTO & MODELO</th>
                <th>CATEGORIA</th>
                <th>SITUAÇÃO</th>
                <th className="is-right">QTD.</th>
                <th className="is-right">CUSTO UNIT.</th>
                <th className="is-right">VALOR UNITÁRIO</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState title="Nenhum produto em estoque">Nenhum item corresponde aos filtros selecionados.</EmptyState>
                  </td>
                </tr>
              )}
              {loading && items.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Lendo o estoque do Mercado Phone…
                  </td>
                </tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="product-cell">
                      <div className="product-image">
                        <CategoryIcon item={item} size={22} />
                      </div>
                      <div className="product-info">
                        <span className="product-name">{item.description}</span>
                        <span className="product-meta">
                          {item.id}
                          {item.condition && ` • ${item.condition}`}
                        </span>
                        {(item.imei || item.battery != null) && (
                          <span className="product-meta" style={{ color: 'var(--accent-text)', marginTop: '2px' }}>
                            {item.imei && `IMEI: ${item.imei}`}
                            {item.imei && item.battery != null && ' • '}
                            {item.battery != null && item.battery > 0 && `Saúde da Bateria: ${item.battery}%`}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`category-badge ${badgeClass(item.category)}`}>
                      <CategoryIcon item={item} />
                      {typeLabel(item)}
                    </span>
                  </td>
                  <td>
                    <span className={`stock-status ${item.available ? 'is-available' : 'is-unavailable'}`}>{item.availability}</span>
                  </td>
                  <td className="is-right qty-cell">{int(item.quantity)}</td>
                  <td className="is-right">{hasCost(item) ? money(item.cost!) : <span className="mc-warn">sem custo</span>}</td>
                  <td className="is-right">
                    <span className="price-cell">{!isSellable(item) ? <span className="mc-muted">brinde</span> : hasPrice(item) ? money(item.price!) : <span className="mc-warn">sem preço</span>}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailModal}

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Cadastrar Produto/Aparelho</h2>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleRegister}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Categoria</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value as 'Aparelhos' | 'Acessórios'})}
                  >
                    <option value="Aparelhos">Aparelhos</option>
                    <option value="Acessórios">Acessórios</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Produto / Modelo</label>
                  <input
                    type="text"
                    placeholder="Ex: iPhone 15 128GB"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Marca</label>
                  <input
                    type="text"
                    placeholder="Ex: Apple"
                    value={formData.brand}
                    onChange={(e) => setFormData({...formData, brand: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>Localização</label>
                  <input
                    type="text"
                    placeholder="Ex: Vitrine Principal A1"
                    value={formData.location}
                    onChange={(e) => setFormData({...formData, location: e.target.value})}
                  />
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Estoque Atual</label>
                    <input
                      type="number"
                      min={0}
                      value={formData.stock}
                      onChange={(e) => setFormData({...formData, stock: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Estoque Mínimo</label>
                    <input
                      type="number"
                      min={0}
                      value={formData.minStock}
                      onChange={(e) => setFormData({...formData, minStock: e.target.value})}
                      required
                    />
                  </div>
                </div>

                {formData.category === 'Aparelhos' && (
                  <>
                    <div className="form-group">
                      <label>IMEI / Serial</label>
                      <input
                        type="text"
                        placeholder="Ex: 358900000000000"
                        value={formData.imei}
                        onChange={(e) => setFormData({...formData, imei: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Saúde da Bateria (%)</label>
                      <input
                        type="text"
                        placeholder="Ex: 85%"
                        value={formData.batteryHealth}
                        onChange={(e) => setFormData({...formData, batteryHealth: e.target.value})}
                      />
                    </div>
                  </>
                )}

                <div className="form-group">
                  <label>Valor Unitário (R$)</label>
                  <input
                    type="number"
                    placeholder="Ex: 4999.00"
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    required
                  />
                </div>
              </div>
              {registerError && (
                <p className="inventory-error" role="alert" style={{ margin: '0 24px 12px' }}>
                  {registerError}
                </p>
              )}
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar Cadastro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
