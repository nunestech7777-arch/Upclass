import React from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, Target, TrendingUp } from 'lucide-react';
import { ProgressBar } from '../finance/FinancePrimitives';
import type { GoalLine, UnitGoalProgress, UnitsSummary } from '../../lib/finance/dashboard';
import { formatDateBR } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import { countDelay } from '../../lib/motion';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { useCardLink } from '../ui/useCardLink';
import { cardLinks } from '../../lib/cardLinks';

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

// Janela da meta só aparece quando difere do período filtrado.
function windowText(p: UnitGoalProgress): string | null {
  return p.fits ? null : `${formatDateBR(p.window.from)} a ${formatDateBR(p.window.to)}`;
}

function GoalCard({ title, icon, progress, highlight, delay, to }: { title: string; icon: React.ReactNode; progress: UnitGoalProgress; highlight?: boolean; delay: number; to: string }) {
  const link = useCardLink(to);
  return (
    <div className={`fin-kpi dv-goal ${highlight ? 'is-highlight' : ''}`} {...link}>
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
      {windowText(progress) && <span className="fin-kpi-caption">{windowText(progress)}</span>}
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
  const salesLink = useCardLink(cardLinks.sales());
  return (
    <div className="dv-goals">
      <GoalCard title="Meta da Semana" icon={<TrendingUp size={18} />} progress={week} delay={countDelay(4)} to={cardLinks.goals('meta-semanal')} />
      <GoalCard title="Meta do Mês" icon={<Target size={18} />} progress={month} highlight delay={countDelay(5)} to={cardLinks.goals('meta-mensal')} />
      <div className="fin-kpi dv-sales-card" {...salesLink}>
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
          {int(units.devices + units.accessories)} unidades
        </span>
        <button type="button" className="fin-link fin-small dv-card-action" onClick={onOpenSales}>
          Ver produtos vendidos →
        </button>
      </div>
    </div>
  );
}
