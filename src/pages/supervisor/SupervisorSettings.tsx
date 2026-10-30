import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Inbox, Lock, RefreshCw, Send, ShieldCheck, Users, Webhook } from 'lucide-react';
import { KpiCard } from '../../components/finance/FinancePrimitives';
import { KommoMappingCard } from '../../components/supervisor/KommoMappingCard';
import { ErrorBlock, LoadingBlock, NotActiveTag, Panel } from '../../components/supervisor/SupervisorPrimitives';
import { formatInstantBR } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import { fetchIntegrationHealth, type IntegrationHealth } from '../../lib/supervisor/supervisorApi';

/** Sem evento há mais que isso (em horário de loja) vale uma conferência. */
const STALE_MINUTES = 30;

/**
 * Recursos da integração e o estado verificado na implantação de 27/10/2026 (ver memória do
 * projeto). São informativos — o estado ao vivo é o painel de saúde acima, medido no banco.
 */
const CAPABILITIES = [
  { name: 'Mensagens dos clientes', how: 'Webhook add_message → kommo-webhook', status: 'active' as const },
  { name: 'Respostas dos vendedores e do bot', how: 'Webhook add_outgoing_message → kommo-webhook (desde 27/10/2026)', status: 'active' as const },
  { name: 'Autor e horário de mensagens antigas', how: 'Eventos da API (kommo-sync-events), sem o texto', status: 'active' as const },
  { name: 'Texto do histórico anterior a 27/10/2026', how: 'GET /talks/{id}/messages — exige plano Empresarial e escopo External chat history', status: 'blocked' as const },
];

export function SupervisorSettings() {
  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchIntegrationHealth()
      .then((h) => alive && setHealth(h))
      .catch((err: Error) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce]);

  const minutesSinceLast = health?.lastEventAt ? (Date.now() - Date.parse(health.lastEventAt)) / 60000 : null;
  const healthy =
    health != null && minutesSinceLast != null && minutesSinceLast <= STALE_MINUTES && health.pending7d === 0 && health.errors24h === 0;

  return (
    <div className="sv-stack">
      <Panel
        title="Status da integração Kommo"
        eyebrow="Medido no banco agora"
        actions={
          <button type="button" className="sv-btn" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'fin-spin' : ''} aria-hidden="true" /> Atualizar
          </button>
        }
      >
        {error ? (
          <ErrorBlock message={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : !health ? (
          <LoadingBlock label="Conferindo a integração…" />
        ) : (
          <>
            <div className={`sv-health ${healthy ? 'is-ok' : 'is-warn'}`}>
              {healthy ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
              <span>
                {healthy
                  ? 'Recebendo eventos normalmente.'
                  : minutesSinceLast == null
                    ? 'Nenhum evento recebido ainda.'
                    : minutesSinceLast > STALE_MINUTES
                      ? `Sem eventos há ${Math.round(minutesSinceLast)} min — normal fora do horário da loja; confira se persistir.`
                      : health.errors24h == null || health.pending7d == null
                        ? 'Recebendo eventos; parte das conferências não respondeu a tempo.'
                        : 'Há eventos com erro nas últimas 24 h ou pendentes nos últimos 7 dias.'}
              </span>
            </div>
            <div className="sv-kpis">
              <KpiCard label="Último evento recebido" value={health.lastEventAt ? formatInstantBR(health.lastEventAt) : '—'} icon={<Clock3 size={18} />} tone="neutral" />
              <KpiCard label="Eventos nas últimas 24 h" value={int(health.events24h)} icon={<Webhook size={18} />} tone="goal" caption="Assinatura principal (kommo-webhook)" />
              <KpiCard label="Respostas de vendedores (24 h)" value={int(health.outgoing24h)} icon={<Send size={18} />} tone="profit" caption="Eventos add_outgoing_message" />
              <KpiCard label="Erros (24 h)" value={int(health.errors24h)} icon={<AlertTriangle size={18} />} tone={health.errors24h ? 'deficit' : 'profit'} />
              <KpiCard label="Pendentes (7 dias)" value={int(health.pending7d)} icon={<Inbox size={18} />} tone={health.pending7d ? 'warn' : 'profit'} caption="Recebidos e ainda não processados" />
              <KpiCard label="Conversas gravadas" value={int(health.conversationsTotal)} icon={<Activity size={18} />} tone="neutral" caption={`${int(health.conversationsWithoutSeller)} sem vendedor vinculado`} />
            </div>
            {health.failed > 0 && (
              <p className="sv-footnote">
                {health.failed} conferência(s) não responderam a tempo e aparecem como “—”. Use Atualizar para tentar de novo.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Recursos da integração" eyebrow="Diagnóstico da API">
        <ul className="sv-capabilities">
          {CAPABILITIES.map((c) => (
            <li key={c.name}>
              <span className={`sv-dot ${c.status === 'active' ? 'is-ok' : 'is-off'}`} aria-hidden="true" />
              <div>
                <strong>{c.name}</strong>
                <small>{c.how}</small>
              </div>
              <span className={c.status === 'active' ? 'sv-tag-ok' : 'sv-tag-muted'}>{c.status === 'active' ? 'Ativo' : 'Indisponível no plano atual'}</span>
            </li>
          ))}
        </ul>
        <p className="sv-footnote sv-inline-icon">
          <ShieldCheck size={13} aria-hidden="true" /> Tokens e segredos ficam só nas Edge Functions do Supabase e nunca chegam ao navegador.
        </p>
      </Panel>

      <Panel title="Vendedores e usuários do Kommo" eyebrow={health ? `${int(health.kommoUsers)} usuários sincronizados` : 'Sincronização'}>
        <KommoMappingCard />
      </Panel>

      <Panel title="Histórico de erros" eyebrow="Últimas 24 horas">
        {!health ? (
          <LoadingBlock label="Buscando erros…" />
        ) : health.recentErrors == null ? (
          <p className="sv-muted">Não foi possível consultar os erros agora. Use Atualizar para tentar de novo.</p>
        ) : health.recentErrors.length === 0 ? (
          <p className="sv-muted sv-inline-icon">
            <CheckCircle2 size={14} aria-hidden="true" /> Nenhum erro registrado no processamento dos webhooks.
          </p>
        ) : (
          <ul className="sv-errors">
            {health.recentErrors.map((e) => (
              <li key={e.id}>
                <time>{formatInstantBR(e.received_at)}</time>
                <code>{e.error}</code>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="sv-grid-2">
        <Panel title="Supervisor IA" eyebrow="Configurações e preferências de análise" actions={<NotActiveTag>Desativado</NotActiveTag>}>
          <p className="sv-muted sv-inline-icon">
            <Lock size={14} aria-hidden="true" /> Modelo, critérios com peso e frequência de análise serão configurados aqui quando a
            ativação for autorizada. Nenhuma chamada de IA está ligada.
          </p>
        </Panel>
        <Panel title="Relatórios" eyebrow="Envio automático" actions={<NotActiveTag>Desativado</NotActiveTag>}>
          <p className="sv-muted sv-inline-icon">
            <Users size={14} aria-hidden="true" /> Horário de geração e destinatários do relatório diário ficarão aqui. Nenhum
            agendamento foi criado.
          </p>
        </Panel>
      </div>
    </div>
  );
}
