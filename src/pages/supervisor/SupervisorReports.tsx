import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CalendarDays, Lightbulb, Printer, Sparkles } from 'lucide-react';
import { EmptyState, ErrorBlock, LoadingBlock, NotActiveTag, Panel } from '../../components/supervisor/SupervisorPrimitives';
import { usePeriodSummary, useSupervisor } from '../../components/supervisor/useSupervisor';
import { addDays, formatInstantBR, longDateBR, storeToday } from '../../lib/finance/dates';
import { int, pct } from '../../lib/finance/format';
import type { SupervisorFilters } from '../../lib/supervisor/filters';
import { formatSeconds, variation, type SupervisorSummary } from '../../lib/supervisor/metrics';

/** Resposta mediana acima disso vira alerta no relatório (regra fixa, sem IA). */
const SLOW_MEDIAN_SECONDS = 30 * 60;

function dayFilters(date: string): SupervisorFilters {
  return { range: { from: date, to: date }, seller: 'all', channel: 'all' };
}

function responseRate(s: SupervisorSummary): number | null {
  const rounds = s.answeredInPeriod + s.awaiting;
  return rounds ? (s.answeredInPeriod / rounds) * 100 : null;
}

export function SupervisorReports() {
  const { sellerName } = useSupervisor();
  const today = storeToday();
  const [date, setDate] = useState(today);
  const current = usePeriodSummary(useMemo(() => dayFilters(date), [date]));
  const previous = usePeriodSummary(useMemo(() => dayFilters(addDays(date, -1)), [date]));

  const cur = current.data?.summary;
  const prev = previous.data?.summary;

  const alerts = useMemo(() => {
    if (!cur) return [];
    const out: string[] = [];
    if (cur.awaiting > 0) out.push(`${int(cur.awaiting)} cliente(s) terminaram o dia sem resposta de uma pessoa.`);
    for (const r of cur.bySeller) {
      if (r.sellerId && r.medianResponseSeconds != null && r.medianResponseSeconds > SLOW_MEDIAN_SECONDS) {
        out.push(`${sellerName(r.sellerId)}: resposta mediana de ${formatSeconds(r.medianResponseSeconds)}.`);
      }
    }
    const t = current.data?.totals;
    if (t?.nao_atendida) out.push(`${int(t.nao_atendida)} conversa(s) sem nenhuma resposta humana.`);
    if (t?.aguardando_distribuicao) out.push(`${int(t.aguardando_distribuicao)} conversa(s) aguardando distribuição para um vendedor.`);
    if (t?.atendente_nao_identificado) out.push(`${int(t.atendente_nao_identificado)} conversa(s) respondidas pelo aparelho, sem atendente identificado.`);
    return out;
  }, [cur, current.data?.totals, sellerName]);

  return (
    <div className="sv-stack sv-report">
      <div className="sv-report-bar">
        <label className="fin-sort sv-filter">
          <CalendarDays size={15} aria-hidden="true" />
          <input type="date" className="sv-date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Dia do relatório" />
        </label>
        <span className="sv-muted">
          {longDateBR(date)}
          {date === today ? ' · dia em andamento (parcial)' : ''}
        </span>
        <button type="button" className="sv-btn sv-push-right sv-no-print" onClick={() => window.print()}>
          <Printer size={15} aria-hidden="true" /> Imprimir
        </button>
      </div>

      <div className="sv-status-card is-info sv-no-print">
        <span className="sv-status-icon" aria-hidden="true">
          <CalendarClock size={18} />
        </span>
        <div>
          <strong>Geração automática diária desativada</strong>
          <p>
            Este relatório é montado na hora com os dados reais do Kommo. Nenhum agendamento foi criado e nenhuma IA é chamada; o envio
            automático e as recomendações da IA dependem da sua autorização.
          </p>
        </div>
      </div>

      {current.error || previous.error ? (
        <ErrorBlock message={current.error ?? previous.error ?? ''} onRetry={() => (current.reload(), previous.reload())} />
      ) : !cur || !prev ? (
        <LoadingBlock />
      ) : (
        <>
          <Panel title="Resumo geral" eyebrow="Comparado com o dia anterior">
            <div className="sv-compare">
              <Compare label="Atendimentos" value={int(cur.conversations)} delta={variation(cur.conversations, prev.conversations)} />
              <Compare label="Resposta média" value={formatSeconds(cur.avgResponseSeconds)} delta={variation(cur.avgResponseSeconds, prev.avgResponseSeconds)} lowerIsBetter />
              <Compare label="Resposta mediana" value={formatSeconds(cur.medianResponseSeconds)} delta={variation(cur.medianResponseSeconds, prev.medianResponseSeconds)} lowerIsBetter />
              <Compare label="Clientes sem resposta" value={int(cur.awaiting)} delta={variation(cur.awaiting, prev.awaiting)} lowerIsBetter />
              <Compare label="Taxa de resposta" value={pct(responseRate(cur))} delta={variation(responseRate(cur), responseRate(prev))} />
              <Compare label="Mensagens de vendedores" value={int(cur.sellerMessages)} delta={variation(cur.sellerMessages, prev.sellerMessages)} />
            </div>
          </Panel>

          <Panel title="Desempenho individual" eyebrow="Vendedores">
            {cur.bySeller.length === 0 ? (
              <EmptyState title="Nenhum atendimento neste dia." />
            ) : (
              <div className="sv-table-wrap">
                <table className="sv-table">
                  <thead>
                    <tr>
                      <th>Quem atendeu</th>
                      <th className="num">Atendimentos</th>
                      <th className="num">Dia anterior</th>
                      <th className="num">Resposta média</th>
                      <th className="num">Mediana</th>
                      <th className="num">Sem resposta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cur.bySeller.map((r) => (
                      <tr key={r.sellerId ?? 'none'}>
                        <td data-label="Quem atendeu">
                          <strong className={r.sellerId ? '' : 'sv-muted'}>{sellerName(r.sellerId)}</strong>
                        </td>
                        <td data-label="Atendimentos" className="num">{int(r.conversations)}</td>
                        <td data-label="Dia anterior" className="num sv-muted">
                          {int(prev.bySeller.find((p) => p.sellerId === r.sellerId)?.conversations ?? 0)}
                        </td>
                        <td data-label="Resposta média" className="num">{formatSeconds(r.avgResponseSeconds)}</td>
                        <td data-label="Mediana" className="num">{formatSeconds(r.medianResponseSeconds)}</td>
                        <td data-label="Sem resposta" className={`num ${r.awaiting ? 'sv-warn' : ''}`}>{int(r.awaiting)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="sv-grid-2">
            <Panel title="Problemas identificados" eyebrow="Regras fixas sobre os dados do dia">
              {alerts.length === 0 ? (
                <p className="sv-muted">Nenhum alerta para este dia.</p>
              ) : (
                <ul className="sv-alerts">
                  {alerts.map((a) => (
                    <li key={a}>
                      <AlertTriangle size={14} aria-hidden="true" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Clientes sem resposta" eyebrow={`${int(cur.awaitingList.length)} no dia`}>
              {cur.awaitingList.length === 0 ? (
                <p className="sv-muted">Todos os clientes do dia tiveram retorno.</p>
              ) : (
                <ul className="sv-list">
                  {cur.awaitingList.slice(0, 15).map(({ conversation: c, since, attendantKey, answered }) => (
                    <li key={c.id}>
                      <Link className="sv-list-item" to={`/supervisor/conversas/${c.id}?periodo=custom&de=${date}&ate=${date}`}>
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
            </Panel>
          </div>

          <div className="sv-grid-2">
            <Panel title="Oportunidades comerciais" eyebrow="Supervisor IA" actions={<NotActiveTag />}>
              <p className="sv-muted sv-inline-icon">
                <Lightbulb size={14} aria-hidden="true" /> Serão identificadas a partir das conversas reais quando a análise for ativada.
              </p>
            </Panel>
            <Panel title="Recomendações da IA" eyebrow="Supervisor IA" actions={<NotActiveTag />}>
              <p className="sv-muted sv-inline-icon">
                <Sparkles size={14} aria-hidden="true" /> Sem recomendações: nenhuma análise de IA foi executada.
              </p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Compare({ label, value, delta, lowerIsBetter = false }: { label: string; value: string; delta: number | null; lowerIsBetter?: boolean }) {
  const good = delta == null || delta === 0 ? null : lowerIsBetter ? delta < 0 : delta > 0;
  return (
    <div className="sv-compare-item">
      <small>{label}</small>
      <strong>{value}</strong>
      <span className={good == null ? 'sv-muted' : good ? 'sv-good' : 'sv-bad'}>
        {delta == null ? 'sem base de comparação' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}% vs. dia anterior`}
      </span>
    </div>
  );
}
