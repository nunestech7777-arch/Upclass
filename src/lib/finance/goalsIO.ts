/**
 * Exportação/importação JSON das metas de lucro e cópia do mês anterior. Puro: valida e planeja,
 * quem chama decide gravar depois de mostrar a prévia.
 */
import type { FinanceSeller, ProfitGoal } from './calc.ts';

export const GOALS_FILE_FORMAT = 'vocedeiphone.metas-lucro.v1';

export interface GoalsFile {
  format: typeof GOALS_FILE_FORMAT;
  month: string;
  exported_at: string;
  goals: { seller_id: string; seller_name: string; profit_target: number | null; worst_case_target: number | null }[];
}

export interface GoalDraft {
  seller_id: string;
  seller_name: string;
  profit_target: number | null;
  worst_case_target: number | null;
  /** Meta já cadastrada no mês de destino (para mostrar o que seria sobrescrito). */
  existing: ProfitGoal | null;
  action: 'create' | 'update' | 'unchanged';
}

export interface GoalsPreview {
  drafts: GoalDraft[];
  errors: string[];
  warnings: string[];
}

export function buildGoalsFile(month: string, goals: ProfitGoal[], sellers: FinanceSeller[], now = new Date()): GoalsFile {
  const names = new Map(sellers.map((s) => [s.id, s.name]));
  return {
    format: GOALS_FILE_FORMAT,
    month,
    exported_at: now.toISOString(),
    goals: goals
      .map((g) => ({
        seller_id: g.seller_id,
        seller_name: names.get(g.seller_id) ?? '',
        profit_target: g.profit_target,
        worst_case_target: g.worst_case_target,
      }))
      .sort((a, b) => a.seller_name.localeCompare(b.seller_name)),
  };
}

function parseMoney(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  return Math.round(n * 100) / 100;
}

/** Valor digitado: "100000", "100000.50" ou "100.000,50". Vazio = null; inválido = NaN. */
export function parseMoneyInput(v: string): number | null {
  const raw = v.trim().replace(/^R\$\s*/, '');
  const t = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** Validação de um par meta/pior cenário (mesmas regras do banco). */
export function validateGoalValues(profit: number | null, worst: number | null): string | null {
  if (Number.isNaN(profit) || Number.isNaN(worst)) return 'Valor inválido';
  if (profit != null && profit < 0) return 'A meta não pode ser negativa';
  if (worst != null && worst < 0) return 'O pior cenário não pode ser negativo';
  if (profit != null && worst != null && worst > profit) return 'O pior cenário não pode ser maior que a meta';
  return null;
}

function planDraft(
  seller: FinanceSeller,
  profit: number | null,
  worst: number | null,
  existing: ProfitGoal | undefined
): GoalDraft {
  const same = existing && existing.profit_target === profit && existing.worst_case_target === worst;
  return {
    seller_id: seller.id,
    seller_name: seller.name,
    profit_target: profit,
    worst_case_target: worst,
    existing: existing ?? null,
    action: !existing ? 'create' : same ? 'unchanged' : 'update',
  };
}

/** Prévia da importação de um arquivo JSON para o mês de destino. */
export function previewGoalsImport(
  raw: unknown,
  targetMonth: string,
  sellers: FinanceSeller[],
  existing: ProfitGoal[]
): GoalsPreview {
  const errors: string[] = [];
  const warnings: string[] = [];
  const drafts: GoalDraft[] = [];
  const file = raw as Partial<GoalsFile> | null;
  if (!file || typeof file !== 'object' || file.format !== GOALS_FILE_FORMAT || !Array.isArray(file.goals)) {
    return { drafts, errors: ['Arquivo inválido: use um JSON exportado pela tela de metas de lucro.'], warnings };
  }
  if (file.month && file.month !== targetMonth) {
    warnings.push(`O arquivo é de ${file.month}; as metas serão importadas para ${targetMonth}.`);
  }
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  const existingBySeller = new Map(existing.map((g) => [g.seller_id, g]));
  const seen = new Set<string>();
  file.goals.forEach((row, index) => {
    const label = `Linha ${index + 1}${row?.seller_name ? ` (${row.seller_name})` : ''}`;
    const seller = row && typeof row.seller_id === 'string' ? sellerById.get(row.seller_id) : undefined;
    if (!seller) {
      errors.push(`${label}: vendedor não encontrado no cadastro.`);
      return;
    }
    if (seen.has(seller.id)) {
      errors.push(`${label}: vendedor repetido no arquivo.`);
      return;
    }
    seen.add(seller.id);
    const profit = parseMoney(row.profit_target);
    const worst = parseMoney(row.worst_case_target);
    if (profit === 'invalid' || worst === 'invalid') {
      errors.push(`${label}: valores devem ser números não negativos.`);
      return;
    }
    const invalid = validateGoalValues(profit, worst);
    if (invalid) {
      errors.push(`${label}: ${invalid}.`);
      return;
    }
    if (row.seller_name && row.seller_name.trim() !== seller.name.trim()) {
      warnings.push(`${label}: nome no arquivo difere do cadastro atual (${seller.name}).`);
    }
    drafts.push(planDraft(seller, profit, worst, existingBySeller.get(seller.id)));
  });
  return { drafts, errors, warnings };
}

/** Prévia da cópia das metas do mês anterior para o mês de destino. */
export function previewGoalsCopy(
  previous: ProfitGoal[],
  sellers: FinanceSeller[],
  existing: ProfitGoal[]
): GoalsPreview {
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  const existingBySeller = new Map(existing.map((g) => [g.seller_id, g]));
  const warnings: string[] = [];
  const drafts: GoalDraft[] = [];
  for (const g of previous) {
    const seller = sellerById.get(g.seller_id);
    if (!seller) continue;
    if (!seller.active) warnings.push(`${seller.name} está inativo no MercadoPhone.`);
    drafts.push(planDraft(seller, g.profit_target, g.worst_case_target, existingBySeller.get(g.seller_id)));
  }
  if (drafts.length === 0) warnings.push('O mês anterior não tem metas de lucro cadastradas.');
  return { drafts: drafts.sort((a, b) => a.seller_name.localeCompare(b.seller_name)), errors: [], warnings };
}
