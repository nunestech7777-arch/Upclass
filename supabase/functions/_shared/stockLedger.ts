/**
 * Detecta entradas e saídas de produtos vendidos em LOTE comparando a leitura atual do estoque do
 * MercadoPhone com a anterior (tabela stock_levels). Módulo puro — usado pela mercadophone-sync e
 * pelos testes (stockLedger.test.ts).
 *
 * - Só com lista COMPLETA (mesma regra que zera o estoque): lista parcial nunca vira "saída".
 * - Unidades com IMEI/série e itens de controle (seguro/blindagem, quantidade ≥ 9000) ficam fora.
 * - Primeira leitura de todas: saldo vira `baseline` (idade desconhecida — não inventa data).
 * - Produto que aparece depois: `entry`. Data = dataEntrada do MercadoPhone quando ela é posterior à
 *   leitura anterior (cadastro/reposição recente com data informada); senão, a data da detecção.
 */

export const CONTROL_QTY = 9000;
const CONTROL = /\b(SEGURO|BLINDAGEM|GARANTIA)\b/i;

export interface LedgerSnapshotItem {
  id: number | string;
  quantidade?: number | string | null;
  dataEntrada?: string | null;
  aparelhoDescricao?: string | null;
  descricao?: string | null;
  tipoProdutoDescricao?: string | null;
  imei?: string | null;
  serialNumber?: string | null;
  snServico?: number | null;
  excluido?: boolean | null;
}

export interface LevelRow {
  product_external_id: string;
  quantity: number;
  /** Data da loja da última leitura (AAAA-MM-DD). */
  last_seen_date: string;
}

export interface PlannedMovement {
  product_external_id: string;
  kind: 'baseline' | 'entry' | 'exit' | 'return';
  quantity: number;
  quantity_after: number;
  entry_date: string | null;
  name: string | null;
  product_type: string | null;
}

export interface PlannedLevel {
  product_external_id: string;
  quantity: number;
  name: string | null;
  product_type: string | null;
}

/** Tipos oficiais do MercadoPhone que são mercadoria em LOTE (mesmo cadastro, várias reposições). */
export const LOT_TYPES = new Set(['ACESSORIOS', 'BRINDES', 'TORTUGA SHILD']);

export const normalizeType = (v: string | null | undefined) =>
  (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Unidade rastreável individualmente (a dataEntrada é a da própria unidade): tem IMEI ou número de
 * série E não é de um tipo vendido em lote (há acessórios com série digitada no cadastro, ex.:
 * "PELICULA DE CAMERA BRILHOSA" com entrada em 2024 vendendo em 2026).
 */
export function isUnitTracked(i: { imei?: string | null; imei1?: string | null; imei2?: string | null; serialNumber?: string | null; tipoProdutoDescricao?: string | null }): boolean {
  const hasId = [i.imei, i.imei1, i.imei2, i.serialNumber].some((v) => !!(v ?? '').trim());
  return hasId && !LOT_TYPES.has(normalizeType(i.tipoProdutoDescricao));
}

const qtyOf = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10));

export function isLedgerItem(i: LedgerSnapshotItem): boolean {
  if (i.snServico === 1 || i.excluido) return false;
  if (isUnitTracked(i)) return false;
  const name = `${i.aparelhoDescricao ?? ''} ${i.descricao ?? ''}`;
  return qtyOf(i.quantidade) < CONTROL_QTY && !CONTROL.test(name);
}

export interface LedgerPlan {
  movements: PlannedMovement[];
  /** Produtos lidos agora (upsert em stock_levels). */
  levels: PlannedLevel[];
  /** Níveis que vão a 0: produto que sumiu da lista (com saída registrada) ou que saiu do rastreamento (sem saída). */
  zeroed: string[];
}

/**
 * Vendas do intervalo desde a leitura anterior (histórico do MercadoPhone), por produto:
 * `sold` = unidades vendidas/brindes não canceladas; `returned` = unidades de vendas canceladas
 * (voltam ao estoque).
 */
export interface IntervalSales {
  sold: Map<string, number>;
  returned: Map<string, number>;
}

export function planStockMovements(levels: LevelRow[], snapshot: LedgerSnapshotItem[], today: string, interval?: IntervalSales): LedgerPlan {
  const firstRun = levels.length === 0;
  const prev = new Map(levels.map((l) => [l.product_external_id, l]));
  const movements: PlannedMovement[] = [];
  const nextLevels: PlannedLevel[] = [];
  const zeroed: string[] = [];
  const seen = new Set<string>();
  // Presentes na lista, rastreáveis ou não: quem só deixou de ser rastreável (ganhou série, virou
  // item de controle) não "saiu" do estoque.
  const present = new Set(snapshot.map((i) => String(i.id)));

  for (const item of snapshot) {
    if (!isLedgerItem(item)) continue;
    const id = String(item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const qty = qtyOf(item.quantidade);
    const name = (item.aparelhoDescricao ?? item.descricao ?? '').trim() || null;
    const type = (item.tipoProdutoDescricao ?? '').trim() || null;
    const before = prev.get(id);
    const entryDate = (since: string | null) => {
      const d = isDate(item.dataEntrada) ? item.dataEntrada!.slice(0, 10) : null;
      return d && d <= today && since != null && d > since ? d : today;
    };
    nextLevels.push({ product_external_id: id, quantity: qty, name, product_type: type });

    if (!before) {
      if (qty === 0) continue;
      if (firstRun) movements.push({ product_external_id: id, kind: 'baseline', quantity: qty, quantity_after: qty, entry_date: null, name, product_type: type });
      else {
        // Novo para o sistema: cadastro recente (dataEntrada posterior à última leitura geral) ou
        // reposição de um cadastro que estava zerado (dataEntrada antiga → data da detecção).
        const lastRun = levels.reduce((max, l) => (l.last_seen_date > max ? l.last_seen_date : max), '');
        // Vendido no intervalo também entrou (senão a venda ficaria sem lote).
        const entered = qty + (interval?.sold.get(id) ?? 0);
        movements.push({ product_external_id: id, kind: 'entry', quantity: entered, quantity_after: qty, entry_date: entryDate(lastRun ? addDaysIso(lastRun, -1) : null), name, product_type: type });
        if (entered > qty) movements.push({ product_external_id: id, kind: 'exit', quantity: entered - qty, quantity_after: qty, entry_date: null, name, product_type: type });
      }
      continue;
    }
    // Saldo esperado = anterior − vendido + devolvido. O que passar disso é reposição (mesmo que
    // tenha sido vendida na mesma janela); devolução de cancelada volta com idade desconhecida.
    const sold = interval?.sold.get(id) ?? 0;
    const returnedMax = interval?.returned.get(id) ?? 0;
    const increase = qty - (before.quantity - sold);
    const returned = Math.max(0, Math.min(increase, returnedMax));
    const entry = Math.max(0, increase - returned);
    const out = before.quantity + entry + returned - qty;
    if (returned > 0) movements.push({ product_external_id: id, kind: 'return', quantity: returned, quantity_after: qty, entry_date: null, name, product_type: type });
    if (entry > 0) movements.push({ product_external_id: id, kind: 'entry', quantity: entry, quantity_after: qty, entry_date: entryDate(before.last_seen_date), name, product_type: type });
    if (out > 0) movements.push({ product_external_id: id, kind: 'exit', quantity: out, quantity_after: qty, entry_date: null, name, product_type: type });
  }

  // Lista completa: o que tinha saldo e sumiu da lista saiu inteiro.
  for (const l of levels) {
    if (seen.has(l.product_external_id) || l.quantity === 0) continue;
    if (present.has(l.product_external_id)) {
      // Continua na lista, mas saiu do rastreamento: zera o nível sem registrar saída.
      zeroed.push(l.product_external_id);
      continue;
    }
    movements.push({ product_external_id: l.product_external_id, kind: 'exit', quantity: l.quantity, quantity_after: 0, entry_date: null, name: null, product_type: null });
    zeroed.push(l.product_external_id);
  }
  return { movements, levels: nextLevels, zeroed };
}

function addDaysIso(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
