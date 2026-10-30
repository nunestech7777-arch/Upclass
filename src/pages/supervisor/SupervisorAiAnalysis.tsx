import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, FileSearch, Lock, Quote, Sparkles, UserCheck } from 'lucide-react';
import { KpiCard } from '../../components/finance/FinancePrimitives';
import { EmptyState, ErrorBlock, LoadingBlock, NotActiveTag, Panel } from '../../components/supervisor/SupervisorPrimitives';
import { usePeriodSummary, useSupervisor } from '../../components/supervisor/useSupervisor';
import { formatInstantBR } from '../../lib/finance/dates';
import { int, pct } from '../../lib/finance/format';
import { SUPERVISOR_CRITERIA } from '../../lib/supervisor/aiCriteria';
import { fetchAnalyzedConversations, type AnalyzedConversation } from '../../lib/supervisor/supervisorApi';

const PIPELINE = [
  { icon: FileSearch, title: 'Conversa real', text: 'Mensagens do cliente, dos atendentes e do robô gravadas pela integração Kommo.' },
  { icon: UserCheck, title: 'Quem é avaliado', text: 'Cada vendedor que enviou mensagem é avaliado só pelas mensagens dele; o responsável do lead não conta. Robô e envio sem autor não são avaliados.' },
  { icon: Quote, title: 'Avaliação fundamentada', text: 'Cada critério recebe nota com trechos da própria conversa como evidência.' },
  { icon: CheckCircle2, title: 'Resultado salvo', text: 'Nota, resumo, pontos fortes e de melhoria ficam na conversa e alimentam os relatórios.' },
];

export function SupervisorAiAnalysis() {
  const { filters, sellers, sellerName, kommoUserName, search } = useSupervisor();
  const { data, error, loading, reload } = usePeriodSummary(filters);
  const [analyzed, setAnalyzed] = useState<AnalyzedConversation[] | null>(null);
  const [analyzedError, setAnalyzedError] = useState<string | null>(null);
  const sellerId = filters.seller !== 'all' && filters.seller !== 'none' ? filters.seller : null;
  // Avaliação é de quem ENVIOU as mensagens: o vendedor é achado pelo usuário do Kommo dele.
  const kommoUserId = sellerId ? (sellers.find((s) => s.id === sellerId)?.kommo_user_id ?? null) : null;
  const unlinked = !!sellerId && !kommoUserId;
  // "Sem atendente identificado": não há autor humano, logo nenhuma avaliação individual possível.
  const noAttendant = filters.seller === 'none';

  useEffect(() => {
    let alive = true;
    if (unlinked || noAttendant) {
      setAnalyzed([]);
      return;
    }
    setAnalyzed(null);
    setAnalyzedError(null);
    fetchAnalyzedConversations(kommoUserId, 30)
      .then((rows) => alive && setAnalyzed(rows))
      .catch((err: Error) => alive && setAnalyzedError(err.message));
    return () => {
      alive = false;
    };
  }, [kommoUserId, unlinked, noAttendant]);

  const s = data?.summary;
  const qs = search ? `?${search}` : '';

  return (
    <div className="sv-stack">
      <div className="sv-status-card">
        <span className="sv-status-icon" aria-hidden="true">
          <Lock size={18} />
        </span>
        <div>
          <strong>Supervisor IA ainda não ativado</strong>
          <p>
            Nenhuma conversa é enviada para serviços de IA nesta etapa. A estrutura de avaliação está pronta; a ativação e o custo
            das chamadas dependem da sua autorização.
          </p>
        </div>
        <NotActiveTag>Desativado</NotActiveTag>
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !s ? (
        <LoadingBlock />
      ) : (
        <div className={`sv-kpis sv-kpis-3 ${loading ? 'is-reloading' : ''}`}>
          <KpiCard label="Conversas no período" value={int(s.conversations)} icon={<Sparkles size={18} />} tone="goal" />
          <KpiCard label="Analisadas" value={int(s.analyzed)} icon={<CheckCircle2 size={18} />} tone="profit" caption={`${pct(s.conversations ? (s.analyzed / s.conversations) * 100 : null)} do período`} />
          <KpiCard label="Pendentes de análise" value={int(s.pending)} icon={<CircleDashed size={18} />} tone="warn" caption="Prontas para avaliação quando o Supervisor IA for ativado" />
        </div>
      )}

      <Panel title="Critérios de avaliação" eyebrow="O que o Supervisor IA vai avaliar">
        <ul className="sv-criteria">
          {SUPERVISOR_CRITERIA.map((c, i) => (
            <li key={c.key}>
              <span className="sv-criteria-n">{i + 1}</span>
              <div>
                <strong>{c.label}</strong>
                <p>{c.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Como a análise vai funcionar" eyebrow="Fluxo">
        <ol className="sv-pipeline">
          {PIPELINE.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="sv-pipeline-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <p className="sv-footnote">Sem conversa real não há avaliação: o Supervisor IA não gera notas nem exemplos fictícios.</p>
      </Panel>

      <Panel title="Avaliações salvas" eyebrow={sellerId ? sellerName(sellerId) : 'Todos os atendentes'}>
        {analyzedError ? (
          <ErrorBlock message={analyzedError} />
        ) : analyzed == null ? (
          <LoadingBlock label="Buscando avaliações…" />
        ) : analyzed.length === 0 ? (
          <EmptyState
            title={
              noAttendant
                ? 'Conversas sem atendente identificado não têm avaliação individual.'
                : unlinked
                  ? 'Este vendedor não tem usuário do Kommo vinculado.'
                  : 'Nenhuma conversa foi avaliada ainda.'
            }
          >
            {noAttendant
              ? 'Sem autor humano identificado não há quem avaliar com segurança.'
              : unlinked
              ? 'Sem o vínculo não dá para saber quais mensagens são dele, então nenhuma avaliação pode ser atribuída.'
              : 'As análises existentes no banco aparecem aqui assim que houver alguma. Hoje nenhuma conversa tem nota ou resumo salvos.'}
          </EmptyState>
        ) : (
          <ul className="sv-list">
            {analyzed.map((a) => (
              <li key={a.id}>
                <Link className="sv-list-item" to={`/supervisor/conversas/${a.id}${qs}`}>
                  <span className="sv-list-main">
                    <strong>{a.client_name}</strong>
                    <small>
                      {a.attendantIds.length ? a.attendantIds.map((id) => kommoUserName(id)).join(', ') : 'Atendente não identificado'} ·{' '}
                      {formatInstantBR(a.occurred_at)}
                    </small>
                  </span>
                  <span className="sv-score">{a.score != null ? `${a.score.toFixed(1)} / 10` : 'Resumo'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
