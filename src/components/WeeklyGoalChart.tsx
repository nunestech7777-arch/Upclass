import React, { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tooltipStyle, useChartTheme } from '../lib/chartTheme';
import { hasWeeklyEvolution, type WeeklyEvolutionPoint } from '../lib/weeklyEvolution';
import { formatDateBR } from '../lib/finance/dates';
import './WeeklyGoalChart.css';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR')}`;
}

/** Evolução acumulada da semana: realizado (linha cheia) contra o ritmo da meta (tracejada). */
export function WeeklyGoalChart({ points }: { points: WeeklyEvolutionPoint[] }) {
  const chart = useChartTheme();
  const animate = useMemo(() => !prefersReducedMotion(), []);

  if (!hasWeeklyEvolution(points)) {
    return (
      <div className="wgc-empty" role="status">
        A evolução aparecerá após as primeiras vendas da semana.
      </div>
    );
  }

  const today = points.find((p) => p.isToday && p.realized != null);
  const summary = points
    .filter((p) => p.realized != null)
    .map((p) => `${p.label}: ${p.realized} acumuladas, ritmo ${p.expected.toLocaleString('pt-BR')}`)
    .join('; ');

  return (
    <figure className="wgc" aria-label="Evolução acumulada da meta semanal">
      <div className="wgc-legend">
        <span><i className="wgc-key wgc-key-solid" style={{ background: chart.series[0] }} />Realizado</span>
        <span><i className="wgc-key wgc-key-dash" style={{ borderColor: chart.reference }} />Ritmo da meta</span>
      </div>
      <div className="wgc-plot" role="img" aria-label={`Vendas acumuladas na semana. ${summary}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 10, right: 16, left: 16, bottom: 0 }} accessibilityLayer>
            <defs>
              <linearGradient id="wgcFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.series[0]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={chart.series[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={chart.grid} />
            <XAxis dataKey="label" padding={{ left: 8, right: 8 }} axisLine={false} tickLine={false} tick={{ fill: chart.axis, fontSize: 12 }} interval={0} />
            <YAxis hide domain={[0, 'dataMax']} />
            <Tooltip
              contentStyle={tooltipStyle(chart)}
              cursor={{ stroke: chart.reference, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as WeeklyEvolutionPoint | undefined;
                if (!active || !p) return null;
                const diff = p.realized == null ? null : p.realized - p.expected;
                return (
                  <div className="wgc-tip" style={tooltipStyle(chart)}>
                    <strong>{p.label} · {formatDateBR(p.date)}</strong>
                    <span>Realizado: {p.realized == null ? '—' : p.realized.toLocaleString('pt-BR')}</span>
                    <span>Meta esperada: {p.expected.toLocaleString('pt-BR')}</span>
                    {diff != null && <span>Diferença: {signed(diff)}</span>}
                  </div>
                );
              }}
            />
            <Line type="linear" dataKey="expected" stroke={chart.reference} strokeWidth={2} strokeDasharray="6 5" dot={false} activeDot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="realized" stroke={chart.series[0]} strokeWidth={3} fill="url(#wgcFill)" connectNulls={false} dot={{ r: 3, fill: chart.series[0], strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={animate} />
            {today && <ReferenceDot x={today.label} y={today.realized as number} r={7} fill={chart.surface} stroke={chart.series[0]} strokeWidth={3} ifOverflow="visible" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
