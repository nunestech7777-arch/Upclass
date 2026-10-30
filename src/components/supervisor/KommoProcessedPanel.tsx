import React from 'react';
import { Bot } from 'lucide-react';
import { int } from '../../lib/finance/format';
import type { KommoProcessed } from '../../lib/supervisor/attendance';

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
          <strong>{int(data.total)}</strong>
          <span>soma por atendente (uma conversa com 2 atendentes conta 2)</span>
        </div>
        <div>
          <small>Conversas únicas</small>
          <strong>{int(uniqueConversations)}</strong>
          <span>cada conversa uma vez (cliente escreveu ou uma pessoa respondeu)</span>
        </div>
      </div>
      <ul className="sv-bars">
        {data.users.map((u) => (
          <li key={u.kommoUserId}>
            <div className="sv-bars-row">
              <span>{kommoUserName(u.kommoUserId)}</span>
              <strong>{int(u.talks)}</strong>
            </div>
            <span className="fin-progress" aria-hidden="true">
              <span className="fin-progress-fill sv-fill-whatsapp" style={{ width: `${(u.talks / max) * 100}%` }} />
            </span>
          </li>
        ))}
        {data.robot.total > 0 && (
          <li>
            <div className="sv-bars-row">
              <span className="sv-inline-icon">
                <Bot size={14} aria-hidden="true" /> Robô
              </span>
              <strong>{int(data.robot.total)}</strong>
            </div>
            <span className="fin-progress" aria-hidden="true">
              <span className="fin-progress-fill sv-fill-other" style={{ width: `${(data.robot.total / max) * 100}%` }} />
            </span>
            <small className="sv-muted">
              {data.robot.byAuthor.map((r) => `${r.name} ${int(r.talks)}`).join(' + ')} · {int(data.robot.uniqueTalks)} atendimento
              {data.robot.uniqueTalks === 1 ? '' : 's'} diferente{data.robot.uniqueTalks === 1 ? '' : 's'}
            </small>
          </li>
        )}
      </ul>
      <p className="sv-footnote">
        Mesma regra do painel do Kommo: para cada atendente, quantos atendimentos (talks) receberam mensagem dele no período. O Robô
        soma cada autor automático à parte — Salesbot e envios com o nome do canal (mensagens enviadas pelo aparelho, que o Kommo
        também põe no Robô). {int(data.uniqueTalks)} atendimentos diferentes tiveram mensagem enviada.
        {data.withoutAuthor.messages > 0 &&
          ` ${int(data.withoutAuthor.messages)} mensagem(ns) sem autor no Kommo, em ${int(data.withoutAuthor.talks)} atendimento(s), ficam fora (o Kommo também não as mostra).`}{' '}
        Vale para a equipe toda, mesmo com filtro de atendente.
      </p>
    </>
  );
}
