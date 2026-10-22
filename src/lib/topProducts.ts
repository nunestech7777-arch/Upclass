/** Top N de produtos por QUANTIDADE vendida (nunca por faturamento, custo ou lucro). */
export interface RankedProduct {
  name: string;
  qty: number;
}

/** Ordem decrescente por unidades; empate por nome (determinístico). Só posições que existem. */
export function topByQuantity(rows: Iterable<RankedProduct>, limit = 5): RankedProduct[] {
  return [...rows]
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
    .slice(0, limit)
    .map(({ name, qty }) => ({ name, qty }));
}
