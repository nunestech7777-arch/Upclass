import React, { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { SeriesMode, SeriesPoint } from '../../lib/finance/dashboard';
import { int } from '../../lib/finance/format';
import { SectionEyebrow } from '../finance/FinancePrimitives';
import { useFinanceColors } from '../finance/useFinance';

interface Props {
  points: SeriesPoint[];
  granularity: 'hour' | 'day' | 'month';
  mode: SeriesMode;
  onModeChange: (m: SeriesMode) => void;
  /** Totais do período (os mesmos dos cards). */
  totals: { devices: number; accessories: number };
  subtitle: string;
}

type SeriesKey = 'devices' | 'accessories';

const unitWord = (n: number) => (n === 1 ? 'unidade' : 'unidades');

/**
 * Evolução de vendas com duas linhas independentes (aparelhos e acessórios), no estilo do gráfico
 * Meta × Projeção × Realizado: curva monotônica, grade discreta, legenda interativa e tooltip em
 * português. Intervalos futuros ficam nulos (a linha para no último dado real).
 */
export function SalesEvolutionChart({ points, granularity, mode, onModeChange, totals, subtitle }: Props) {
  const c = useFinanceColors();
  const [hidden, setHidden] = useState<Record<SeriesKey, boolean>>({ devices: false, accessories: false });

  const series: { key: SeriesKey; name: string; color: string; total: number }[] = [
    { key: 'devices', name: 'Aparelhos', color: c.goal, total: totals.devices },
    { key: 'accessories', name: 'Acessórios', color: c.profit, total: totals.accessories },
  ];

  const data = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        devicesValue: mode === 'cumulative' ? p.devicesCum : p.devices,
        accessoriesValue: mode === 'cumulative' ? p.accessoriesCum : p.accessories,
      })),
    [points, mode]
  );
  const hasAny = points.some((p) => (p.devices ?? 0) > 0 || (p.accessories ?? 0) > 0);

  return (
    <section className="fin-panel dv-chart" aria-label="Evolução de vendas">
      <div className="dv-chart-head">
        <div>
          <SectionEyebrow>Aparelhos e acessórios</SectionEyebrow>
          <h2 className="fin-panel-title is-large">
            <TrendingUp size={20} className="tone-profit" />
            Evolução de Vendas
          </h2>
          <p className="fin-lead">Acompanhe a evolução de aparelhos e acessórios vendidos.</p>
          <span className="fin-muted fin-small">{subtitle}</span>
        </div>
        <div className="dv-segmented" role="group" aria-label="Modo de visualização">
          <button type="button" className={mode === 'cumulative' ? 'is-active' : ''} aria-pressed={mode === 'cumulative'} onClick={() => onModeChange('cumulative')}>
            Acumulado
          </button>
          <button type="button" className={mode === 'period' ? 'is-active' : ''} aria-pressed={mode === 'period'} onClick={() => onModeChange('period')}>
            Por período
          </button>
        </div>
      </div>

      <div className="fin-legend dv-legend">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`dv-legend-btn ${hidden[s.key] ? 'is-off' : ''}`}
            aria-pressed={!hidden[s.key]}
            onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))}
            title={hidden[s.key] ? 'Mostrar linha' : 'Ocultar linha'}
          >
            <i style={{ background: s.color }} />
            {s.name} — {int(s.total)} {unitWord(s.total)}
          </button>
        ))}
      </div>

      <div className="dv-chart-area">
        {!hasAny && <p className="dv-chart-empty fin-muted">Nenhuma venda de aparelhos ou acessórios no período.</p>}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: c.muted, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis allowDecimals={false} tick={{ fill: c.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
            <Tooltip
              cursor={{ stroke: c.muted, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as SeriesPoint & { devicesValue: number | null; accessoriesValue: number | null };
                if (p.devicesValue == null) return null;
                const rows = series.filter((s) => !hidden[s.key]);
                return (
                  <div className="fin-tooltip">
                    <strong>{p.title}</strong>
                    {rows.map((s) => {
                      const v = (s.key === 'devices' ? p.devicesValue : p.accessoriesValue) ?? 0;
                      return (
                        <span key={s.key}>
                          <i style={{ background: s.color }} />
                          {mode === 'cumulative' ? `${s.name}: ` : `${s.name} vendidos: `}
                          <b>{mode === 'cumulative' ? `${int(v)} ${unitWord(v)}.` : `${int(v)}.`}</b>
                        </span>
                      );
                    })}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={`${s.key}Value`}
                name={s.name}
                stroke={s.color}
                strokeWidth={3}
                dot={granularity === 'hour' || data.length <= 12 ? { r: 3 } : false}
                activeDot={{ r: 5 }}
                hide={hidden[s.key]}
                connectNulls={false}
                isAnimationActive
                animationDuration={500}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
