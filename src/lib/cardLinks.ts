/**
 * Destinos dos cards navegáveis (atalhos para o detalhamento de cada indicador). Um lugar só para as
 * rotas e os parâmetros que as páginas de destino entendem — nada de URL montada à mão nos componentes.
 *
 * O período não vai na URL: é o filtro geral do sistema (PeriodContext) e acompanha a navegação.
 * Quando o card representa outro período (dia escolhido, semana da meta), `period` o leva junto
 * (?periodo=custom&de=&ate=, lido pelo PeriodContext, que passa a ser o período geral).
 */
export type SalesCategory = 'Aparelhos' | 'Acessórios';

export interface SalesLinkFilters {
  categoria?: SalesCategory;
  /** id do produto (filtro "produto" da tela Vendas). */
  produto?: string;
  /** Texto da busca por produto (quando o indicador agrupa produtos pelo nome). */
  busca?: string;
  vendedor?: string;
  /** Leva este intervalo como período geral. */
  period?: { from: string; to: string };
}

function withQuery(path: string, params: Record<string, string | undefined>, hash?: string): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `${path}${s ? `?${s}` : ''}${hash ? `#${hash}` : ''}`;
}

const periodParams = (p?: { from: string; to: string }) => (p ? { periodo: 'custom', de: p.from, ate: p.to } : {});

export const cardLinks = {
  sales: (f: SalesLinkFilters = {}) =>
    withQuery('/vendas', { categoria: f.categoria, produto: f.produto, busca: f.busca, vendedor: f.vendedor, ...periodParams(f.period) }),
  /** Ranking de lucro/margem do mês (Resultado financeiro). */
  financial: () => '/resultado-financeiro',
  daily: (day?: string) => withQuery('/resultados-diarios', { dia: day }),
  /** Seções da tela Metas (ids em Goals.tsx). */
  goals: (section: 'meta-semanal' | 'meta-mensal' | 'metas-semanais-vendedor' | 'metas-vendedor' | 'metas-lucro') => `/metas#${section}`,
  seller: (sellerId: string) => `/vendedores/${sellerId}`,
  /** Card Ranking de Conversão do Dashboard. */
  conversionRanking: () => '/#ranking-conversao',
  sellersRanking: () => '/vendedores',
  /** Meu Supervisor: `search` = filtros atuais (?vendedor, ?canal), mantidos na seção de destino. */
  supervisor: (section: '' | 'conversas' | 'analise-ia' | 'vendedores' | 'relatorios', search = '', status?: string) => {
    const q = new URLSearchParams(search);
    if (status) q.set('status', status);
    const s = q.toString();
    return `/supervisor${section ? `/${section}` : ''}${s ? `?${s}` : ''}`;
  },
};

export const SALES_LINK_PARAMS = ['categoria', 'produto', 'busca', 'vendedor'] as const;

/** Filtros da tela Vendas vindos da URL (card de origem); valores desconhecidos são ignorados. */
export function readSalesLinkFilters(search: string): Omit<SalesLinkFilters, 'period'> {
  const p = new URLSearchParams(search);
  const categoria = p.get('categoria');
  return {
    categoria: categoria === 'Aparelhos' || categoria === 'Acessórios' ? categoria : undefined,
    produto: p.get('produto') || undefined,
    busca: p.get('busca') || undefined,
    vendedor: p.get('vendedor') || undefined,
  };
}
