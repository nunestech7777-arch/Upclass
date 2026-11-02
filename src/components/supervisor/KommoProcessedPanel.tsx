import React from 'react';
import { Bot } from 'lucide-react';
import { int } from '../../lib/finance/format';
import type { KommoProcessed } from '../../lib/supervisor/attendance';
import { AnimatedText } from '../ui/AnimatedNumber';
import { AnimatedBar } from '../ui/AnimatedBar';

/**
 * "Conversas processadas — critério Kommo" ao lado das conversas únicas do Meu Supervisor, para
 * comparar com o painel oficial do Kommo (mesma regra, ver kommoProcessedConversations).
 */
export function KommoProcessedPanel({
  data,
  uniqueConversations,
  kommoUserName,
}: {
  data: KommoProcessed;
  uniqueConversations: number;
  kommoUserName: (id: string | null | undefined) => string;
}) {
  const max = Math.max(1, ...data.users.map((u) => u.talks), data.robot.total);
  return (
    <>
      <div className="sv-kp-totals">
        <div>
          <small>Conversas processadas — critério Kommo</small>
          <strong>
            <AnimatedText text={int(data.total)} />
          </strong>
          <span>soma por atendente (uma conversa com 2 atendentes conta 2)</span>
        </div>
        <div>
          <small>Conversas únicas</small>
          <strong>
            <AnimatedText text={int(uniqueConversations)} />
          </strong>
          <span>cada conversa uma vez (cliente escreveu ou uma pessoa respondeu)</span>
        </div>
      </div>
      <ul className="sv-bars">
        {data.users.map((u) => (
          <li key={u.kommoUserId}>
            <div className="sv-bars-row">
              <span>{kommoUserName(u.kommoUserId)}</span>
              <strong>
                <AnimatedText text={int(u.talks)} />
              </strong>
            </div>
            <span className="fin-progress" aria-hidden="true">
              <AnimatedBar className="fin-progress-fill sv-fill-whatsapp" pct={(u.talks / max) * 100} />
            </span>
          </li>
        ))}
        {data.robot.total > 0 && (
          <li>
            <div className="sv-bars-row">
              <span className="sv-inline-icon">
                <Bot size={14} aria-hidden="true" /> Robô
              </span>
              <strong>
                <AnimatedText text={int(data.robot.total)} />
              </strong>
            </div>
            <span className="fin-progress" aria-hidden="true">
              <AnimatedBar className="fin-progress-fill sv-fill-other" pct={(data.robot.total / max) * 100} />
            </span>
            <small className="sv-muted">
              {data.robot.byAuthor.map((r) => `${r.name} ${int(r.talks)}`).join(' + ')} · {int(data.robot.uniqueTalks)} atendimento
              {data.robot.uniqueTalks === 1 ? '' : 's'} diferente{data.robot.uniqueTalks === 1 ? '' : 's'}
            </small>
          </li>
        )}
      </ul>
    </>
  );
}
