import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, RefreshCw, X } from 'lucide-react';
import {
  COST_SITUATION_LABEL,
  SEVERITY_LABEL,
  type CostSituation,
  type EmptyDaysNotice,
  type MissingCostNotice,
  type Notice,
  type PartialResultNotice,
} from '../../lib/notices/notices';
import { PENDING_REASON_LABEL } from '../../lib/finance/calc';
import { brl, int, sumMoney } from '../../lib/finance/format';
import { formatDateBR, formatInstantBR, weekdayShort } from '../../lib/finance/dates';

const SITUATIONS: CostSituation[] = ['cost_missing', 'cost_zero'];

/** Todos os itens de um aviso. Só leitura: custo e lucro nunca são estimados aqui. */
export function NoticeDetails({
  notice,
  resolved,
  loading,
  onRefresh,
  onClose,
}: {
  notice: Notice;
  /** O aviso sumiu na última leitura (pendência resolvida ou página/período trocado). */
  resolved: boolean;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-label="Fechar"]')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current();
      if (e.key !== 'Tab' || !ref.current) return;
      // Foco preso no modal (aria-modal): Tab circula entre os controles dele.
      const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return createPortal(
    <div className="nc-modal-root" role="dialog" aria-modal="true" aria-labelledby="nc-detail-title">
      <div className="nc-backdrop" onClick={onClose} />
      <div className="nc-modal" ref={ref}>
        <header className="nc-modal-head">
          <div>
            <span className={`nc-sev is-${notice.severity}`}>{SEVERITY_LABEL[notice.severity]}</span>
            <h2 id="nc-detail-title">{notice.title}</h2>
          </div>
          <div className="nc-modal-actions">
            <button type="button" className="nc-icon-btn" onClick={onRefresh} aria-label="Atualizar" disabled={loading}>
              <RefreshCw size={16} className={loading ? 'nc-spin' : ''} aria-hidden="true" />
            </button>
            <button type="button" className="nc-icon-btn" onClick={onClose} aria-label="Fechar">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {resolved ? (
          <div className="nc-state is-empty" role="status">
            <CheckCircle2 size={22} aria-hidden="true" />
            <strong>Nenhuma pendência</strong>
          </div>
        ) : notice.kind === 'missing_cost' ? (
          <MissingCostDetail notice={notice} />
        ) : notice.kind === 'partial_result' ? (
          <PartialResultDetail notice={notice} />
        ) : (
          <EmptyDaysDetail notice={notice} />
        )}
      </div>
    </div>,
    document.body
  );
}

function Summary({ tiles }: { tiles: { label: string; value: string }[] }) {
  return (
    <dl className="nc-summary">
      {tiles.map((t) => (
        <div key={t.label}>
          <dt>{t.label}</dt>
          <dd>{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MissingCostDetail({ notice }: { notice: MissingCostNotice }) {
  const bySituation = SITUATIONS.map((s) => ({ s, n: notice.items.filter((i) => i.situation === s).length })).filter((x) => x.n > 0);
  return (
    <>
      <Summary
        tiles={[
          { label: 'Itens', value: int(notice.count) },
          { label: 'Pedidos', value: int(notice.orders.length) },
          { label: 'Valor de venda', value: brl(sumMoney(notice.items.map((i) => i.amount))) },
          ...bySituation.map(({ s, n }) => ({ label: COST_SITUATION_LABEL[s], value: int(n) })),
        ]}
      />
      <ItemsTable
        rows={notice.items.map((it) => ({
          key: it.saleId,
          orderId: it.orderId,
          productName: it.productName,
          soldDate: it.soldDate,
          amount: it.amount,
          status: <span className={`nc-situation is-${it.situation}`}>{COST_SITUATION_LABEL[it.situation]}</span>,
        }))}
        statusLabel="Situação"
      />
    </>
  );
}

function PartialResultDetail({ notice }: { notice: PartialResultNotice }) {
  return (
    <>
      <Summary
        tiles={[
          { label: 'Conciliados', value: `${int(notice.reconciled)} de ${int(notice.total)}` },
          { label: 'Pendentes', value: int(notice.items.length) },
          { label: 'Valor pago pendente', value: brl(notice.amountPending) },
          ...(notice.lastSyncAt ? [{ label: 'Última conciliação', value: formatInstantBR(notice.lastSyncAt) }] : []),
          ...notice.reasons.map((r) => ({ label: PENDING_REASON_LABEL[r.reason], value: int(r.count) })),
        ]}
      />
      <ItemsTable
        rows={notice.items.map((it) => ({
          key: it.saleId,
          orderId: it.orderId,
          productName: it.productName,
          soldDate: it.soldDate,
          amount: it.amount,
          status: <span className={`nc-situation is-reason-${it.reason}`}>{PENDING_REASON_LABEL[it.reason]}</span>,
        }))}
        statusLabel="Motivo"
      />
    </>
  );
}

function EmptyDaysDetail({ notice }: { notice: EmptyDaysNotice }) {
  return (
    <>
      <Summary
        tiles={[
          { label: 'Dias sem vendas', value: int(notice.days.length) },
          ...(notice.lastSaleAt ? [{ label: 'Última venda', value: notice.lastSaleAt }] : []),
        ]}
      />
      <div className="nc-table-wrap">
        <table className="nc-table">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Dia da semana</th>
            </tr>
          </thead>
          <tbody>
            {[...notice.days].reverse().map((d) => (
              <tr key={d}>
                <td data-label="Data">{formatDateBR(d)}</td>
                <td data-label="Dia da semana">{weekdayShort(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface ItemRow {
  key: string;
  orderId: string | null;
  productName: string;
  soldDate: string;
  amount: number;
  status: React.ReactNode;
}

function ItemsTable({ rows, statusLabel }: { rows: ItemRow[]; statusLabel: string }) {
  return (
    <div className="nc-table-wrap">
      <table className="nc-table">
        <thead>
          <tr>
            <th scope="col">Pedido</th>
            <th scope="col">Produto</th>
            <th scope="col">Data da venda</th>
            <th scope="col" className="is-num">
              Valor de venda
            </th>
            <th scope="col">{statusLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td data-label="Pedido" className="is-num">
                {r.orderId ?? '—'}
              </td>
              <td data-label="Produto" className="nc-td-product">
                {r.productName}
              </td>
              <td data-label="Data da venda">{formatDateBR(r.soldDate)}</td>
              <td data-label="Valor de venda" className="is-num">
                {brl(r.amount)}
              </td>
              <td data-label={statusLabel}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
