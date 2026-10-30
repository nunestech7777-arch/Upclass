import type { ChannelFilter } from './channels.ts';

/** Período em dias da loja (AAAA-MM-DD, inclusivos). */
export interface StoreRange {
  from: string;
  to: string;
}

/**
 * Filtros compartilhados pelas seções do Meu Supervisor (ficam na URL: ?periodo, ?de, ?ate,
 * ?vendedor, ?canal). `seller` = id do vendedor que RESPONDEU, 'none' = conversas sem atendente identificado.
 */
export interface SupervisorFilters {
  range: StoreRange;
  seller: string | 'all' | 'none';
  channel: ChannelFilter;
}

/**
 * Limites do período em UTC. A loja fica em America/Sao_Paulo, que não tem horário de verão
 * desde 2019 (UTC−3 o ano todo); o fim é exclusivo (meia-noite do dia seguinte).
 */
export function rangeToInstants(range: StoreRange): { fromIso: string; toIso: string } {
  const start = new Date(`${range.from}T00:00:00-03:00`);
  const end = new Date(`${range.to}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

/** Dias do período, em ordem (para os gráficos mostrarem dias sem atendimento como zero). */
export function daysOf(range: StoreRange, max = 92): string[] {
  const out: string[] = [];
  const cur = new Date(`${range.from}T12:00:00Z`);
  const end = new Date(`${range.to}T12:00:00Z`);
  while (cur <= end && out.length < max) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Termo de busca seguro para o filtro `or` do PostgREST: tira os caracteres que mudam a sintaxe
 * (vírgula, parênteses, asterisco, aspas e barra invertida) e limita o tamanho.
 */
export function sanitizeSearch(term: string): string {
  return term.replace(/[(),*"\\%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function filtersKey(f: SupervisorFilters): string {
  return `${f.range.from}|${f.range.to}|${f.seller}|${f.channel}`;
}
