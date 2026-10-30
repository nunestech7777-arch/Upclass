import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, ExternalLink, Sparkles } from 'lucide-react';
import { fetchConversationMessages, type TimelineMessage } from '../../lib/api';
import { buildTranscript } from '../../lib/transcript';
import { kommoLeadUrl } from '../../lib/supervisor/channels';
import { formatInstantBR } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import { fetchConversationDetail, type ConversationDetail } from '../../lib/supervisor/supervisorApi';
import type { ConversationAttendance } from '../../lib/supervisor/attendance';
import { AttendanceDetails } from './AttendanceStatus';
import { ChannelBadge, EmptyState, ErrorBlock, LoadingBlock } from './SupervisorPrimitives';

interface Props {
  conversationId: string;
  backTo: string;
  /** Status calculado com as mensagens do período escolhido (ausente = conversa fora do período). */
  attendance?: ConversationAttendance;
  responsibleId?: string | null;
  kommoUserName: (id: string | null | undefined) => string;
}

/** Histórico de uma conversa: mensagens do cliente, do vendedor e do bot na ordem real do Kommo. */
export function ConversationThread({ conversationId, backTo, attendance, responsibleId, kommoUserName }: Props) {
  const [state, setState] = useState<{ detail: ConversationDetail | null; messages: TimelineMessage[]; error: string | null; loading: boolean }>({
    detail: null,
    messages: [],
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all([fetchConversationDetail(conversationId), fetchConversationMessages(conversationId)])
      .then(([detail, messages]) => alive && setState({ detail, messages, error: null, loading: false }))
      .catch((err: Error) => alive && setState({ detail: null, messages: [], error: err.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [conversationId, nonce]);

  const transcript = useMemo(
    () => (state.detail ? buildTranscript(state.messages, { clientName: state.detail.client_name }) : []),
    [state.detail, state.messages]
  );
  const counts = useMemo(() => {
    const c = { client: 0, seller: 0, bot: 0, unavailable: 0 };
    for (const m of transcript) {
      if (m.sender === 'client') c.client += 1;
      else if (m.sender === 'seller') c.seller += 1;
      else if (m.sender === 'bot') c.bot += 1;
      if (m.unavailable) c.unavailable += 1;
    }
    return c;
  }, [transcript]);

  if (state.loading && !state.detail) return <LoadingBlock label="Carregando conversa…" />;
  if (state.error) return <ErrorBlock message={state.error} onRetry={() => setNonce((n) => n + 1)} />;
  if (!state.detail) return <EmptyState title="Conversa não encontrada." />;

  const d = state.detail;
  const leadUrl = kommoLeadUrl(d.kommo_lead_id);
  const hasAnalysis = d.score != null || !!d.summary?.trim() || d.strengths.length > 0 || d.improvements.length > 0;

  return (
    <article className="sv-thread">
      <header className="sv-thread-head">
        <Link to={backTo} className="sv-icon-link sv-only-mobile" aria-label="Voltar para a lista">
          <ArrowLeft size={18} />
        </Link>
        <div className="sv-thread-title">
          <h2>{d.client_name}</h2>
          <div className="sv-thread-meta">
            <ChannelBadge origin={d.origin} />
            {d.kommo_lead_id && <span>Lead {d.kommo_lead_id}</span>}
            <span>Última mensagem {formatInstantBR(d.occurred_at)}</span>
          </div>
        </div>
        {leadUrl && (
          <a className="sv-btn" href={leadUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} aria-hidden="true" /> Abrir no Kommo
          </a>
        )}
      </header>

      <div className="sv-thread-attendance">
        {attendance ? (
          <AttendanceDetails attendance={attendance} responsibleId={responsibleId} kommoUserName={kommoUserName} />
        ) : (
          <p className="sv-muted">Esta conversa não tem mensagens no período escolhido; ajuste o período para ver o status do atendimento.</p>
        )}
      </div>

      <div className="sv-thread-stats">
        <span>{int(counts.client)} do cliente</span>
        <span>{int(counts.seller)} de atendentes</span>
        <span>{int(counts.bot)} do bot</span>
        {counts.unavailable > 0 && <span className="sv-muted">{int(counts.unavailable)} sem texto (Kommo não enviou o conteúdo)</span>}
      </div>

      {hasAnalysis && (
        <section className="sv-analysis-box">
          <h3>
            <Sparkles size={15} aria-hidden="true" /> Análise salva
            {d.score != null && <span className="sv-score">{d.score.toFixed(1)} / 10</span>}
          </h3>
          {d.summary && <p>{d.summary}</p>}
          {d.strengths.length > 0 && (
            <div>
              <strong>Pontos fortes</strong>
              <ul>{d.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {d.improvements.length > 0 && (
            <div>
              <strong>Pontos de melhoria</strong>
              <ul>{d.improvements.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <div className="sv-messages" aria-label="Mensagens da conversa">
        {transcript.length === 0 && <EmptyState title="Nenhuma mensagem registrada para esta conversa." />}
        {transcript.map((m) => (
          <React.Fragment key={m.id}>
            {m.dayLabel && <div className="sv-day">{m.dayLabel}</div>}
            <div className={`sv-msg sv-msg-${m.sender}`}>
              <div className="sv-msg-author">
                {m.sender === 'bot' && <Bot size={12} aria-hidden="true" />}
                <span>{m.senderName}</span>
                <time>{m.time}</time>
              </div>
              <div className={`sv-bubble ${m.unavailable ? 'is-unavailable' : ''}`}>
                {m.unavailable ? (
                  'Texto não disponível pela API do Kommo'
                ) : (
                  <>
                    {m.attachmentType && <span className="sv-attachment">[{m.attachmentType}]</span>}
                    {m.text}
                  </>
                )}
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </article>
  );
}
