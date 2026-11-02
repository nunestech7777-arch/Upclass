import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotices } from '../../lib/notices/useNotices';
import { usePageNoticeList } from '../../lib/notices/PageNotices';
import {
  COST_SITUATION_LABEL,
  PENDING_REASON_PHRASE,
  SEVERITY_LABEL,
  noticeCount,
  sortNotices,
  type EmptyDaysNotice,
  type MissingCostNotice,
  type Notice,
  type PartialResultNotice,
} from '../../lib/notices/notices';
import { brl, int } from '../../lib/finance/format';
import { dayLabel, formatDateBR, formatInstantBR } from '../../lib/finance/dates';
import { NoticeDetails } from './NoticeDetails';
import './NoticeCenter.css';

const PREVIEW_ITEMS = 3;
const POPOVER_GAP = 10;
/** Mesma largura máxima do CSS (.nc-pop) e margem lateral da página no celular. */
const POPOVER_WIDTH = 380;
const GUTTER = 16;

const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * Sino da Central de Avisos (cabeçalho). Só para administrador ativo: os avisos atuais são
 * financeiros (custos) e as tabelas lidas têm RLS de administrador — para os demais nada é
 * consultado nem exibido. O popover vai para o <body> (o cabeçalho tem backdrop-filter, que
 * prenderia um `position: fixed`).
 */
export function NoticeCenter() {
  const { access, accessError } = useAuth();
  const isAdmin = !accessError && access?.role === 'admin' && access.enabled;
  const { notices: globalNotices, loading, error, loadedAt, refresh } = useNotices(isAdmin);
  // Globais (banco) + os da página aberta (período carregado), ordenados por gravidade e data.
  const pageNotices = usePageNoticeList();
  const notices = useMemo(() => (isAdmin ? sortNotices([...globalNotices, ...pageNotices]) : []), [isAdmin, globalNotices, pageNotices]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Notice | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const total = noticeCount(notices);

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    // Alinhado ao sino, mas sempre dentro da tela com margem de 16px (no celular o sino não fica na borda).
    const vw = window.innerWidth;
    const width = Math.min(POPOVER_WIDTH, vw - 2 * GUTTER);
    const right = Math.min(Math.max(GUTTER, vw - r.right), vw - GUTTER - width);
    setPos({ top: r.bottom + POPOVER_GAP, right });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Foco no popover quando ele aparece (só depois de `pos`, que posiciona a primeira renderização).
  const placed = open && pos != null;
  useEffect(() => {
    if (placed) popRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [placed]);

  // Detalhe aberto acompanha a releitura: se a pendência sumiu, mostra o estado atual (resolvido).
  const liveDetail = detail ? (notices.find((n) => n.id === detail.id) ?? null) : null;

  if (!isAdmin) return null;

  const label = total > 0 ? `Avisos: ${total} pendência(s)` : 'Avisos: nenhuma pendência';

  return (
    <div className="nc">
      <button
        ref={buttonRef}
        type="button"
        className={`nc-bell ${total > 0 ? 'has-pending' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={18} strokeWidth={2.1} aria-hidden="true" />
        {total > 0 && (
          <span className="nc-badge" aria-hidden="true">
            {badgeText(total)}
          </span>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            className="nc-pop"
            role="dialog"
            aria-label="Central de avisos"
            style={{ top: pos.top, right: pos.right } as React.CSSProperties}
          >
            <header className="nc-pop-head">
              <h2>Avisos</h2>
              {total > 0 && <span className="nc-pop-total">{int(total)}</span>}
              <button type="button" className="nc-icon-btn" onClick={refresh} aria-label="Atualizar avisos" disabled={loading}>
                <RefreshCw size={15} className={loading ? 'nc-spin' : ''} aria-hidden="true" />
              </button>
            </header>

            <div className="nc-pop-body">
              {notices.length > 0 && (
                <ul className="nc-list">
                  {notices.map((n) => (
                    <li key={n.id}>
                      <NoticeCard
                        notice={n}
                        onDetails={() => {
                          setDetail(n);
                          setOpen(false);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {error && globalNotices.length === 0 ? (
                <div className="nc-state is-error">
                  <AlertTriangle size={20} aria-hidden="true" />
                  <strong>Não foi possível carregar os avisos</strong>
                  <button type="button" className="nc-link-btn" onClick={refresh}>
                    Tentar novamente
                  </button>
                </div>
              ) : loadedAt == null ? (
                <div className={`nc-state ${notices.length > 0 ? 'is-compact' : ''}`} role="status">
                  <RefreshCw size={18} className="nc-spin" aria-hidden="true" />
                  <span>Carregando…</span>
                </div>
              ) : notices.length === 0 ? (
                <div className="nc-state is-empty" role="status">
                  <CheckCircle2 size={22} aria-hidden="true" />
                  <strong>Nenhuma pendência</strong>
                </div>
              ) : null}
            </div>
          </div>,
          document.body
        )}

      {detail && (
        <NoticeDetails
          notice={liveDetail ?? detail}
          resolved={!liveDetail}
          loading={loading}
          onRefresh={refresh}
          onClose={() => {
            setDetail(null);
            buttonRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function NoticeCard({ notice, onDetails }: { notice: Notice; onDetails: () => void }) {
  return (
    <article className={`nc-card is-${notice.severity}`}>
      <div className="nc-card-head">
        <span className={`nc-sev is-${notice.severity}`}>{SEVERITY_LABEL[notice.severity]}</span>
        <span className="nc-card-date">{cardDate(notice)}</span>
      </div>
      <h3 className="nc-card-title">{notice.title}</h3>
      {notice.kind === 'missing_cost' ? (
        <MissingCostBody notice={notice} />
      ) : notice.kind === 'partial_result' ? (
        <PartialResultBody notice={notice} />
      ) : (
        <EmptyDaysBody notice={notice} />
      )}
      <button type="button" className="nc-details-btn" onClick={onDetails}>
        Ver detalhes
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </article>
  );
}

function cardDate(n: Notice): string {
  if (n.kind === 'missing_cost') return formatDateBR(n.items[0]?.soldDate);
  if (n.kind === 'partial_result') return n.lastSyncAt ? formatInstantBR(n.lastSyncAt) : '';
  return formatDateBR(n.days[n.days.length - 1]);
}

function MissingCostBody({ notice }: { notice: MissingCostNotice }) {
  return (
    <>
      <p className="nc-card-meta">
        <strong>{int(notice.count)}</strong> {notice.count === 1 ? 'item' : 'itens'} · {int(notice.orders.length)}{' '}
        {notice.orders.length === 1 ? 'pedido' : 'pedidos'}
      </p>
      <ul className="nc-preview">
        {notice.items.slice(0, PREVIEW_ITEMS).map((it) => (
          <li key={it.saleId}>
            <span className="nc-preview-name">{it.productName}</span>
            <span className="nc-preview-meta">
              {it.orderId ? `#${it.orderId}` : 'sem pedido'} · {formatDateBR(it.soldDate)} · {brl(it.amount)}
            </span>
            <span className={`nc-situation is-${it.situation}`}>{COST_SITUATION_LABEL[it.situation]}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function PartialResultBody({ notice }: { notice: PartialResultNotice }) {
  return (
    <>
      <p className="nc-card-meta">
        <strong>{int(notice.reconciled)}</strong> de {int(notice.total)} itens conciliados
      </p>
      <ul className="nc-reasons">
        {notice.reasons.map((r) => (
          <li key={r.reason}>
            <strong>{int(r.count)}</strong> {PENDING_REASON_PHRASE[r.reason]}
          </li>
        ))}
      </ul>
    </>
  );
}

function EmptyDaysBody({ notice }: { notice: EmptyDaysNotice }) {
  const shown = notice.days.slice(-6).map(dayLabel).join(', ');
  return (
    <>
      <p className="nc-card-meta">
        <strong>{int(notice.days.length)}</strong> {notice.days.length === 1 ? 'dia' : 'dias'} sem vendas registradas
      </p>
      <p className="nc-card-meta">
        {shown}
        {notice.days.length > 6 ? ', …' : ''}
        {notice.lastSaleAt ? ` · Última venda ${notice.lastSaleAt}` : ''}
      </p>
    </>
  );
}
