import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  Hourglass,
  Lightbulb,
  MessagesSquare,
  Star,
  UserX,
} from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KpiCard } from '../../components/finance/FinancePrimitives';
import { AttendanceStatusPanel } from '../../components/supervisor/AttendanceStatus';
import { KommoProcessedPanel } from '../../components/supervisor/KommoProcessedPanel';
import { ChannelBadge, EmptyState, ErrorBlock, LoadingBlock, Panel } from '../../components/supervisor/SupervisorPrimitives';
import { usePeriodSummary, useSupervisor } from '../../components/supervisor/useSupervisor';
import { tooltipStyle, useChartTheme } from '../../lib/chartTheme';
import { formatInstantBR, dayLabel } from '../../lib/finance/dates';
import { int, pct } from '../../lib/finance/format';
import { CHANNEL_LABEL, type Channel } from '../../lib/supervisor/channels';
import { formatSeconds } from '../../lib/supervisor/metrics';

export function SupervisorOverview() {
  const { filters, sellerName, kommoUserName, search } = useSupervisor();
  const { data, error, loading, reload } = usePeriodSummary(filters);
  const chart = useChartTheme();

  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (!data) return <LoadingBlock />;

  const s = data.summary;
  // Taxa do período: rodadas respondidas dentro dele ÷ (respondidas + clientes que terminaram sem resposta).
  const rounds = s.answeredInPeriod + s.awaiting;
  const responseRate = rounds > 0 ? (s.answeredInPeriod / rounds) * 100 : null;
  const series = s.byDay.map((d) => ({
    day: dayLabel(d.date),
    conversas: d.conversations,
    resposta: d.avgResponseSeconds != null ? Math.round(d.avgResponseSeconds / 60) : null,
  }));
  const qs = search ? `?${search}` : '';

  return (
    <div className={`sv-stack ${loading ? 'is-reloading' : ''}`}>
      {s.conversations === 0 ? (
        <EmptyState title="Nenhum atendimento no período.">Ajuste o período, o vendedor ou o canal para ver as conversas do Kommo.</EmptyState>
      ) : null}

      <div className="sv-kpis">
        <KpiCard label="Atendimentos" value={int(s.conversations)} icon={<MessagesSquare size={18} />} tone="goal" highlight caption={`${int(s.clientMessages)} mensagens de clientes · ${int(s.sellerMessages)} de atendentes`} />
        <KpiCard label="Tempo médio de resposta" value={formatSeconds(s.avgResponseSeconds)} icon={<Clock3 size={18} />} tone="neutral" caption={s.responses ? `Mediana ${formatSeconds(s.medianResponseSeconds)} · ${int(s.responses)} respostas (inclui respostas até 24 h depois)` : 'Sem respostas de vendedor no período'} />
        <KpiCard label="Clientes sem resposta" value={int(s.awaiting)} icon={<UserX size={18} />} tone={s.awaiting > 0 ? 'deficit' : 'profit'} caption="Terminaram o período com a última mensagem do cliente sem resposta de uma pessoa" />
        <KpiCard label="Taxa de resposta" value={pct(responseRate)} icon={<Gauge size={18} />} tone="profit" caption={rounds ? `${int(s.answeredInPeriod)} de ${int(rounds)} rodadas do cliente respondidas no período` : 'Sem mensagens de clientes no período'} />
        <KpiCard label="Conversas analisadas" value={int(s.analyzed)} icon={<CheckCircle2 size={18} />} tone="neutral" caption="Com avaliação salva do Supervisor IA" />
        <KpiCard label="Pendentes de análise" value={int(s.pending)} icon={<Hourglass size={18} />} tone="warn" caption="Ainda sem avaliação" />
        <KpiCard label="Qualidade média" value={s.avgScore != null ? `${s.avgScore.toFixed(1)} / 10` : '—'} icon={<Star size={18} />} tone="neutral" caption={s.avgScore != null ? 'Média das notas salvas' : 'Nenhuma conversa avaliada ainda'} />
        <KpiCard label="Oportunidades identificadas" value="—" icon={<Lightbulb size={18} />} tone="neutral" caption="Serão apontadas pelo Supervisor IA, quando ativado" />
      </div>

      <Panel title="Quem realmente atendeu" eyebrow={`Status de ${int(data.totals.total)} conversas`}>
        <AttendanceStatusPanel
          totals={data.totals}
          responsibles={data.responsibles}
          linkTo={(f) => {
            const p = new URLSearchParams(search);
            p.set('status', f);
            return `/supervisor/conversas?${p.toString()}`;
          }}
        />
        <p className="sv-footnote">
          Atendente = usuário do Kommo que enviou a resposta, não o responsável do lead. Cada conversa tem um só status; clique num
          cartão para ver as conversas e o motivo da classificação.
        </p>
      </Panel>

      {filters.seller === 'all' ? (
        <Panel title="Conversas processadas — critério Kommo" eyebrow="Para comparar com o painel do Kommo">
          <KommoProcessedPanel data={data.kommoProcessed} uniqueConversations={s.conversations} kommoUserName={kommoUserName} />
        </Panel>
      ) : (
        <p className="sv-footnote">"Conversas processadas — critério Kommo" é da equipe toda: escolha "Todos os atendentes" para ver.</p>
      )}

      <div className="sv-grid-2">
        <Panel title="Atendimentos e tempo de resposta por dia" eyebrow="Evolução">
          {series.length ? (
            <div className="sv-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: chart.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis yAxisId="l" axisLine={false} tickLine={false} tick={{ fill: chart.axis, fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="r" orientation="right" axisLine={false} tickLine={false} tick={{ fill: chart.axis, fontSize: 11 }} unit=" min" width={56} />
                  <Tooltip contentStyle={tooltipStyle(chart)} formatter={(v, name) => (name === 'Resposta média' ? [`${v} min`, name] : [v, name])} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="conversas" name="Atendimentos" fill={chart.series[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line yAxisId="r" dataKey="resposta" name="Resposta média" stroke={chart.series[2]} strokeWidth={2.5} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Sem dados no período." />
          )}
        </Panel>

        <Panel title="Atendimentos por canal" eyebrow="Canais">
          <ul className="sv-bars">
            {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => {
              const n = s.byChannel[c];
              const share = s.conversations ? (n / s.conversations) * 100 : 0;
              return (
                <li key={c}>
                  <div className="sv-bars-row">
                    <span>{CHANNEL_LABEL[c]}</span>
                    <strong>
                      {int(n)} <small>{pct(share)}</small>
                    </strong>
                  </div>
                  <span className="fin-progress" aria-hidden="true">
                    <span className={`fin-progress-fill sv-fill-${c}`} style={{ width: `${share}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="sv-footnote">
            <Bot size={13} aria-hidden="true" /> {int(s.botMessages)} mensagens automáticas do bot no período (não contam como resposta).
          </p>
        </Panel>
      </div>

      <Panel
        title="Desempenho da equipe"
        eyebrow="Vendedores"
        actions={
          <Link className="fin-link" to={`/supervisor/vendedores${qs}`}>
            Ver desempenho detalhado
          </Link>
        }
      >
        {s.bySeller.length === 0 ? (
          <EmptyState title="Nenhum atendente no período." />
        ) : (
          <div className="sv-table-wrap">
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Quem atendeu</th>
                  <th className="num">Atendimentos</th>
                  <th className="num">Resposta média</th>
                  <th className="num">Mediana</th>
                  <th className="num">Sem resposta</th>
                  <th className="num">Analisadas</th>
                </tr>
              </thead>
              <tbody>
                {s.bySeller.map((r) => (
                  <tr key={r.sellerId ?? 'none'}>
                    <td data-label="Quem atendeu">
                      <strong className={r.sellerId ? '' : 'sv-muted'}>{sellerName(r.sellerId)}</strong>
                    </td>
                    <td data-label="Atendimentos" className="num">{int(r.conversations)}</td>
                    <td data-label="Resposta média" className="num">{formatSeconds(r.avgResponseSeconds)}</td>
                    <td data-label="Mediana" className="num">{formatSeconds(r.medianResponseSeconds)}</td>
                    <td data-label="Sem resposta" className={`num ${r.awaiting ? 'sv-warn' : ''}`}>{int(r.awaiting)}</td>
                    <td data-label="Analisadas" className="num">{int(r.analyzed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Clientes aguardando resposta" eyebrow={`${int(s.awaitingList.length)} no período`}>
        {s.awaitingList.length === 0 ? (
          <EmptyState title="Nenhum cliente aguardando resposta.">Todas as mensagens de clientes do período tiveram resposta de uma pessoa.</EmptyState>
        ) : (
          <ul className="sv-list">
            {s.awaitingList.slice(0, 12).map(({ conversation: c, since, attendantKey, answered }) => (
              <li key={c.id}>
                <Link to={`/supervisor/conversas/${c.id}${qs}`} className="sv-list-item">
                  <ChannelBadge origin={c.origin} compact />
                  <span className="sv-list-main">
                    <strong>{c.client_name}</strong>
                    <small>{attendantKey ? `Último atendente: ${sellerName(attendantKey)}` : answered ? 'Respondido pelo aparelho, sem atendente identificado' : 'Ninguém respondeu ainda'}</small>
                  </span>
                  <span className="sv-list-meta">desde {formatInstantBR(since)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {s.awaitingList.length > 12 && (
          <p className="sv-footnote">Mostrando os 12 que esperam há mais tempo. Use a seção Conversas para ver todos.</p>
        )}
      </Panel>

      <p className="sv-footnote">
        Indicadores calculados com as conversas e os horários reais das mensagens do Kommo no período. O tempo de resposta vai da
        primeira mensagem do cliente até a resposta de uma pessoa (no Kommo ou pelo aparelho) e inclui horários fora do expediente; ele fica
        com quem respondeu, não com o responsável do lead.
      </p>
    </div>
  );
}
