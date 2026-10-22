import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, Hourglass, Info, X } from 'lucide-react';
import { MetricCard } from '../metrics/MetricPanel';
import type { StockItem } from '../../lib/finance/stockMetrics';
import { addDays, addMonths, formatDateBR, monthOf, storeToday } from '../../lib/finance/dates';
import { brl } from '../../lib/finance/format';
import { fetchStockMovements, fetchTurnoverLines } from '../../lib/finance/turnoverApi';
import {
  allocateFifo,
  compareTurnover,
  exitsBreakdown,
  fastestProducts,
  monthlyEvolution,
  normalizeUnitLines,
  periodTurnover,
  previousRange,
  stockAgeRows,
  summarizeStockAge,
  TURNOVER_CATEGORIES,
  TURNOVER_LABELS,
  TURNOVER_PRESET_LABELS,
  turnoverRange,
  type CategoryFilter,
  type StockMovement,
  type TurnoverLine,
  type TurnoverPreset,
} from '../../lib/finance/stockTurnover';
import './turnover.css';

const MONTHS_BACK = 5;
/** Até ~13 meses de histórico de vendas por carga. */
const MAX_HISTORY_DAYS = 395;
const days = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${Math.round(v * 10) / 10 === 1 ? 'dia' : 'dias'}`);
const units = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'unidade' : 'unidades'}`;
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthShort = (m: string) => `${MONTH_SHORT[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

/**
 * Giro médio de estoque (vendas) e idade média do estoque atual. Recebe o estoque ao vivo já sem
 * itens de controle (seguro/blindagem). Página só de administrador (mostra custo no ranking).
 */
export function StockTurnoverPanel({ items }: { items: StockItem[] }) {
  const today = storeToday();
  const [preset, setPreset] = useState<TurnoverPreset>('last30');
  const [custom, setCustom] = useState({ from: today, to: today });
  const [category, setCategory] = useState<CategoryFilter>('all');
  const minCustom = addDays(today, -365);
  const range = useMemo(() => {
    const r = turnoverRange(preset, today, custom);
    return r.from < minCustom ? { ...r, from: minCustom } : r;
  }, [preset, today, custom, minCustom]);
  const prev = useMemo(() => previousRange(preset, range), [preset, range]);

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [ledgerAvailable, setLedgerAvailable] = useState(true);
  const [lines, setLines] = useState<TurnoverLine[]>([]);
  const [linesFrom, setLinesFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<null | 'turnover' | 'age'>(null);

  // Entradas detectadas → histórico desde o início do período anterior ou do rastreamento.
  // Trocar de filtro só baixa de novo se a janela já carregada não cobrir o período pedido.
  const loaded = useRef<{ from: string; to: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const to = range.to > today ? range.to : today;
    if (loaded.current && loaded.current.from <= prev.from && loaded.current.to >= to) return;
    setLoading(true);
    setError(null);
    (async () => {
      const ledger = await fetchStockMovements();
      const start = ledger.movements.reduce<string | null>((min, m) => (min == null || m.detectedAt < min ? m.detectedAt : min), null);
      // Janela máxima de histórico (o rastreamento cresce sem limite): além dela, idade desconhecida.
      const floor = addDays(today, -MAX_HISTORY_DAYS);
      // Cards: só o período atual + o anterior (e o início do rastreamento, para o FIFO). A evolução
      // mensal (6 meses) só é baixada ao abrir o detalhe.
      const wanted = [prev.from, start?.slice(0, 10)].filter((d): d is string => !!d).sort()[0];
      const from = wanted < floor ? floor : wanted;
      const l = await fetchTurnoverLines({ from, to });
      if (!alive) return;
      setMovements(ledger.movements);
      setLedgerAvailable(ledger.available);
      setLines(normalizeUnitLines(l));
      setLinesFrom(from);
      loaded.current = { from, to };
    })()
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [prev.from, range.to, today]);

  // Evolução mensal: carregada sob demanda (ao abrir o detalhe) e reaproveitada enquanto a página estiver aberta.
  const evolutionFrom = `${addMonths(monthOf(today), -MONTHS_BACK)}-01`;
  const [evolutionLines, setEvolutionLines] = useState<TurnoverLine[] | null>(null);
  const [evolutionError, setEvolutionError] = useState<string | null>(null);
  const evolutionRequested = useRef(false);
  useEffect(() => {
    if (!open || evolutionRequested.current || linesFrom == null) return;
    evolutionRequested.current = true;
    if (linesFrom <= evolutionFrom) {
      setEvolutionLines(lines);
      return;
    }
    fetchTurnoverLines({ from: evolutionFrom, to: today })
      .then((l) => setEvolutionLines(normalizeUnitLines(l)))
      .catch((err: Error) => {
        evolutionRequested.current = false;
        setEvolutionError(err.message);
      });
  }, [open, linesFrom, lines, evolutionFrom, today]);

  const currentQty = useMemo(() => new Map(items.map((i) => [i.id, i.quantity])), [items]);
  const fifo = useMemo(() => allocateFifo(lines, movements, currentQty, linesFrom ?? undefined), [lines, movements, currentQty, linesFrom]);
  const current = useMemo(() => periodTurnover(lines, fifo, range, category), [lines, fifo, range, category]);
  const previous = useMemo(() => periodTurnover(lines, fifo, prev, category), [lines, fifo, prev, category]);
  // Só compara com um período anterior que esteja inteiro no histórico carregado.
  const prevCovered = linesFrom != null && prev.from >= linesFrom;
  const cmp = prevCovered ? compareTurnover(current.avgDays, previous.avgDays) : { delta: null, trend: 'n/a' as const };
  // Idade do estoque = só o que está disponível para venda (laboratório/reserva ficam fora e são informados).
  const ageRows = useMemo(() => stockAgeRows(items.filter((i) => i.available), fifo, today), [items, fifo, today]);
  const unavailableUnits = useMemo(() => items.filter((i) => !i.available).reduce((a, i) => a + i.quantity, 0), [items]);
  const age = useMemo(() => summarizeStockAge(ageRows, category), [ageRows, category]);
  const trackingSince = fifo.trackingStart ? formatDateBR(fifo.trackingStart.slice(0, 10)) : null;

  const trendText =
    cmp.trend === 'n/a'
      ? 'Sem base de comparação no período anterior'
      : cmp.trend === 'stable'
        ? `Estável vs período anterior (${days(previous.avgDays)})`
        : `${cmp.trend === 'faster' ? '▼ Mais rápido' : '▲ Mais lento'}: ${days(Math.abs(cmp.delta!))} ${cmp.trend === 'faster' ? 'a menos' : 'a mais'} que o período anterior`;
  const turnoverPartial = [
    current.unknown > 0 ? `${units(current.unknown)} sem data de entrada confiável` : null,
    current.preorder > 0 ? `${units(current.preorder)} sob encomenda fora da média` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="turn-root" aria-label="Giro e idade do estoque">
      <div className="turn-head">
        <div>
          <h2 className="turn-title">Giro do estoque</h2>
          <p className="turn-sub">Velocidade de venda (vendas do período) e idade das mercadorias paradas. Brindes não contam como venda.</p>
        </div>
      </div>
      <div className="turn-filters">
        <div className="turn-seg" role="tablist" aria-label="Período das vendas">
          {(Object.keys(TURNOVER_PRESET_LABELS) as TurnoverPreset[]).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={preset === p} className={preset === p ? 'is-active' : ''} onClick={() => setPreset(p)}>
              {TURNOVER_PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="turn-dates">
            <label>
              De <input type="date" value={custom.from} min={minCustom} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
            </label>
            <label>
              Até <input type="date" value={custom.to} min={custom.from} max={today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
            </label>
          </div>
        )}
        <div className="turn-seg" role="tablist" aria-label="Categoria">
          {(['all', ...TURNOVER_CATEGORIES] as CategoryFilter[]).map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c} className={category === c ? 'is-active' : ''} onClick={() => setCategory(c)}>
              {c === 'all' ? 'Todos' : TURNOVER_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="turn-alert" role="alert">{error}</p>}
      {!ledgerAvailable && <p className="turn-alert is-soft">Rastreamento de entradas inativo: aplique a migração 0018_stock_movements.sql e publique a mercadophone-sync.</p>}

      <div className="turn-grid">
        <MetricCard
          icon={<Hourglass size={18} />}
          tone="teal"
          badge="Giro"
          label="Giro médio de estoque"
          loading={loading}
          value={current.avgDays == null ? 'Sem dados' : days(current.avgDays)}
          caption={
            <>
              Entrada → venda, média por unidade · {units(current.measured)} vendidas consideradas ({formatDateBR(range.from)} a {formatDateBR(range.to)})
              <br />
              <span className={`turn-trend is-${cmp.trend}`}>{trendText}</span>
            </>
          }
          partial={turnoverPartial || null}
          onOpen={() => setOpen('turnover')}
        />
        <MetricCard
          icon={<CalendarClock size={18} />}
          tone="purple"
          badge="Agora"
          label="Idade média do estoque atual"
          loading={loading}
          value={age.avgDays == null ? 'Sem dados' : days(age.avgDays)}
          caption={`Há quanto tempo as unidades disponíveis para venda estão na loja · ${units(age.knownUnits)} com data de entrada${unavailableUnits > 0 ? ` · ${units(unavailableUnits)} em laboratório/reserva fora` : ''}`}
          partial={age.unknownUnits > 0 ? `${units(age.unknownUnits)} sem data de entrada conhecida (lotes anteriores ao rastreamento${trackingSince ? ` de ${trackingSince}` : ''}, devoluções ou sem data no cadastro)` : null}
          onOpen={() => setOpen('age')}
        />
      </div>

      {open && !loading && !error && (
        <TurnoverModal
          initial={open}
          onClose={() => setOpen(null)}
          lines={lines}
          movements={movements}
          fifo={fifo}
          range={range}
          category={category}
          ageRows={ageRows}
          today={today}
          trackingSince={trackingSince}
          evolutionLines={evolutionLines}
          evolutionError={evolutionError}
          evolutionFrom={evolutionFrom}
          movementsForEvolution={movements}
          currentQty={currentQty}
        />
      )}
    </section>
  );
}

type Fifo = ReturnType<typeof allocateFifo>;
type AgeRows = ReturnType<typeof stockAgeRows>;

function TurnoverModal({
  initial,
  onClose,
  lines,
  movements,
  fifo,
  range,
  category,
  ageRows,
  today,
  trackingSince,
  evolutionLines,
  evolutionError,
  evolutionFrom,
  movementsForEvolution,
  currentQty,
}: {
  initial: 'turnover' | 'age';
  onClose: () => void;
  lines: TurnoverLine[];
  movements: StockMovement[];
  fifo: Fifo;
  range: { from: string; to: string };
  category: CategoryFilter;
  ageRows: AgeRows;
  today: string;
  trackingSince: string | null;
  evolutionLines: TurnoverLine[] | null;
  evolutionError: string | null;
  evolutionFrom: string;
  movementsForEvolution: StockMovement[];
  currentQty: Map<string, number>;
}) {
  const [minUnits, setMinUnits] = useState(3);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ageRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    if (initial === 'age') ageRef.current?.scrollIntoView({ block: 'start' });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocus?.focus?.();
    };
  }, [initial]);

  const t = useMemo(() => periodTurnover(lines, fifo, range), [lines, fifo, range]);
  const exits = useMemo(() => exitsBreakdown(lines, movements, range, category), [lines, movements, range, category]);
  const fastest = useMemo(() => fastestProducts(lines, fifo, range, category, minUnits), [lines, fifo, range, category, minUnits]);
  const evolution = useMemo(() => {
    if (!evolutionLines) return [];
    const evoFifo = allocateFifo(evolutionLines, movementsForEvolution, currentQty, evolutionFrom);
    return monthlyEvolution(evolutionLines, evoFifo, monthOf(evolutionFrom), today);
  }, [evolutionLines, movementsForEvolution, currentQty, evolutionFrom, today]);
  const ageByCat = useMemo(() => summarizeStockAge(ageRows, category), [ageRows, category]);
  const slowest = useMemo(
    () =>
      ageRows
        .filter((r) => category === 'all' || r.category === category)
        .sort((a, b) => (b.oldestDays ?? -1) - (a.oldestDays ?? -1) || b.quantity - a.quantity)
        .slice(0, 25),
    [ageRows, category]
  );
  const chartData = evolution.map((p) => ({ month: monthShort(p.month), ...Object.fromEntries(TURNOVER_CATEGORIES.map((c) => [c, p.values[c] == null ? null : Math.round(p.values[c]! * 10) / 10])) }));
  const shownCats = category === 'all' ? TURNOVER_CATEGORIES : [category];

  return (
    <div className="mc-modal-overlay" role="presentation" onClick={onClose}>
      <div className="mc-modal turn-modal" role="dialog" aria-modal="true" aria-label="Análise de giro do estoque" onClick={(e) => e.stopPropagation()}>
        <header className="mc-modal-head">
          <div>
            <h3>Análise de giro do estoque</h3>
            <span className="mc-modal-scope">
              Vendas de {formatDateBR(range.from)} a {formatDateBR(range.to)} · {category === 'all' ? 'todas as categorias' : TURNOVER_LABELS[category]}
            </span>
          </div>
          <button ref={closeRef} type="button" className="mc-modal-close" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="turn-modal-body">
          <section>
            <h4>A. Giro médio por categoria</h4>
            <p className="turn-note">Permanência = data da venda − data de entrada. Média ponderada pelas unidades vendidas com data válida.</p>
            <div className="turn-table-wrap">
              <table className="turn-table">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className="is-right">Tempo médio</th>
                    <th className="is-right">Unid. consideradas</th>
                    <th className="is-right">Sem data</th>
                    <th className="is-right">Encomendas</th>
                    <th className="is-right">Brindes (fora)</th>
                  </tr>
                </thead>
                <tbody>
                  {TURNOVER_CATEGORIES.map((c) => {
                    const s = t.byCategory[c];
                    return (
                      <tr key={c} className={category !== 'all' && category !== c ? 'is-dim' : ''}>
                        <td>
                          <span className={`turn-swatch is-${c}`} aria-hidden /> {TURNOVER_LABELS[c]}
                        </td>
                        <td className="is-right"><strong>{days(s.avgDays)}</strong></td>
                        <td className="is-right">{s.measured.toLocaleString('pt-BR')}</td>
                        <td className="is-right">{s.unknown.toLocaleString('pt-BR')}</td>
                        <td className="is-right">{s.preorder.toLocaleString('pt-BR')}</td>
                        <td className="is-right">{s.brinde.toLocaleString('pt-BR')}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Todos</td>
                    <td className="is-right"><strong>{days(t.avgDays)}</strong></td>
                    <td className="is-right">{t.measured.toLocaleString('pt-BR')}</td>
                    <td className="is-right">{t.unknown.toLocaleString('pt-BR')}</td>
                    <td className="is-right">{t.preorder.toLocaleString('pt-BR')}</td>
                    <td className="is-right">{t.brinde.toLocaleString('pt-BR')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="turn-exits">
              <span>Saídas do período:</span>
              <strong>{units(exits.sale)} por venda</strong>
              <strong>{units(exits.brinde)} por brinde/cortesia</strong>
              <strong>{exits.other == null ? 'outras saídas: disponível quando o rastreamento cobrir todo o período' : `${units(exits.other)} outras saídas (baixas além das vendas)`}</strong>
            </div>
          </section>

          <section ref={ageRef}>
            <h4>B. Produtos com maior tempo parado (estoque atual)</h4>
            <p className="turn-note">
              Idade média do estoque atual: <strong>{days(ageByCat.avgDays)}</strong> ({units(ageByCat.knownUnits)} com data; {units(ageByCat.unknownUnits)} sem data). Unidades com IMEI/série
              usam a data real; lotes usam as entradas detectadas (FIFO){trackingSince ? ` desde ${trackingSince}` : ''}.
            </p>
            <div className="turn-table-wrap">
              <table className="turn-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Categoria</th>
                    <th className="is-right">Qtd.</th>
                    <th>Entrada</th>
                    <th className="is-right">Dias em estoque</th>
                    <th className="is-right">Preço de venda</th>
                    <th className="is-right">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {slowest.map((r) => (
                    <tr key={r.item.id}>
                      <td className="turn-product" data-label="Produto">{r.item.description}</td>
                      <td data-label="Categoria">{TURNOVER_LABELS[r.category]}</td>
                      <td className="is-right" data-label="Qtd.">{r.quantity.toLocaleString('pt-BR')}</td>
                      <td data-label="Entrada">
                        {r.oldestEntry ? formatDateBR(r.oldestEntry) : <span className="turn-muted">sem data</span>}
                        {r.method === 'fifo' && r.unknownUnits > 0 && r.oldestEntry && <div className="turn-muted">+{r.unknownUnits} sem data</div>}
                      </td>
                      <td className="is-right" data-label="Dias"><strong>{r.oldestDays == null ? '—' : r.oldestDays.toLocaleString('pt-BR')}</strong></td>
                      <td className="is-right" data-label="Preço">{r.item.price ? brl(r.item.price) : '—'}</td>
                      <td className="is-right" data-label="Custo">{r.item.cost ? brl(r.item.cost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="turn-section-head">
              <h4>C. Produtos com giro mais rápido</h4>
              <label className="turn-min">
                Mínimo de vendas
                <input type="number" min={1} max={100} value={minUnits} onChange={(e) => setMinUnits(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
              </label>
            </div>
            {fastest.length === 0 ? (
              <p className="turn-note">Nenhum produto com {minUnits}+ unidades vendidas com data válida no período.</p>
            ) : (
              <div className="turn-table-wrap">
                <table className="turn-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Categoria</th>
                      <th className="is-right">Unid. consideradas</th>
                      <th className="is-right">Tempo médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fastest.map((p) => (
                      <tr key={p.name}>
                        <td className="turn-product" data-label="Produto">{p.name}</td>
                        <td data-label="Categoria">{TURNOVER_LABELS[p.category]}</td>
                        <td className="is-right" data-label="Unidades">{p.units.toLocaleString('pt-BR')}</td>
                        <td className="is-right" data-label="Tempo médio"><strong>{days(p.avgDays)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h4>D. Evolução mensal do tempo médio de permanência</h4>
            <p className="turn-note">Dias entre entrada e venda, por mês da venda (desde {formatDateBR(evolutionFrom)}). Mês sem unidades com data válida fica sem ponto.</p>
            {evolutionError ? (
              <p className="turn-alert" role="alert">{evolutionError}</p>
            ) : !evolutionLines ? (
              <p className="turn-note" role="status">Carregando 6 meses de vendas do Mercado Phone…</p>
            ) : (
            <div className="turn-chart" role="img" aria-label="Gráfico de linhas do tempo médio de permanência por categoria e mês">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 12, right: 12, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-color)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={44} unit="d" allowDecimals={false} />
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => [days(v as number), TURNOVER_LABELS[name as keyof typeof TURNOVER_LABELS] ?? String(name)]}
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, color: 'var(--text-dark)' }}
                    labelStyle={{ color: 'var(--text-dark)', fontWeight: 700 }}
                  />
                  <Legend formatter={(v: string) => <span style={{ color: 'var(--text-dark)' }}>{TURNOVER_LABELS[v as keyof typeof TURNOVER_LABELS] ?? v}</span>} />
                  {shownCats.map((c) => (
                    <Line key={c} type="linear" dataKey={c} stroke={`var(--turn-${c})`} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            )}
          </section>

          <aside className="turn-limits">
            <Info size={16} aria-hidden />
            <div>
              <strong>Origem e limitações dos dados</strong>
              <ul>
                <li>Vendas: histórico do Mercado Phone (uma linha por item). Canceladas não contam; brinde (valor pago zero) sai do estoque mas não entra no giro de vendas — iPhone sempre conta como venda.</li>
                <li>iPhones e demais aparelhos com IMEI/série: data de entrada real da unidade. Vendidos antes da entrada registrada (encomenda) ficam fora da média.</li>
                <li>
                  Acessórios, películas e brindes: o Mercado Phone soma reposições no mesmo cadastro sem registrar a data. A idade vem das entradas detectadas pelo sistema
                  {trackingSince ? ` desde ${trackingSince}` : ' (rastreamento ainda não iniciado)'} com FIFO — estimativa contábil, não rastreabilidade real. Antes disso, “sem data”.
                </li>
                <li>
                  Devoluções não são informadas pela API: a volta ao estoque de uma venda cancelada nos últimos 15 dias entra como saldo sem data (não como
                  reposição); retornos sem venda cancelada aparecem como entrada.
                </li>
                <li>“Outras saídas” compara as baixas vistas no estoque com as vendas do histórico; perto da meia-noite pode haver diferença de poucas unidades entre dias.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
