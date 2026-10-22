/**
 * Acesso a dados do módulo financeiro. Usa só `sales`, `sellers`, `products`, metas de lucro e o
 * registro de sincronização — nenhuma consulta a conversas/Kommo, para que uma falha no CRM não
 * impeça abrir os resultados.
 */
import { supabase } from '../supabaseClient';
import { fetchGoals, fetchProducts, fetchSaleOrderDetails, fetchSellers, updateSellerRankingVisibility } from '../api';
import type { SaleOrderDetails } from '../saleDetails';
import { computeIphoneBaseline, type FinanceSale, type FinanceSeller, type IphoneBaseline, type ProfitGoal } from './calc';
import { addDays, firstDay, lastDay, storeToday } from './dates';
import type { UnitTargets } from './dashboard';

export interface FinancialSyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  period_start: string;
  period_end: string;
  mode: 'preview' | 'apply';
  trigger: string;
  status: 'running' | 'ok' | 'error';
  counts: Record<string, unknown> | null;
  next_start: string | null;
  error: string | null;
}

export interface FinancialSyncResponse {
  ok: boolean;
  error?: string;
  mode?: 'preview' | 'apply';
  processed_until?: string | null;
  next_start?: string | null;
  counts?: Record<string, number>;
  issues?: { orderId: string; kind: string; detail: string }[];
}

export interface MonthFinanceData {
  month: string;
  sellers: FinanceSeller[];
  productNames: Map<string, string>;
  sales: FinanceSale[];
  goals: ProfitGoal[];
  iphoneBaseline: IphoneBaseline | null;
  lastSync: FinancialSyncRun | null;
  loadedAt: string;
}

export interface DeviceGoal {
  seller_id: string;
  month: string; // AAAA-MM
  device_target: number | null;
  /** Meta mensal de acessórios (migração 0015); null = sem meta. Independente da meta de aparelhos. */
  accessory_target: number | null;
  /** Metas de faturamento em R$ (migração 0016); null = sem meta. Independentes das metas em unidades. */
  device_revenue_target: number | null;
  accessory_revenue_target: number | null;
  updated_at?: string | null;
  updated_by_email?: string | null;
}

export interface DeviceGoalInput {
  seller_id: string;
  device_target: number | null;
  /** undefined = não enviar a coluna (migração 0015 ausente ou meta de acessórios intocada). */
  accessory_target?: number | null;
  /** undefined = não enviar (migração 0016 ausente). */
  device_revenue_target?: number | null;
  accessory_revenue_target?: number | null;
}

/** Dados da página Forecast de um mês. */
export interface ForecastData {
  month: string;
  sellers: FinanceSeller[];
  productNames: Map<string, string>;
  sales: FinanceSale[];
  deviceGoals: DeviceGoal[];
  /** Falso quando a migração 0014 ainda não foi aplicada (metas individuais indisponíveis). */
  deviceGoalsAvailable: boolean;
  /** Falso quando a migração 0015 ainda não foi aplicada (meta de acessórios por vendedor indisponível). */
  accessoryGoalsAvailable: boolean;
  /** Falso quando a migração 0016 ainda não foi aplicada (metas de faturamento indisponíveis). */
  revenueGoalsAvailable: boolean;
  /** Metas globais em unidades da tela Metas (configuração única, sem mês). */
  globalTargets: { devices: number; accessories: number };
  loadedAt: string;
}

/** Dados do Dashboard: vendas do intervalo buscado (período + janelas de meta), numa única consulta. */
export interface DashboardData {
  range: { from: string; to: string };
  sellers: FinanceSeller[];
  productNames: Map<string, string>;
  sales: FinanceSale[];
  targets: UnitTargets;
  loadedAt: string;
}

/** Disponibilidade de dados reais para conversão (oportunidades do CRM com resultado). */
export interface ConversionStatus {
  conversations: number;
  classified: number;
}

export interface GoalInput {
  seller_id: string;
  profit_target: number | null;
  worst_case_target: number | null;
}

/** Fonte de dados das telas financeiras (injetável para testes e prévias locais). */
export interface FinanceSource {
  loadMonth(month: string): Promise<MonthFinanceData>;
  loadGoals(month: string): Promise<ProfitGoal[]>;
  saveGoals(month: string, rows: GoalInput[]): Promise<void>;
  deleteGoal(month: string, sellerId: string): Promise<void>;
  loadSellers(): Promise<FinanceSeller[]>;
  setSellerVisibility(sellerId: string, show: boolean): Promise<void>;
  loadOrderDetails(externalId: string | null): Promise<SaleOrderDetails | null>;
  loadForecast(month: string): Promise<ForecastData>;
  loadDashboard(from: string, to: string): Promise<DashboardData>;
  loadConversionStatus(): Promise<ConversionStatus | null>;
  loadDeviceGoals(month: string): Promise<DeviceGoal[]>;
  /** A coluna de meta de acessórios existe no banco (migração 0015). */
  accessoryGoalsAvailable(): Promise<boolean>;
  /** As colunas de meta de faturamento existem no banco (migração 0016). */
  revenueGoalsAvailable(): Promise<boolean>;
  saveDeviceGoals(month: string, rows: DeviceGoalInput[]): Promise<void>;
  deleteDeviceGoal(month: string, sellerId: string): Promise<void>;
  runSync(start: string, end: string, mode: 'preview' | 'apply'): Promise<FinancialSyncResponse>;
}

export class MigrationPendingError extends Error {
  constructor() {
    super(
      'As colunas financeiras ainda não existem no banco. Aplique a migração 0013_financial_module.sql e rode a sincronização financeira.'
    );
  }
}

const SALE_COLUMNS =
  'id, seller_id, product_id, quantity, amount, sold_at, sold_date, external_id, mp_order_id, item_status, revenue, cost, profit, profit_reported, financial_status, financial_note, customer_name, product_type';

/** Dias anteriores usados para o lucro médio por iPhone do plano de ação. */
export const IPHONE_BASELINE_DAYS = 90;
const PAGE = 1000;

function raise(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (error.code === '42703' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message)) {
    throw new MigrationPendingError();
  }
  throw new Error(error.message);
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

function toFinanceSale(row: Record<string, unknown>): FinanceSale {
  return {
    id: String(row.id),
    seller_id: String(row.seller_id),
    product_id: String(row.product_id),
    quantity: Number(row.quantity) || 0,
    amount: Number(row.amount) || 0,
    sold_at: String(row.sold_at),
    sold_date: String(row.sold_date ?? String(row.sold_at).slice(0, 10)),
    external_id: (row.external_id as string) ?? null,
    mp_order_id: (row.mp_order_id as string) ?? null,
    item_status: ((row.item_status as FinanceSale['item_status']) ?? 'active'),
    revenue: num(row.revenue),
    cost: num(row.cost),
    profit: num(row.profit),
    profit_reported: num(row.profit_reported),
    financial_status: ((row.financial_status as FinanceSale['financial_status']) ?? 'pending'),
    financial_note: (row.financial_note as string) ?? null,
    customer_name: (row.customer_name as string) ?? null,
    product_type: (row.product_type as string) ?? null,
  };
}

async function salesBetween(from: string, to: string, columns = SALE_COLUMNS): Promise<FinanceSale[]> {
  const rows: FinanceSale[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('sales')
      .select(columns)
      .gte('sold_date', from)
      .lte('sold_date', to)
      .order('sold_at')
      .order('id')
      .range(offset, offset + PAGE - 1);
    raise(error);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page.map(toFinanceSale));
    if (page.length < PAGE) return rows;
  }
}

function toFinanceSeller(s: { id: string; name: string; photo_url: string | null; active: boolean; show_in_ranking: boolean }): FinanceSeller {
  return { id: s.id, name: s.name.trim(), photo_url: s.photo_url, active: s.active, show_in_ranking: s.show_in_ranking };
}

function toGoal(row: Record<string, unknown>): ProfitGoal {
  return {
    seller_id: String(row.seller_id),
    month: String(row.month).slice(0, 7),
    profit_target: num(row.profit_target),
    worst_case_target: num(row.worst_case_target),
    updated_at: (row.updated_at as string) ?? null,
    updated_by_email: (row.updated_by_email as string) ?? null,
  };
}

export const supabaseFinanceSource: FinanceSource = {
  async loadMonth(month) {
    const today = storeToday();
    const baselineFrom = addDays(today, -IPHONE_BASELINE_DAYS);
    const baselineTo = addDays(today, -1);
    const [sellers, products, sales, goals, baselineRows, lastSync] = await Promise.all([
      fetchSellers(),
      fetchProducts(),
      salesBetween(firstDay(month), lastDay(month)),
      supabaseFinanceSource.loadGoals(month),
      salesBetween(baselineFrom, baselineTo, 'id, seller_id, product_id, quantity, amount, sold_at, sold_date, item_status, financial_status, profit'),
      supabase
        .from('financial_sync_runs')
        .select('*')
        .eq('status', 'ok')
        .eq('mode', 'apply')
        .order('finished_at', { ascending: false })
        .limit(1),
    ]);
    const productNames = new Map(products.map((p) => [p.id, p.name]));
    return {
      month,
      sellers: sellers.map(toFinanceSeller),
      productNames,
      sales,
      goals,
      iphoneBaseline: computeIphoneBaseline(baselineRows, productNames, baselineFrom, baselineTo),
      lastSync: ((lastSync.data as unknown as FinancialSyncRun[] | null) ?? [])[0] ?? null,
      loadedAt: new Date().toISOString(),
    };
  },

  async loadGoals(month) {
    const { data, error } = await supabase
      .from('seller_profit_goals')
      .select('*')
      .eq('month', firstDay(month));
    raise(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toGoal);
  },

  async saveGoals(month, rows) {
    if (rows.length === 0) return;
    const { data: auth } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error } = await supabase.from('seller_profit_goals').upsert(
      rows.map((r) => ({
        seller_id: r.seller_id,
        month: firstDay(month),
        profit_target: r.profit_target,
        worst_case_target: r.worst_case_target,
        updated_at: now,
        updated_by: auth.user?.id ?? null,
        updated_by_email: auth.user?.email ?? null,
      })),
      { onConflict: 'seller_id,month' }
    );
    raise(error);
  },

  async deleteGoal(month, sellerId) {
    const { error } = await supabase
      .from('seller_profit_goals')
      .delete()
      .eq('month', firstDay(month))
      .eq('seller_id', sellerId);
    raise(error);
  },

  async loadSellers() {
    return (await fetchSellers()).map(toFinanceSeller);
  },

  setSellerVisibility: updateSellerRankingVisibility,

  loadOrderDetails: fetchSaleOrderDetails,

  async loadForecast(month) {
    const [sellers, products, sales, goals] = await Promise.all([
      fetchSellers(),
      fetchProducts(),
      salesBetween(firstDay(month), lastDay(month)),
      fetchGoals(),
    ]);
    let deviceGoals: DeviceGoal[] = [];
    let deviceGoalsAvailable = true;
    try {
      deviceGoals = await supabaseFinanceSource.loadDeviceGoals(month);
    } catch (err) {
      if (!(err instanceof MigrationPendingError)) throw err;
      deviceGoalsAvailable = false;
    }
    const [accessoryGoalsAvailable, revenueGoalsAvailable] = deviceGoalsAvailable
      ? await Promise.all([supabaseFinanceSource.accessoryGoalsAvailable(), supabaseFinanceSource.revenueGoalsAvailable()])
      : [false, false];
    return {
      month,
      sellers: sellers.map(toFinanceSeller),
      productNames: new Map(products.map((p) => [p.id, p.name])),
      sales,
      deviceGoals,
      deviceGoalsAvailable,
      accessoryGoalsAvailable,
      revenueGoalsAvailable,
      globalTargets: { devices: goals.monthly_devices_target, accessories: goals.monthly_accessories_target },
      loadedAt: new Date().toISOString(),
    };
  },

  async loadDashboard(from, to) {
    const [sellers, products, sales, goals] = await Promise.all([fetchSellers(), fetchProducts(), salesBetween(from, to), fetchGoals()]);
    return {
      range: { from, to },
      sellers: sellers.map(toFinanceSeller),
      productNames: new Map(products.map((p) => [p.id, p.name])),
      sales,
      targets: {
        weekly_devices_target: goals.weekly_devices_target,
        weekly_accessories_target: goals.weekly_accessories_target,
        monthly_devices_target: goals.monthly_devices_target,
        monthly_accessories_target: goals.monthly_accessories_target,
      },
      loadedAt: new Date().toISOString(),
    };
  },

  async loadConversionStatus() {
    // Só contagens (head): barato e isolado — falha do CRM não derruba o Dashboard.
    const [all, classified] = await Promise.all([
      supabase.from('conversations').select('id', { count: 'exact', head: true }),
      supabase.from('conversations').select('id', { count: 'exact', head: true }).not('result_type', 'is', null),
    ]);
    if (all.error || classified.error) return null;
    return { conversations: all.count ?? 0, classified: classified.count ?? 0 };
  },

  async loadDeviceGoals(month) {
    const { data, error } = await supabase.from('seller_device_goals').select('*').eq('month', firstDay(month));
    raise(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      seller_id: String(row.seller_id),
      month: String(row.month).slice(0, 7),
      device_target: num(row.device_target),
      accessory_target: num(row.accessory_target),
      device_revenue_target: num(row.device_revenue_target),
      accessory_revenue_target: num(row.accessory_revenue_target),
      updated_at: (row.updated_at as string) ?? null,
      updated_by_email: (row.updated_by_email as string) ?? null,
    }));
  },

  async saveDeviceGoals(month, rows) {
    if (rows.length === 0) return;
    const { data: auth } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error } = await supabase.from('seller_device_goals').upsert(
      rows.map((r) => ({
        seller_id: r.seller_id,
        month: firstDay(month),
        device_target: r.device_target,
        ...(r.accessory_target !== undefined ? { accessory_target: r.accessory_target } : {}),
        ...(r.device_revenue_target !== undefined ? { device_revenue_target: r.device_revenue_target } : {}),
        ...(r.accessory_revenue_target !== undefined ? { accessory_revenue_target: r.accessory_revenue_target } : {}),
        updated_at: now,
        updated_by: auth.user?.id ?? null,
        updated_by_email: auth.user?.email ?? null,
      })),
      { onConflict: 'seller_id,month' }
    );
    if (error && /accessory_target/.test(error.message)) {
      throw new Error('Aplique a migração 0015_seller_accessory_goals.sql para salvar metas de acessórios.');
    }
    if (error && /revenue_target/.test(error.message)) {
      throw new Error('Aplique a migração 0016_seller_revenue_goals.sql para salvar metas de faturamento.');
    }
    raise(error);
  },

  async accessoryGoalsAvailable() {
    // Sonda leve: a coluna só existe depois da migração 0015.
    const { error } = await supabase.from('seller_device_goals').select('accessory_target').limit(1);
    return !error;
  },

  async revenueGoalsAvailable() {
    // Sonda leve: as colunas só existem depois da migração 0016.
    const { error } = await supabase.from('seller_device_goals').select('device_revenue_target, accessory_revenue_target').limit(1);
    return !error;
  },

  async deleteDeviceGoal(month, sellerId) {
    const { error } = await supabase.from('seller_device_goals').delete().eq('month', firstDay(month)).eq('seller_id', sellerId);
    raise(error);
  },

  async runSync(start, end, mode) {
    const { data, error } = await supabase.functions.invoke('mercadophone-financial-sync', { body: { start, end, mode } });
    if (error) {
      let detail = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) detail = body.error;
      } catch {
        // resposta sem corpo JSON
      }
      return { ok: false, error: detail };
    }
    return data as FinancialSyncResponse;
  },
};
