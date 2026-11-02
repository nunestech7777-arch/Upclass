import React from 'react';
import { Link } from 'react-router-dom';
import { Bot, CheckCircle2, CircleHelp, Inbox, UserX, UserRoundSearch } from 'lucide-react';
import { int, pct } from '../../lib/finance/format';
import {
  filterLabel,
  type AttendanceFilter,
  type AttendanceStatus,
  type AttendanceTotals,
  type ConversationAttendance,
} from '../../lib/supervisor/attendance';
import { AnimatedText } from '../ui/AnimatedNumber';

const ICON: Record<AttendanceFilter, React.ReactNode> = {
  atendida: <CheckCircle2 size={16} aria-hidden="true" />,
  nao_atendida: <UserX size={16} aria-hidden="true" />,
  aguardando_distribuicao: <Inbox size={16} aria-hidden="true" />,
  atendente_nao_identificado: <UserRoundSearch size={16} aria-hidden="true" />,
  automatico: <Bot size={16} aria-hidden="true" />,
  nao_determinado: <CircleHelp size={16} aria-hidden="true" />,
};

const HINT: Record<AttendanceFilter, string> = {
  atendida: 'Quem respondeu foi identificado pelo usuário do Kommo que enviou a mensagem.',
  nao_atendida: 'O cliente escreveu e nenhuma resposta humana foi encontrada.',
  aguardando_distribuicao: 'Sem resposta humana no período e o lead está HOJE com quem não é vendedor (ex.: a conta do supervisor). Também aparece em "Não atendida" ou "Automático". Só para períodos que incluem hoje.',
  atendente_nao_identificado: 'Alguém respondeu direto pelo WhatsApp/Instagram do aparelho; o Kommo não informa quem.',
  automatico: 'Só o Salesbot ou respostas automáticas do canal responderam.',
  nao_determinado: 'Resposta registrada sem autor e sem texto no Kommo, ou sem mensagens suficientes.',
};

const CARDS: AttendanceFilter[] = ['atendida', 'nao_atendida', 'aguardando_distribuicao', 'atendente_nao_identificado', 'automatico', 'nao_determinado'];

export function AttendanceBadge({ status, compact }: { status: AttendanceFilter; compact?: boolean }) {
  return (
    <span className={`sv-status sv-status-${status}`} title={compact ? filterLabel(status) : undefined}>
      {ICON[status]}
      {!compact && filterLabel(status)}
    </span>
  );
}

/** Indicadores de status; cada cartão abre a lista de conversas daquele status. */
export function AttendanceStatusPanel({
  totals,
  responsibles,
  linkTo,
}: {
  totals: AttendanceTotals;
  responsibles: 'ok' | 'failed' | 'none' | 'historical' | 'pending';
  linkTo: (f: AttendanceFilter) => string;
}) {
  const distributionUnknown = responsibles === 'failed' || responsibles === 'historical';
  const distributionValue = responsibles === 'pending' ? '…' : distributionUnknown ? '—' : null;
  return (
    <>
      <div className="sv-status-grid">
        {CARDS.map((f) => {
          const n = totals[f];
          const share = totals.total ? (n / totals.total) * 100 : null;
          return (
            <Link key={f} to={linkTo(f)} className={`sv-att-card sv-status-${f}`} title={HINT[f]}>
              <span className="sv-att-card-head">
                {ICON[f]}
                <span>{filterLabel(f)}</span>
              </span>
              <strong>
                <AnimatedText text={f === 'aguardando_distribuicao' && distributionValue ? distributionValue : int(n)} />
              </strong>
              <small>
                {f !== 'aguardando_distribuicao'
                  ? `${pct(share)} das conversas`
                  : responsibles === 'historical'
                    ? 'Só para períodos que incluem hoje'
                    : responsibles === 'pending'
                      ? 'Consultando o Kommo…'
                      : 'Situação atual · não soma no total'}
              </small>
            </Link>
          );
        })}
      </div>
    </>
  );
}

/** Responsável no Kommo × quem realmente respondeu, com o motivo da classificação. */
export function AttendanceDetails({
  attendance,
  responsibleId,
  kommoUserName,
  compact,
}: {
  attendance: ConversationAttendance;
  /** Responsável consultado à parte (lista); senão usa o do próprio status. */
  responsibleId?: string | null;
  kommoUserName: (id: string | null | undefined) => string;
  compact?: boolean;
}) {
  const resp = responsibleId !== undefined ? responsibleId : attendance.responsibleId;
  const respLabel = resp === undefined ? 'Não consultado' : resp === null ? 'Lead não encontrado no Kommo' : kommoUserName(resp);
  const attendants = attendance.attendants.length
    ? attendance.attendants.map((a) => `${kommoUserName(a.kommoUserId)}${attendance.attendants.length > 1 ? ` (${a.messages})` : ''}`).join(', ')
    : 'Não identificado';
  return (
    <dl className={`sv-attendance ${compact ? 'is-compact' : ''}`}>
      <div>
        <dt>Status</dt>
        <dd>
          <AttendanceBadge status={attendance.status as AttendanceStatus} />
          {attendance.awaitingDistribution && <AttendanceBadge status="aguardando_distribuicao" />}
        </dd>
      </div>
      <div>
        <dt>Responsável atual no Kommo</dt>
        <dd>{respLabel}</dd>
      </div>
      <div>
        <dt>{attendance.attendants.length > 1 ? 'Atendentes' : 'Atendente'}</dt>
        <dd className={attendance.attendants.length ? '' : 'sv-muted'}>{attendants}</dd>
      </div>
      {!compact && (
        <div className="sv-attendance-reason">
          <dt>Motivo</dt>
          <dd>{attendance.reason}</dd>
        </div>
      )}
    </dl>
  );
}
