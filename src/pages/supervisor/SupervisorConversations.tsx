import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, MessagesSquare, Search } from 'lucide-react';
import { AttendanceDetails } from '../../components/supervisor/AttendanceStatus';
import { ConversationThread } from '../../components/supervisor/ConversationThread';
import { ChannelBadge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/supervisor/SupervisorPrimitives';
import { usePeriodSummary, useSupervisor } from '../../components/supervisor/useSupervisor';
import { formatInstantBR } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import { filterLabel, isAttendanceFilter, matchesAttendanceFilter, type AttendanceFilter } from '../../lib/supervisor/attendance';
import { filtersKey, sanitizeSearch } from '../../lib/supervisor/filters';
import { fetchLeadResponsibles } from '../../lib/supervisor/supervisorApi';

const PAGE_SIZE = 30;
const STATUS_FILTERS: (AttendanceFilter | 'all')[] = [
  'all',
  'atendida',
  'nao_atendida',
  'aguardando_distribuicao',
  'atendente_nao_identificado',
  'automatico',
  'nao_determinado',
];

const lastAt = (c: { occurred_at: string; period_last_at?: string }) => c.period_last_at ?? c.occurred_at;
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function SupervisorConversations() {
  const { conversationId } = useParams();
  const { filters, kommoUserName, search: query } = useSupervisor();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const status: AttendanceFilter | 'all' = isAttendanceFilter(rawStatus) ? rawStatus : 'all';
  const { data, error, loading, reload } = usePeriodSummary(filters);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  // A página volta a 0 no mesmo render em que filtro, status ou busca mudam.
  const queryKey = `${filtersKey(filters)}|${status}|${debounced}`;
  const [pageState, setPageState] = useState({ key: queryKey, page: 0 });
  const rawPage = pageState.key === queryKey ? pageState.page : 0;
  const setPage = (next: (p: number) => number) => setPageState({ key: queryKey, page: next(page) });
  const [responsibles, setResponsibles] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(t);
  }, [term]);

  const rows = useMemo(() => {
    if (!data) return [];
    const t = sanitizeSearch(debounced);
    const needle = normalize(t);
    return data.conversations
      .filter((c) => {
        const a = data.attendance.get(c.id);
        if (status !== 'all' && (!a || !matchesAttendanceFilter(a, status))) return false;
        if (!t) return true;
        return /^\d+$/.test(t) ? c.kommo_lead_id === t : normalize(c.client_name).includes(needle);
      })
      .sort((a, b) => Date.parse(lastAt(b)) - Date.parse(lastAt(a)) || a.id.localeCompare(b.id));
  }, [data, status, debounced]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // Ao recarregar a lista pode encolher: nunca fica numa página que não existe mais.
  const page = Math.min(rawPage, pages - 1);
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const visibleLeads = visible.map((c) => c.kommo_lead_id).filter((x): x is string => !!x).join(',');

  // Responsável atual só das conversas na tela (consulta ao Kommo sob demanda, guardada por 5 min).
  useEffect(() => {
    if (!visibleLeads) return;
    let alive = true;
    fetchLeadResponsibles(visibleLeads.split(','))
      .then((found) => alive && setResponsibles((prev) => new Map([...prev, ...found])))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [visibleLeads]);

  const setStatus = (next: AttendanceFilter | 'all') =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'all') p.delete('status');
        else p.set('status', next);
        return p;
      },
      { replace: true }
    );

  const qs = query ? `?${query}` : '';
  const selected = conversationId && data ? data.attendance.get(conversationId) : undefined;
  const selectedConv = conversationId && data ? data.conversations.find((c) => c.id === conversationId) : undefined;
  const responsibleOf = (leadId: string | null) => (leadId && responsibles.has(leadId) ? responsibles.get(leadId) : undefined);

  return (
    <div className={`sv-convs ${conversationId ? 'has-selection' : ''}`}>
      <aside className="sv-conv-list" aria-label="Lista de conversas">
        <div className="sv-status-filters" role="group" aria-label="Status do atendimento">
          {STATUS_FILTERS.map((f) => (
            <button key={f} type="button" className={status === f ? 'is-active' : ''} aria-pressed={status === f} onClick={() => setStatus(f)}>
              {f === 'all' ? 'Todas' : filterLabel(f)}
              {data && f !== 'all'
                ? ` · ${f === 'aguardando_distribuicao' && (data.responsibles === 'historical' || data.responsibles === 'failed') ? '—' : int(data.totals[f])}`
                : ''}
            </button>
          ))}
        </div>
        <div className="sv-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar cliente ou nº do lead"
            aria-label="Buscar conversas"
          />
        </div>
        <div className="sv-conv-count">
          {!data ? 'Carregando…' : `${int(rows.length)} conversa${rows.length === 1 ? '' : 's'}${status === 'all' ? ' no período' : ` · ${filterLabel(status)}`}`}
        </div>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data ? (
          <LoadingBlock label="Classificando as conversas…" />
        ) : rows.length === 0 && status === 'aguardando_distribuicao' && data.responsibles === 'historical' ? (
          <EmptyState title="Não disponível para períodos passados.">
            O Kommo só informa com quem o lead está agora, o que não comprova a situação daquele dia. Escolha um período que inclua hoje.
          </EmptyState>
        ) : rows.length === 0 && status === 'aguardando_distribuicao' && data.responsibles === 'failed' ? (
          <EmptyState title="Responsáveis dos leads indisponíveis.">
            Não foi possível consultar o Kommo agora, então este filtro não pode ser calculado. Tente recarregar em instantes.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhuma conversa encontrada.">Mude o período, o atendente, o canal, o status ou a busca.</EmptyState>
        ) : (
          <ul className={`sv-conv-items ${loading ? 'is-reloading' : ''}`}>
            {visible.map((c) => {
              const a = data.attendance.get(c.id);
              return (
                <li key={c.id}>
                  <Link to={`/supervisor/conversas/${c.id}${qs}`} className={`sv-conv-item ${c.id === conversationId ? 'is-active' : ''}`}>
                    <span className="sv-conv-top">
                      <strong>{c.client_name}</strong>
                      <time title="Última mensagem no período">{formatInstantBR(lastAt(c))}</time>
                    </span>
                    <span className="sv-conv-bottom">
                      <ChannelBadge origin={c.origin} />
                      {c.messages_count != null && <span className="sv-muted">{int(c.messages_count)} msgs</span>}
                    </span>
                    {a && <AttendanceDetails attendance={a} responsibleId={responsibleOf(c.kommo_lead_id)} kommoUserName={kommoUserName} compact />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {rows.length > PAGE_SIZE && (
          <div className="sv-pager">
            <button type="button" className="sv-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
              <ChevronLeft size={15} />
            </button>
            <span>
              {page + 1} de {pages}
            </span>
            <button type="button" className="sv-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </aside>

      <section className="sv-conv-detail">
        {conversationId ? (
          <ConversationThread
            key={conversationId}
            conversationId={conversationId}
            backTo={`/supervisor/conversas${qs}`}
            attendance={selected}
            responsibleId={selectedConv ? responsibleOf(selectedConv.kommo_lead_id) : undefined}
            kommoUserName={kommoUserName}
          />
        ) : (
          <div className="sv-placeholder">
            <MessagesSquare size={28} aria-hidden="true" />
            <strong>Selecione uma conversa</strong>
            <p>As mensagens do cliente, do atendente e do bot aparecem aqui, com quem realmente respondeu e o motivo do status.</p>
          </div>
        )}
      </section>
    </div>
  );
}
