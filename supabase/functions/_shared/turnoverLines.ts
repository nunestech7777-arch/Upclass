import { isUnitTracked } from './stockLedger.ts';
import { stripIdentifiers } from './stockItems.ts';

/**
 * Linhas do histórico de vendas do MercadoPhone reduzidas ao necessário para o giro de estoque
 * (function mercadophone-giro). Módulo puro — testado em turnoverLines.test.ts.
 * Não repassa cliente, fornecedor, IMEI/série, custo ou lucro: só se a unidade TEM identificação.
 */

export interface HistoricoGiroRow {
  vendaId: number | string;
  produtoId: number | string;
  quantidade?: number | string | null;
  dataVenda: string;
  dataEntrada?: string | null;
  statusVenda?: string | null;
  valorCliente?: number | string | null;
  aparelhoDescricao?: string | null;
  produtoDescricao?: string | null;
  tipoProdutoDescricao?: string | null;
  imei1?: string | null;
  imei2?: string | null;
  serialNumber?: string | null;
}

export interface TurnoverLine {
  /** `<venda>-<produto>-<ordem>`: estável dentro da mesma resposta. */
  key: string;
  orderId: string;
  productId: string;
  name: string;
  type: string | null;
  quantity: number;
  /** Horário da loja `AAAA-MM-DD HH:mm:ss`. */
  soldAt: string;
  /** Data de entrada do CADASTRO do produto no MercadoPhone (null = não informada). */
  entryDate: string | null;
  /** Unidade com IMEI/série fora dos tipos em lote: a data de entrada é a da própria unidade. */
  unit: boolean;
  /** Valor pago pelo cliente > 0 (brinde = 0). */
  paid: boolean;
  cancelled: boolean;
}

const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/** "BRINDES - CAPA TRANSPARENTE - BND - . - . - . - Id: 149442" → "CAPA TRANSPARENTE - BND" (sem prefixo de tipo nem Id). */
export function lineName(r: Pick<HistoricoGiroRow, 'aparelhoDescricao' | 'produtoDescricao' | 'produtoId'>): string {
  const a = clean(r.aparelhoDescricao);
  if (a) return a;
  // produtoDescricao pode trazer IMEI/série: nunca sai daqui.
  const p = stripIdentifiers(clean(r.produtoDescricao).replace(/\s*-\s*Id:\s*\d+\s*$/i, ''))
    .split(/\s+-\s+/)
    .filter((s) => s && s !== '.')
    .join(' - ');
  return p || `Produto ${r.produtoId}`;
}

export function toTurnoverLines(rows: HistoricoGiroRow[]): TurnoverLine[] {
  const seq = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.vendaId}-${r.produtoId}`;
    const n = seq.get(base) ?? 0;
    seq.set(base, n + 1);
    const entry = clean(r.dataEntrada).slice(0, 10);
    return {
      key: `${base}-${n}`,
      orderId: String(r.vendaId),
      productId: String(r.produtoId),
      name: lineName(r),
      type: clean(r.tipoProdutoDescricao) || null,
      quantity: Math.max(0, Math.floor(Number(r.quantidade) || 0)),
      soldAt: clean(r.dataVenda).slice(0, 19),
      entryDate: /^\d{4}-\d{2}-\d{2}$/.test(entry) ? entry : null,
      unit: isUnitTracked(r),
      paid: (Number(r.valorCliente) || 0) > 0,
      cancelled: clean(r.statusVenda).toLowerCase().startsWith('cancel'),
    };
  });
}
