import React from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, Target, TrendingUp } from 'lucide-react';
import { ProgressBar } from '../finance/FinancePrimitives';
import type { GoalLine, UnitGoalProgress, UnitsSummary } from '../../lib/finance/dashboard';
import { formatDateBR } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import { countDelay } from '../../lib/motion';
import { AnimatedNumber } from '../ui/AnimatedNumber';

const pct1 = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

function Line({ label, line, delay }: { label: string; line: GoalLine; delay: number }) {
  if (line.target == null) {
    return (
      <div className="dv-goal-line">
        <span>{label}</span>
        <strong>
          <AnimatedNumber value={line.sold} format={int} delay={delay} />
        </strong>
        <em className="fin-muted">sem meta</em>
      </div>
    );
  }
  const tone = (line.pct ?? 0) >= 100 ? 'profit' : 'goal';
  return (
    <div className="dv-goal-line">
      <span>{label}</span>
      <strong>
        <AnimatedNumber value={line.sold} format={int} delay={delay} /> <small>/ {int(line.target)}</small>
      </strong>
      <em>
        <AnimatedNumber value={line.pct} format={pct1} delay={delay} /> · {line.remaining === 0 ? 'meta atingida' : `faltam ${int(line.remaining)}`}
      </em>
      <ProgressBar value={line.pct} tone={tone} />
    </div>
  );
}

function windowText(p: UnitGoalProgress, kind: 'semana' | 'mês'): string {
  const base = `${kind === 'semana' ? 'Semana' : 'Mês'} de ${formatDateBR(p.window.from)} a ${formatDateBR(p.window.to)}`;
  return p.fits ? base : `${base} (a que contém o último dia do período; o período filtrado é maior)`;
}

function GoalCard({ title, icon, kind, progress, highlight, delay }: { title: string; icon: React.ReactNode; kind: 'semana' | 'mês'; progress: UnitGoalProgress; highlight?: boolean; delay: number }) {
  return (
    <div className={`fin-kpi dv-goal ${highlight ? 'is-highlight' : ''}`}>
      <div className="fin-kpi-head">
        <span className="fin-kpi-label">{title}</span>
        <span className="fin-kpi-icon tone-goal">{icon}</span>
      </div>
      {progress.hasGoal ? (
        <>
          <Line label="Aparelhos" line={progress.devices} delay={delay} />
          {progress.accessories.target != null && <Line label="Acessórios" line={progress.accessories} delay={delay} />}
        </>
      ) : (
        <>
          <span className="fin-kpi-value tone-neutral">Sem meta configurada</span>
          <Link to="/metas" className="fin-link fin-small">
            Configurar metas
          </Link>
        </>
      )}
      <span className="fin-kpi-caption">{windowText(progress, kind)}. Meta atual cadastrada em Metas (sem histórico por período).</span>
    </div>
  );
}

export function GoalCards({
  week,
  month,
  units,
  onOpenSales,
}: {
  week: UnitGoalProgress;
  month: UnitGoalProgress;
  units: UnitsSummary;
  onOpenSales: () => void;
}) {
  return (
    <div className="dv-goals">
      <GoalCard title="Meta da Semana" icon={<TrendingUp size={18} />} kind="semana" progress={week} delay={countDelay(4)} />
      <GoalCard title="Meta do Mês" icon={<Target size={18} />} kind="mês" progress={month} highlight delay={countDelay(5)} />
      <button type="button" className="fin-kpi dv-sales-card" onClick={onOpenSales} title="Ver todos os produtos vendidos no período">
        <div className="fin-kpi-head">
          <span className="fin-kpi-label">Total de Vendas</span>
          <span className="fin-kpi-icon tone-profit">
            <CircleDollarSign size={18} />
          </span>
        </div>
        <span className="fin-kpi-value tone-profit">
          <AnimatedNumber value={units.orders} format={int} delay={countDelay(6)} />
        </span>
        <span className="fin-kpi-caption">
          vendas únicas (pedidos) · {int(units.devices + units.accessories)} unidades em {int(units.items)} itens
        </span>
        <span className="fin-link fin-small">Ver produtos vendidos →</span>
      </button>
    </div>
  );
}
