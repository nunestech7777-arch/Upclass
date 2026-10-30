import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock3, Link2, MessagesSquare, Star, TrendingUp, UserX } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KpiCard } from '../../components/finance/FinancePrimitives';
import { SellerAvatar } from '../../components/SellerAvatar';
import { EmptyState, ErrorBlock, LoadingBlock, Panel } from '../../components/supervisor/SupervisorPrimitives';
import { usePeriodSummary, useSupervisor } from '../../components/supervisor/useSupervisor';
import { fetchKommoUsers } from '../../lib/api';
import { tooltipStyle, useChartTheme } from '../../lib/chartTheme';
import type { KommoUser } from '../../lib/database.types';
import { dayLabel, formatInstantBR } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import { formatSeconds } from '../../lib/supervisor/metrics';
import { fetchAnalyzedConversations, type AnalyzedConversation } from '../../lib/supervisor/supervisorApi';

export function SupervisorPerformance() {
  const ctx = useSupervisor();
  const { filters } = ctx;
  return filters.seller !== 'all' && filters.seller !== 'none' ? <SellerDetail sellerId={filters.seller} /> : <TeamGrid />;
}

function TeamGrid() {
  const { filters, sellers, sellerName, update } = useSupervisor();
  const { data, error, loading, reload } = usePeriodSummary(filters);
  const photo = useMemo(() => new Map(sellers.map((s) => [s.id, s.photo_url])), [sellers]);

  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (!data) return <LoadingBlock />;
  const rows = data.summary.bySeller;

  return (
    <div className={`sv-stack ${loading ? 'is-reloading' : ''}`}>
      {rows.length === 0 ? (
        <EmptyState title="Nenhum atendimento no período." />
      ) : (
        <div className="sv-seller-grid">
          {rows.map((r) => {
            const isSeller = !!r.sellerId && !r.sellerId.startsWith('kommo:');
            return (
            <button
              type="button"
              key={r.sellerId ?? 'none'}
              className="sv-seller-card"
              disabled={!isSeller}
              onClick={() => isSeller && r.sellerId && update({ vendedor: r.sellerId })}
              title={
                isSeller
                  ? 'Ver desempenho individual'
                  : r.sellerId
                    ? 'Usuário do Kommo que respondeu, mas não está vinculado a um vendedor'
                    : 'Conversas sem resposta de uma pessoa identificada'
              }
            >
              <span className="sv-seller-card-head">
                <SellerAvatar name={sellerName(r.sellerId)} photoUrl={isSeller && r.sellerId ? (photo.get(r.sellerId) ?? null) : null} size="sm" />
                <strong>{sellerName(r.sellerId)}</strong>
              </span>
              <span className="sv-seller-stats">
                <span>
                  <small>Atendimentos</small>
                  <b>{int(r.conversations)}</b>
                </span>
                <span>
                  <small>Resposta média</small>
                  <b>{formatSeconds(r.avgResponseSeconds)}</b>
                </span>
                <span>
                  <small>Mediana</small>
                  <b>{formatSeconds(r.medianResponseSeconds)}</b>
                </span>
                <span>
                  <small>Sem resposta</small>
                  <b className={r.awaiting ? 'sv-warn' : ''}>{int(r.awaiting)}</b>
                </span>
                <span>
                  <small>Analisadas</small>
                  <b>{int(r.analyzed)}</b>
                </span>
                <span>
                  <small>Avaliação</small>
                  <b>{r.avgScore != null ? r.avgScore.toFixed(1) : '—'}</b>
                </span>
              </span>
            </button>
            );
          })}
        </div>
      )}
      <p className="sv-footnote">
        Cada atendente conta as conversas em que ele mesmo respondeu (autor da mensagem no Kommo), não as conversas cujo lead está no nome
        dele. Conversa com dois atendentes conta para os dois. Clique num vendedor para ver o desempenho individual.
      </p>
    </div>
  );
}

function SellerDetail({ sellerId }: { sellerId: string }) {
  const { filters, sellers, sellerName, update, search } = useSupervisor();
  const { data, error, loading, reload } = usePeriodSummary(filters);
  const chart = useChartTheme();
  const seller = sellers.find((s) => s.id === sellerId);
  const [kommoUsers, setKommoUsers] = useState<KommoUser[]>([]);
  const [history, setHistory] = useState<AnalyzedConversation[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    fetchKommoUsers().then(setKommoUsers).catch(() => setKommoUsers([]));
  }, []);
  // Histórico de avaliações por AUTOR das mensagens (usuário do Kommo do vendedor), não pelo dono do lead.
  const sellerKommoId = seller?.kommo_user_id ?? null;
  useEffect(() => {
    let alive = true;
    setHistory(null);
    setHistoryError(null);
    if (!sellerKommoId) {
      setHistory([]);
      return;
    }
    fetchAnalyzedConversations(sellerKommoId, 50)
      .then((rows) => alive && setHistory(rows))
      .catch((err: Error) => {
        if (!alive) return;
        setHistory([]);
        setHistoryError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [sellerKommoId]);

  const kommoUser = kommoUsers.find((u) => u.id === seller?.kommo_user_id);
  const strengths = useMemo(() => tally((history ?? []).flatMap((h) => h.strengths ?? [])), [history]);
  const improvements = useMemo(() => tally((history ?? []).flatMap((h) => h.improvements ?? [])), [history]);
  const qs = search ? `?${search}` : '';

  const s = data?.summary;
  const series = (s?.byDay ?? []).map((d) => ({
    day: dayLabel(d.date),
    conversas: d.conversations,
    resposta: d.avgResponseSeconds != null ? Math.round(d.avgResponseSeconds / 60) : null,
  }));

  return (
    <div className="sv-stack">
      <div className="sv-seller-head">
        <button type="button" className="sv-btn" onClick={() => update({ vendedor: null })}>
          <ArrowLeft size={15} aria-hidden="true" /> Equipe
        </button>
        <SellerAvatar name={sellerName(sellerId)} photoUrl={seller?.photo_url ?? null} size="md" />
        <div>
          <h2 className="sv-panel-title">{sellerName(sellerId)}</h2>
          <span className="sv-muted sv-inline-icon">
            <Link2 size={13} aria-hidden="true" />
            {seller?.kommo_user_id ? `Usuário Kommo: ${kommoUser?.name ?? seller.kommo_user_id}` : 'Sem usuário Kommo vinculado'}
          </span>
        </div>
        <Link className="sv-btn sv-push-right" to={`/supervisor/conversas${qs}`}>
          <MessagesSquare size={15} aria-hidden="true" /> Conversas que ele atendeu
        </Link>
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !s ? (
        <LoadingBlock />
      ) : (
        <>
          <div className={`sv-kpis ${loading ? 'is-reloading' : ''}`}>
            <KpiCard label="Atendimentos" value={int(s.conversations)} icon={<MessagesSquare size={18} />} tone="goal" highlight caption="Conversas em que ele respondeu" />
            <KpiCard label="Tempo médio de resposta" value={formatSeconds(s.avgResponseSeconds)} icon={<Clock3 size={18} />} tone="neutral" caption={s.responses ? `Mediana ${formatSeconds(s.medianResponseSeconds)} · ${int(s.responses)} respostas` : 'Sem respostas no período'} />
            <KpiCard label="Clientes sem resposta" value={int(s.awaiting)} icon={<UserX size={18} />} tone={s.awaiting ? 'deficit' : 'profit'} />
            <KpiCard label="Conversas analisadas" value={int(s.analyzed)} icon={<CheckCircle2 size={18} />} tone="neutral" caption={`${int(s.pending)} pendentes`} />
            <KpiCard label="Avaliação de qualidade" value={s.avgScore != null ? `${s.avgScore.toFixed(1)} / 10` : '—'} icon={<Star size={18} />} tone="neutral" caption={s.avgScore != null ? 'Média das notas salvas' : 'Sem avaliações salvas'} />
            <KpiCard label="Mensagens enviadas" value={int(s.sellerMessages)} icon={<TrendingUp size={18} />} tone="neutral" caption={`${int(s.clientMessages)} recebidas de clientes`} />
          </div>

          <Panel title="Evolução no período" eyebrow="Atendimentos e tempo de resposta">
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
          </Panel>
        </>
      )}

      <div className="sv-grid-2">
        <Panel title="Pontos fortes" eyebrow="Das avaliações salvas">
          {history == null ? <LoadingBlock label="Buscando avaliações…" /> : <TallyList items={strengths} empty={historyError ? `Não foi possível buscar as avaliações: ${historyError}` : 'Nenhuma avaliação salva para este vendedor.'} />}
        </Panel>
        <Panel title="Pontos de melhoria" eyebrow="Das avaliações salvas">
          {history == null ? <LoadingBlock label="Buscando avaliações…" /> : <TallyList items={improvements} empty={historyError ? `Não foi possível buscar as avaliações: ${historyError}` : 'Nenhuma avaliação salva para este vendedor.'} />}
        </Panel>
      </div>

      <Panel title="Histórico de avaliações" eyebrow="Mais recentes">
        {history == null ? (
          <LoadingBlock label="Buscando avaliações…" />
        ) : history.length === 0 ? (
          <EmptyState title="Ainda não há avaliações deste vendedor.">Elas aparecem aqui quando o Supervisor IA for ativado.</EmptyState>
        ) : (
          <ul className="sv-list">
            {history.map((h) => (
              <li key={h.id}>
                <Link className="sv-list-item" to={`/supervisor/conversas/${h.id}${qs}`}>
                  <span className="sv-list-main">
                    <strong>{h.client_name}</strong>
                    <small>{formatInstantBR(h.occurred_at)}</small>
                  </span>
                  <span className="sv-score">{h.score != null ? `${h.score.toFixed(1)} / 10` : 'Resumo'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function tally(items: string[]): { text: string; count: number }[] {
  const map = new Map<string, number>();
  for (const raw of items) {
    const text = raw.trim();
    if (text) map.set(text, (map.get(text) ?? 0) + 1);
  }
  return [...map.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 8);
}

function TallyList({ items, empty }: { items: { text: string; count: number }[]; empty: string }) {
  if (!items.length) return <p className="sv-muted">{empty}</p>;
  return (
    <ul className="sv-tally">
      {items.map((i) => (
        <li key={i.text}>
          <span>{i.text}</span>
          {i.count > 1 && <b>{i.count}×</b>}
        </li>
      ))}
    </ul>
  );
}
