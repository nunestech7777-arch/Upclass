import type { StoreRange, SupervisorFilters } from './filters.ts';

/**
 * Política do cache do Meu Supervisor (só memória do navegador; ver swrStore.ts).
 * - Período que inclui hoje: novas mensagens do Kommo chegam o tempo todo → vale 2 min.
 * - Período só com dias passados: muda pouco (sincronização tardia, marcadores dos eventos) → 30 min.
 * O botão "Atualizar" ignora os prazos.
 */
export const TODAY_TTL_MS = 2 * 60_000;
/**
 * Atualização automática com o Supervisor aberto, aba visível e hoje no período. Maior que o prazo,
 * para cada ciclo achar o dado vencido; cada ciclo refaz o período, então não vale encurtar.
 */
export const AUTO_REFRESH_MS = 3 * 60_000;
/** Só períodos curtos (hoje, ontem+hoje, semana) se atualizam sozinhos; os longos custam mais consultas. */
export const AUTO_REFRESH_MAX_DAYS = 7;
export const HISTORICAL_TTL_MS = 30 * 60_000;
/** Lista de vendedores e de usuários do Kommo (mudam raramente; o vínculo invalida na hora). */
export const LISTS_TTL_MS = 10 * 60_000;

export function includesToday(range: StoreRange, today: string): boolean {
  return range.to >= today;
}

export function periodTtlMs(range: StoreRange, today: string): number {
  return includesToday(range, today) ? TODAY_TTL_MS : HISTORICAL_TTL_MS;
}

/**
 * Chave dos dados-base de um período: conta logada + período + canal + se ele inclui hoje. O atendente
 * não entra porque o filtro dele é aplicado depois, em memória, sobre os mesmos dados. A marca de hoje
 * troca a chave na virada do dia: o dia que acabou de fechar é buscado de novo, completo, em vez de
 * herdar o prazo de 30 min com as mensagens até o último carregamento.
 */
export function periodCacheKey(scope: string, f: Pick<SupervisorFilters, 'range' | 'channel'>, today: string): string {
  return `${scope}|${f.range.from}|${f.range.to}|${f.channel}|${includesToday(f.range, today) ? 'live' : 'past'}`;
}
