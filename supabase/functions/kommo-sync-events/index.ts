import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchAllUsers, fetchLeadChatMessageEvents, fetchRecentChatEvents, fetchTalk } from '../_shared/kommo.ts';
import { syncKommoUsers, usersAreStale } from '../_shared/kommoUsers.ts';
import { collectUnknownTalks, isChatEventOfLead, planPlaceholders } from '../_shared/kommoMessage.ts';
import { newTalkHistoryState, syncTalkHistory, talksOfEvents, type TalkHistoryState } from '../_shared/kommoTalkSync.ts';

/**
 * Completa as transcrições com as mensagens que o webhook do Kommo não entrega (as enviadas pelo
 * atendente/automação e eventuais recebidas perdidas). A events API informa id, direção, horário e
 * autor — o texto não é exposto pela API pública, então a mensagem entra como marcador
 * (message_type = 'unavailable') na posição cronológica correta.
 *
 * POST ?secret=KOMMO_WEBHOOK_SECRET
 *   body {}                                  → conversas com atividade nas últimas 72h (uso no cron)
 *   body { "hours": 2, "conversation_days": 7 } → eventos das últimas 2h em conversas ativas há até 7 dias
 *   body { "all": true }                     → backfill de todas as conversas
 * Cada invocação processa uma página e dispara a próxima sozinha (body.chain = false desliga);
 * a resposta traz o resumo só da primeira página.
 *   body { "lead_id": "123" }                → um lead específico
 *   body { "global": true, "hours": 2 }      → eventos da conta toda na janela; só os leads com atividade (cron)
 *
 * Histórico oficial (GET /talks/{id}/messages, escopo "External chat history"): para cada talk com
 * eventos na janela, busca as mensagens das duas direções COM texto e autor, preenchendo os marcadores
 * (mesmo id) e gravando as que faltam. Mensagens reais já gravadas não são reescritas. Se a API negar
 * acesso (401/402/403) o histórico é suspenso na invocação e os marcadores continuam como fallback.
 * Desligado por padrão: ligar com o secret KOMMO_TALK_HISTORY=on depois de validar no kommo-talk-probe.
 */

const CONCURRENCY = 3; // a API do Kommo limita a ~7 req/s por conta
const PAGE = 12;
const GLOBAL_TIME_BUDGET_MS = 100_000;
/** Limite de encadeamentos por disparo (12 conversas × 2000 = 24 mil conversas). */
const MAX_HOPS = 2000;

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Busca todas as linhas paginando (o PostgREST corta em 1000). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function syncLead(
  supabase: Supa,
  leadId: string,
  userNames: Map<string, string>,
  history: TalkHistoryState,
  sinceUnix?: number,
  // deno-lint-ignore no-explicit-any
  prefetchedEvents?: any[]
) {
  const empty = { inserted: 0, exists: 0, unmatched: 0, not_found: 0, failed: 0, no_conversation: false };
  const convs = await fetchAll<{ id: string; kommo_chat_id: string | null; kommo_contact_id: string | null }>((f, t) =>
    supabase.from('conversations').select('id, kommo_chat_id, kommo_contact_id').eq('kommo_lead_id', leadId).order('id').range(f, t)
  );
  if (!convs.length) return { ...empty, no_conversation: true };
  const conversationIds = convs.map((c) => c.id);

  const msgs = await fetchAll<{ external_id: string | null; conversation_id: string; kommo_talk_id: string | null; kommo_contact_id: string | null; message_type: string }>(
    (f, t) =>
      supabase
        .from('conversation_messages')
        .select('external_id, conversation_id, kommo_talk_id, kommo_contact_id, message_type')
        .in('conversation_id', conversationIds)
        .order('id')
        .range(f, t)
  );

  const existingMessageIds = new Set<string>();
  const talkToConversation = new Map<string, string>();
  const contactIds = new Set<string>();
  for (const c of convs) if (c.kommo_contact_id) contactIds.add(c.kommo_contact_id);
  for (const m of msgs) {
    if (m.external_id) existingMessageIds.add(m.external_id);
    // Só mensagens reais do webhook provam a ligação talk → conversa.
    if (m.kommo_talk_id && m.message_type !== 'unavailable') talkToConversation.set(m.kommo_talk_id, m.conversation_id);
    if (m.kommo_contact_id) contactIds.add(m.kommo_contact_id);
  }
  // Eventos já buscados (modo global) ou busca por contato do lead.
  let events;
  if (prefetchedEvents) {
    events = prefetchedEvents.filter((e) => isChatEventOfLead(e, leadId));
  } else {
    if (!contactIds.size) return empty;
    events = await fetchLeadChatMessageEvents(leadId, [...contactIds], sinceUnix);
  }

  // Talks sem mensagem gravada: resolve o chat pela API e casa com a conversa do mesmo chat e lead.
  const chatToConversation = new Map(convs.filter((c) => c.kommo_chat_id).map((c) => [c.kommo_chat_id!, c.id]));

  // Histórico oficial primeiro: o que ele gravar com texto não vira marcador. Falha aqui não pode
  // impedir os marcadores (fallback) deste lead.
  try {
    const written = await syncTalkHistory(supabase, history, leadId, talksOfEvents(events), talkToConversation, chatToConversation, sinceUnix);
    for (const id of written) existingMessageIds.add(id);
  } catch (err) {
    history.totals.errors += 1;
    console.error(`kommo-sync-events: histórico do lead ${leadId} falhou`, String(err).slice(0, 200));
  }

  const talkChatConversation = new Map<string, string>();
  for (const talkId of collectUnknownTalks(events, existingMessageIds, talkToConversation)) {
    const talk = await fetchTalk(talkId);
    if (!talk?.chat_id || talk.entity_type !== 'lead' || talk.entity_id !== String(leadId)) continue;
    const conv = chatToConversation.get(talk.chat_id);
    if (conv) talkChatConversation.set(talkId, conv);
  }

  const plan = planPlaceholders(events, { existingMessageIds, talkToConversation, talkChatConversation, userNames });

  // Em lotes (uma ida ao banco por lote): leads com histórico longo têm milhares de marcadores.
  let inserted = 0;
  let exists = 0;
  let notFound = 0;
  let failed = 0;
  // 50 por lote: cada item inserido abre uma subtransação e o cache por backend comporta 64.
  for (let i = 0; i < plan.placeholders.length; i += 50) {
    const batch = plan.placeholders.slice(i, i + 50);
    const { data, error } = await supabase.rpc('kommo_insert_event_placeholders', { p_messages: batch });
    if (error) throw new Error(`marcadores do lead ${leadId}: ${error.message}`);
    inserted += data?.inserted ?? 0;
    exists += data?.exists ?? 0;
    notFound += data?.not_found ?? 0;
    failed += data?.failed ?? 0;
  }
  if (failed > 0) console.error(`kommo-sync-events: ${failed} marcador(es) do lead ${leadId} falharam (ver warnings do Postgres)`);
  return { inserted, exists, unmatched: plan.unmatched.length, not_found: notFound, failed, no_conversation: false };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret');
  if (!secret || secret !== Deno.env.get('KOMMO_WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const requestStartedAt = Date.now();

  // Chave de pausa operacional (secret KOMMO_SYNC_PAUSED=true): interrompe cron e cadeias em andamento.
  if (Deno.env.get('KOMMO_SYNC_PAUSED') === 'true') {
    return new Response(JSON.stringify({ ok: false, paused: true }), { status: 503 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const all = body.all === true;
    // hours: janela dos EVENTOS buscados na Kommo. conversation_days: quais conversas verificar.
    // São separados porque o atendente pode responder (follow-up) dias depois da última mensagem
    // do cliente, e occurred_at só reflete mensagens reais (as do cliente).
    const hours = Number(body.hours) > 0 ? Number(body.hours) : body.global === true ? 1 : 72;
    const conversationDays = Number(body.conversation_days) > 0 ? Number(body.conversation_days) : hours / 24;

    // Usuários novos no Kommo (ex.: vendedora contratada depois) só entravam com o kommo-sync manual.
    // Aqui a lista é renovada quando fica velha; falha nunca interrompe a sincronização de eventos.
    try {
      const { data: last } = await supabase.from('kommo_users').select('synced_at').order('synced_at', { ascending: false }).limit(1);
      if (usersAreStale(last?.[0]?.synced_at, new Date())) {
        const { users: n } = await syncKommoUsers(supabase, fetchAllUsers);
        console.log(JSON.stringify({ kommo_sync_events: 'users_refreshed', users: n }));
      }
    } catch (err) {
      console.error('kommo-sync-events: falha ao atualizar usuários do Kommo', String(err).slice(0, 200));
    }

    const { data: users } = await supabase.from('kommo_users').select('id, name');
    const userNames = new Map<string, string>((users ?? []).map((u: { id: string; name: string }) => [u.id, u.name]));
    const history = newTalkHistoryState();

    // Janela: só eventos recentes (1h de margem) — evita baixar o histórico inteiro a cada ciclo.
    const sinceUnix = (all || typeof body.lead_id === 'string') && body.global !== true ? undefined : Date.now() / 1000 - hours * 3600 - 3600;

    // Modo global (cron): uma consulta de eventos da conta inteira na janela e sincroniza só os
    // leads que tiveram mensagens — não depende de percorrer todas as conversas.
    if (body.global === true) {
      const { events, truncated } = await fetchRecentChatEvents(sinceUnix!);
      const byLead = new Map<string, unknown[]>();
      for (const e of events) {
        // deno-lint-ignore no-explicit-any
        const ev = e as any;
        if (ev?.entity_type !== 'lead' || !ev?.entity_id) continue;
        const id = String(ev.entity_id);
        if (!byLead.has(id)) byLead.set(id, []);
        byLead.get(id)!.push(ev);
      }
      const totals = {
        events: events.length,
        truncated,
        leads: byLead.size,
        synced: 0,
        skipped: 0,
        no_conversation: 0,
        inserted: 0,
        exists: 0,
        unmatched: 0,
        not_found: 0,
        failed: 0,
        errors: 0,
      };
      const errors: string[] = [];
      // Os eventos vêm do mais novo para o mais antigo, então a ordem de inserção no Map já prioriza
      // os leads com atividade mais recente. O que não couber no orçamento fica para o próximo ciclo
      // (as janelas do cron se sobrepõem).
      const leadIds = [...byLead.keys()];
      // Orçamento contado desde o início da requisição (inclui a busca de eventos), abaixo do limite do worker.
      for (let i = 0; i < leadIds.length && Date.now() - requestStartedAt < GLOBAL_TIME_BUDGET_MS; i += CONCURRENCY) {
        await Promise.all(
          leadIds.slice(i, i + CONCURRENCY).map(async (leadId) => {
            try {
              const r = await syncLead(supabase, leadId, userNames, history, sinceUnix, byLead.get(leadId));
              totals.synced += 1;
              totals.inserted += r.inserted;
              totals.exists += r.exists;
              totals.unmatched += r.unmatched;
              totals.not_found += r.not_found;
              totals.failed += r.failed;
              if (r.no_conversation) totals.no_conversation += 1;
            } catch (err) {
              totals.errors += 1;
              if (errors.length < 10) errors.push(`${leadId}: ${String(err)}`);
            }
          })
        );
      }
      totals.skipped = totals.leads - totals.synced - totals.errors;
      // Cobertura incompleta vira erro no log, para ser visível no painel de logs.
      if (totals.truncated || totals.skipped > 0 || totals.errors > 0 || totals.failed > 0 || history.blocked || history.totals.errors > 0) {
        console.error(JSON.stringify({ kommo_sync_events_global_incompleto: totals, errors, talk_history: { blocked: history.blocked, ...history.totals } }));
      } else {
        console.log(JSON.stringify({ kommo_sync_events_global: totals, talk_history: history.totals }));
      }
      return new Response(JSON.stringify({ ok: true, mode: 'global', ...totals, error_details: errors, talk_history: { blocked: history.blocked, ...history.totals } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof body.lead_id === 'string') {
      const r = await syncLead(supabase, body.lead_id, userNames, history, all ? undefined : sinceUnix);
      return new Response(JSON.stringify({ ok: true, lead_id: body.lead_id, ...r, talk_history: { blocked: history.blocked, ...history.totals } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const totals = { leads: 0, inserted: 0, exists: 0, unmatched: 0, not_found: 0, failed: 0, errors: 0 };
    const errors: string[] = [];
    const after: string | null = typeof body.after === 'string' ? body.after : null;
    const hop = Number.isInteger(body.hop) ? body.hop : 0;
    // Registro para retomar um backfill interrompido: reenviar o mesmo body com este `after`.
    console.log(JSON.stringify({ kommo_sync_events_hop: hop, after, all, hours, conversation_days: conversationDays }));

    // Uma página pequena por invocação (o worker tem limite de CPU/memória); o restante é
    // processado encadeando uma nova invocação com o cursor, até acabar.
    let query = supabase
      .from('conversations')
      .select('id, kommo_lead_id')
      .not('kommo_lead_id', 'is', null)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (!all) query = query.gte('occurred_at', new Date(Date.now() - conversationDays * 86400_000).toISOString());
    if (after) query = query.gt('id', after);
    const { data: page, error } = await query;
    if (error) throw new Error(`listar conversas: ${error.message}`);

    const leads = [...new Set((page ?? []).map((c: { kommo_lead_id: string }) => c.kommo_lead_id))] as string[];
    for (let i = 0; i < leads.length; i += CONCURRENCY) {
      await Promise.all(
        leads.slice(i, i + CONCURRENCY).map(async (leadId) => {
          try {
            const r = await syncLead(supabase, leadId, userNames, history, sinceUnix);
            totals.leads += 1;
            totals.inserted += r.inserted;
            totals.exists += r.exists;
            totals.unmatched += r.unmatched;
            totals.not_found += r.not_found;
            totals.failed += r.failed;
          } catch (err) {
            totals.errors += 1;
            if (errors.length < 10) errors.push(`${leadId}: ${String(err)}`);
          }
        })
      );
    }

    const next = page && page.length === PAGE ? page[page.length - 1].id : null;
    if (next && body.chain !== false && hop < MAX_HOPS) {
      // req.url dentro do runtime não traz o caminho público /functions/v1 — monta a partir do SUPABASE_URL.
      const nextUrl = new URL(`${Deno.env.get('SUPABASE_URL')}/functions/v1/kommo-sync-events`);
      nextUrl.search = url.search;
      const continuation = fetch(nextUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, after: next, hop: hop + 1 }),
      })
        .then(async (res) => {
          if (!res.ok) console.error(`kommo-sync-events: encadeamento hop ${hop + 1} falhou: ${res.status} ${await res.text()}`);
          else await res.body?.cancel();
        })
        .catch((err) => console.error('kommo-sync-events: falha ao encadear', err));
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(continuation);
    }

    console.log(JSON.stringify({ kommo_sync_events: totals }));
    return new Response(JSON.stringify({ ok: true, hop, ...totals, error_details: errors, next, talk_history: { blocked: history.blocked, ...history.totals } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
