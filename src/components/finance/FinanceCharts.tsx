import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp, Users, BarChart3 } from 'lucide-react';
import type { Aggregate, DayFinance, MonthFinance, SellerFinance } from '../../lib/finance/calc';
import { brl, brlAxis, pct } from '../../lib/finance/format';
import { dayLabel, formatDateBR } from '../../lib/finance/dates';
import { useFinanceColors, type FinanceColors } from './useFinance';
import { SectionEyebrow } from './FinancePrimitives';

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="fin-tooltip">
      <strong>{title}</strong>
      {rows.map((r) => (
        <span key={r.label}>
          <i style={{ background: r.color }} />
          {r.label}: <b>{r.value}</b>
        </span>
      ))}
    </div>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: React.ReactNode; dashed?: boolean }) {
  return (
    <span className="fin-legend-item">
      <i className={dashed ? 'is-dashed' : ''} style={dashed ? { borderColor: color } : { background: color }} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Comparativo por vendedor (anexo 04)
// ---------------------------------------------------------------------------

export function SellerComparisonChart({ sellers }: { sellers: SellerFinance[] }) {
  const c = useFinanceColors();
  const data = sellers
    .filter((s) => s.target != null || s.worst != null || s.profit !== 0)
    .map((s) => ({ name: s.seller.name, meta: s.target, pior: s.worst, realizado: s.profit }));
  const height = Math.max(240, data.length * 46 + 40);

  return (
    <section className="fin-panel fin-chart-panel" aria-label="Comparativo por vendedor">
      <SectionEyebrow>Meta, pior cenário e realizado</SectionEyebrow>
      <h3 className="fin-panel-title">
        <Users size={18} className="tone-profit" />
        Comparativo por vendedor
      </h3>
      <div className="fin-legend">
        <LegendItem color={c.goal} label="Meta" />
        <LegendItem color={c.worst} label="Pior cenário" />
        <LegendItem color={c.profit} label="Realizado" />
      </div>
      {data.length === 0 ? (
        <p className="fin-muted fin-chart-empty">Sem vendedores com meta ou resultado no período.</p>
      ) : (
        <div style={{ width: '100%', height }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid horizontal={false} stroke={c.grid} />
              <XAxis type="number" tickFormatter={brlAxis} tick={{ fill: c.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={118}
                tick={{ fill: c.text, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
              />
              <Tooltip
                cursor={{ fill: c.grid }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <TooltipBox
                      title={String(label)}
                      rows={[
                        { label: 'Meta', value: brl(payload[0].payload.meta, 'Sem meta'), color: c.goal },
                        { label: 'Pior cenário', value: brl(payload[0].payload.pior, 'Sem meta'), color: c.worst },
                        { label: 'Realizado', value: brl(payload[0].payload.realizado), color: c.profit },
                      ]}
                    />
                  ) : null
                }
              />
              <ReferenceLine x={0} stroke={c.muted} />
              <Bar dataKey="meta" fill={c.goal} radius={[0, 4, 4, 0]} barSize={8} />
              <Bar dataKey="pior" fill={c.worst} radius={[0, 4, 4, 0]} barSize={8} />
              <Bar dataKey="realizado" fill={c.profit} radius={[0, 4, 4, 0]} barSize={8}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.realizado < 0 ? c.deficit : c.profit} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Meta × Projeção × Realizado (anexo 05)
// ---------------------------------------------------------------------------

export function MonthEvolutionChart({ finance }: { finance: MonthFinance }) {
  const c = useFinanceColors();
  const { evolution, totals, plan, context } = finance;
  const projection = context.phase === 'past' ? null : plan.projection;
  const projPct = projection != null && plan.goal ? (projection / plan.goal) * 100 : null;
  const hasGoal = plan.goal != null;

  return (
    <section className="fin-panel fin-chart-panel" aria-label="Meta, projeção e realizado">
      <SectionEyebrow>Evolução do mês</SectionEyebrow>
      <h3 className="fin-panel-title">
        <TrendingUp size={18} className="tone-profit" />
        Meta × Projeção × Realizado
      </h3>
      <div className="fin-legend">
        <LegendItem color={c.profit} label={`Realizado ${brl(totals.profit)}`} />
        <LegendItem color={c.goal} dashed label={hasGoal ? `Meta ${brl(plan.goal)}` : 'Meta: sem metas cadastradas'} />
        <LegendItem
          color={c.worst}
          dashed
          label={
            projection != null
              ? `Projeção ${brl(projection)}${projPct != null ? ` (${pct(projPct)})` : ''}`
              : context.phase === 'past'
                ? 'Projeção: mês encerrado'
                : 'Projeção: indisponível sem dia completo'
          }
        />
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart data={evolution} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="day"
              tickFormatter={(d: number) => String(d).padStart(2, '0')}
              tick={{ fill: c.muted, fontSize: 11 }}
              interval={1}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tickFormatter={brlAxis} tick={{ fill: c.muted, fontSize: 11 }} width={56} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as MonthFinance['evolution'][number];
                const rows = [
                  p.realized != null && { label: 'Realizado', value: brl(p.realized), color: c.profit },
                  p.goal != null && { label: 'Meta', value: brl(p.goal), color: c.goal },
                  p.projection != null && { label: 'Projeção', value: brl(p.projection), color: c.worst },
                ].filter(Boolean) as { label: string; value: string; color: string }[];
                return <TooltipBox title={`Dia ${String(p.day).padStart(2, '0')} · ${formatDateBR(p.date)}`} rows={rows} />;
              }}
            />
            <Line type="monotone" dataKey="goal" stroke={c.goal} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />
            <Line type="linear" dataKey="projection" stroke={c.worst} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
            <Line type="monotone" dataKey="realized" stroke={c.profit} strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lucro por dia (anexo 08)
// ---------------------------------------------------------------------------

function dayColor(d: DayFinance, c: FinanceColors): string {
  if (d.profit < 0) return c.deficit;
  if (d.status === 'hit') return c.profit;
  if (d.status === 'below') return c.worst;
  if (d.status === 'today') return c.goal;
  if (d.status === 'partial') return c.warn;
  return c.profit;
}

export function DailyProfitChart({
  days,
  dailyGoal,
  selected,
  onSelect,
}: {
  days: DayFinance[];
  dailyGoal: number | null;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const c = useFinanceColors();
  const data = days.map((d) => ({ ...d, value: d.isFuture ? null : d.profit }));
  return (
    <section className="fin-panel fin-chart-panel" aria-label="Lucro por dia">
      <h3 className="fin-panel-title">
        <BarChart3 size={18} className="tone-profit" />
        Lucro por dia
      </h3>
      <div className="fin-legend">
        <LegendItem color={c.profit} label="Bateu a meta do dia" />
        <LegendItem color={c.worst} label="Abaixo da meta" />
        <LegendItem color={c.goal} label="Hoje (em andamento)" />
        <LegendItem color={c.goal} dashed label={dailyGoal != null ? `Meta diária ${brl(dailyGoal)}` : 'Meta diária: sem metas'} />
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis
              dataKey="day"
              tickFormatter={(d: number) => String(d).padStart(2, '0')}
              tick={{ fill: c.muted, fontSize: 11 }}
              interval={1}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tickFormatter={brlAxis} tick={{ fill: c.muted, fontSize: 11 }} width={56} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: c.grid }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as DayFinance;
                if (d.isFuture) return <TooltipBox title={dayLabel(d.date)} rows={[{ label: 'Dia futuro', value: '—', color: c.future }]} />;
                return (
                  <TooltipBox
                    title={`${dayLabel(d.date)} · ${formatDateBR(d.date)}`}
                    rows={[
                      { label: 'Lucro do dia', value: brl(d.profit), color: dayColor(d, c) },
                      ...(d.dailyGoal != null ? [{ label: 'Meta do dia', value: `${brl(d.dailyGoal)} (${pct(d.pctDailyGoal)})`, color: c.goal }] : []),
                    ]}
                  />
                );
              }}
            />
            <ReferenceLine y={0} stroke={c.muted} />
            {dailyGoal != null && <ReferenceLine y={dailyGoal} stroke={c.goal} strokeDasharray="6 4" />}
            <Bar
              dataKey="value"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(entry) => {
                const d = (entry as { payload?: DayFinance }).payload;
                if (d && !d.isFuture) onSelect(d.date);
              }}
            >
              {data.map((d) => (
                <Cell
                  key={d.date}
                  fill={dayColor(d, c)}
                  fillOpacity={selected && selected !== d.date ? 0.45 : d.isToday ? 0.7 : 1}
                  stroke={selected === d.date ? c.text : undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lucro por categoria (anexo 11)
// ---------------------------------------------------------------------------

export function CategoryProfitChart({ byCategory }: { byCategory: Aggregate['byCategory'] }) {
  const c = useFinanceColors();
  const palette: Record<string, string> = { Aparelhos: c.profit, Acessórios: c.goal, Brindes: c.worst };
  const data = (Object.keys(byCategory) as (keyof Aggregate['byCategory'])[])
    .map((k) => ({ name: k, value: byCategory[k].profit, units: byCategory[k].units }))
    .filter((d) => d.units > 0 || d.value !== 0);
  if (data.length === 0) return <p className="fin-muted">Sem itens conciliados no período.</p>;
  const hasNegative = data.some((d) => d.value < 0);
  const tooltip = (
    <Tooltip
      content={({ active, payload }) =>
        active && payload?.length ? (
          <TooltipBox
            title={String(payload[0].payload.name)}
            rows={[{ label: 'Lucro', value: brl(payload[0].payload.value), color: palette[payload[0].payload.name] }]}
          />
        ) : null
      }
    />
  );

  return (
    <div className="fin-category-chart">
      {hasNegative ? (
        // Rosca não representa valores negativos (ex.: brindes): barras com eixo em zero.
        <div style={{ width: '100%', height: data.length * 44 + 30 }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke={c.grid} />
              <XAxis type="number" tickFormatter={brlAxis} tick={{ fill: c.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={84} tick={{ fill: c.text, fontSize: 12 }} axisLine={false} tickLine={false} />
              {tooltip}
              <ReferenceLine x={0} stroke={c.muted} />
              <Bar dataKey="value" radius={4} barSize={14}>
                {data.map((d) => (
                  <Cell key={d.name} fill={d.value < 0 ? c.deficit : palette[d.name]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ width: '100%', height: 190 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
                {data.map((d) => (
                  <Cell key={d.name} fill={palette[d.name]} />
                ))}
              </Pie>
              {tooltip}
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="fin-legend is-center">
        {data.map((d) => (
          <LegendItem key={d.name} color={d.value < 0 ? c.deficit : palette[d.name]} label={`${d.name} ${brl(d.value)}`} />
        ))}
      </div>
    </div>
  );
}
