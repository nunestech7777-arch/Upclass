import { fetchTalk, fetchTalkMessages, KommoApiError } from './kommo.ts';
import {
  classifyTalkFetchError,
  normalizeTalkMessage,
  planTalkIngest,
  talkMessageAuthorIdentified,
  type StoredTalkRow,
  type TalkContext,
} from './kommoTalkMessages.ts';

/**
 * Sync do histórico oficial dos talks (GET /talks/{id}/messages) — usado pelo kommo-sync-events.
 * Fica fora do index.ts para ser testado contra Postgres real (tests/kommoTalkHistory.integration.test.ts).
 * A gravação é feita por kommo_fill_talk_messages (0019): só preenche marcadores e grava o que falta,
 * sem reescrever mensagens reais, mover ou criar conversas.
 */

// deno-lint-ignore no-explicit-any
type Supa = any;

/** Estado do histórico oficial compartilhado pela invocação (um 403 vale para a conta inteira). */
export interface TalkHistoryState {
  enabled: boolean;
  blocked: { status: number; kind: string } | null;
  totals: {
    talks: number;
    fetched: number;
    inserted: number;
    placeholders_filled: number;
    already_stored: number;
    webhook_duplicate: number;
    skipped: number;
    errors: number;
    talk_not_found: number;
    id_mismatch: number;
    pages_truncated: number;
  };
}

/** Desligado por padrão: liga com o secret KOMMO_TALK_HISTORY=on depois de validar no kommo-talk-probe. */
export function newTalkHistoryState(): TalkHistoryState {
  return {
    enabled: (Deno.env.get('KOMMO_TALK_HISTORY') ?? '').toLowerCase() === 'on',
    blocked: null,
    totals: {
      talks: 0,
      fetched: 0,
      inserted: 0,
      placeholders_filled: 0,
      already_stored: 0,
      webhook_duplicate: 0,
      skipped: 0,
      errors: 0,
      talk_not_found: 0,
      id_mismatch: 0,
      pages_truncated: 0,
    },
  };
}

/**
 * Busca o histórico oficial de cada talk do lead e grava o que falta. A conversa de destino é a
 * mesma onde o talk já tem mensagens; sem isso, o talk precisa estar vinculado a ESTE lead
 * (GET /talks/{id}) e ter o chat de uma conversa já existente do lead — nunca é "chutada" nem criada.
 * Devolve os ids gravados (para não virarem marcador logo em seguida).
 */
export async function syncTalkHistory(
  supabase: Supa,
  state: TalkHistoryState,
  leadId: string,
  talkIds: string[],
  talkToConversation: Map<string, string>,
  chatToConversation: Map<string, string>,
  sinceUnix?: number
): Promise<Set<string>> {
  const written = new Set<string>();
  if (!state.enabled || state.blocked || !talkIds.length) return written;

  for (const talkId of talkIds) {
    if (state.blocked) break;
    state.totals.talks += 1;

    let conversationId = talkToConversation.get(talkId);
    if (!conversationId) {
      const talk = await fetchTalk(talkId);
      conversationId =
        talk?.chat_id && talk.entity_type === 'lead' && talk.entity_id === String(leadId) ? chatToConversation.get(talk.chat_id) : undefined;
      if (!conversationId) {
        state.totals.skipped += 1;
        continue;
      }
    }

    let fetched;
    try {
      fetched = await fetchTalkMessages(talkId, { fromUnix: sinceUnix });
    } catch (err) {
      const status = err instanceof KommoApiError ? err.status : 0;
      const { kind, blocksAll } = classifyTalkFetchError(status);
      if (blocksAll) {
        state.blocked = { status, kind };
        console.error(JSON.stringify({ kommo_talk_history_blocked: state.blocked }));
      } else if (kind === 'talk_not_found') state.totals.talk_not_found += 1;
      else {
        state.totals.errors += 1;
        console.error(`kommo-sync-events: histórico do talk ${talkId} falhou`, String(err).slice(0, 200));
      }
      continue;
    }
    state.totals.fetched += fetched.messages.length;
    if (fetched.truncated) {
      state.totals.pages_truncated += 1;
      console.error(`kommo-sync-events: histórico do talk ${talkId} truncado em ${fetched.pages} páginas`);
    }
    if (!fetched.messages.length) continue;

    // Linhas já gravadas com os mesmos ids (em lotes: a lista vai na URL do PostgREST)...
    const ids = [...new Set(fetched.messages.map((m) => String(m?.id ?? '')).filter(Boolean))];
    const stored: StoredTalkRow[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabase
        .from('conversation_messages')
        .select('external_id, message_type')
        .in('external_id', ids.slice(i, i + 150));
      if (error) throw new Error(`mensagens do talk ${talkId}: ${error.message}`);
      stored.push(...(data ?? []));
    }
    // ...e as mensagens reais do talk no intervalo devolvido: se nenhuma delas tem id da API, os ids
    // são de outro espaço e planTalkIngest recusa gravar (evita duplicar a conversa).
    const times = fetched.messages.map((m) => Number(m?.created_at)).filter((t) => Number.isFinite(t) && t > 0);
    if (times.length) {
      const { data, error } = await supabase
        .from('conversation_messages')
        .select('external_id, message_type')
        .eq('kommo_talk_id', talkId)
        .neq('message_type', 'unavailable')
        .gte('sent_at', new Date(Math.min(...times) * 1000).toISOString())
        .lte('sent_at', new Date((Math.max(...times) + 1) * 1000).toISOString())
        .limit(500);
      if (error) throw new Error(`mensagens reais do talk ${talkId}: ${error.message}`);
      const known = new Set(stored.map((s) => s.external_id));
      stored.push(...(data ?? []).filter((r: StoredTalkRow) => !known.has(r.external_id)));
    }

    const plan = planTalkIngest(fetched.messages, stored);
    state.totals.already_stored += plan.alreadyStored;
    if (plan.idMismatch) {
      state.totals.id_mismatch += 1;
      console.error(`kommo-sync-events: ids do talk ${talkId} não batem com o banco — nada gravado`);
      continue;
    }

    // O chat só satisfaz a normalização: a função SQL grava chat/contato/lead da própria conversa.
    const chatId = [...chatToConversation].find(([, conv]) => conv === conversationId)?.[0] ?? `talk:${talkId}`;
    const ctx: TalkContext = { talk_id: talkId, chat_id: chatId, contact_id: null, entity_type: 'lead', entity_id: String(leadId) };
    const receivedAt = new Date();
    const batch = [];
    for (const m of plan.toIngest) {
      const normalized = normalizeTalkMessage(m, ctx, receivedAt);
      // Sem horário válido do Kommo a mensagem cairia na hora do sync — fica de fora.
      if (!normalized.ok || !normalized.value.timestamp_valid) {
        state.totals.skipped += 1;
        continue;
      }
      batch.push({ ...normalized.value, author_identified: talkMessageAuthorIdentified(m) });
    }

    // 50 por lote: cada item abre uma subtransação (mesmo limite dos marcadores).
    for (let i = 0; i < batch.length; i += 50) {
      const slice = batch.slice(i, i + 50);
      const { data, error } = await supabase.rpc('kommo_fill_talk_messages', {
        p_conversation_id: conversationId,
        p_messages: slice,
      });
      if (error || data?.error) {
        state.totals.errors += 1;
        console.error(`kommo-sync-events: falha ao gravar histórico do talk ${talkId}`, String(error?.message ?? data?.error).slice(0, 200));
        continue;
      }
      state.totals.inserted += data?.inserted ?? 0;
      state.totals.placeholders_filled += data?.filled ?? 0;
      state.totals.already_stored += data?.kept ?? 0;
      state.totals.webhook_duplicate += data?.webhook_duplicate ?? 0;
      state.totals.errors += data?.failed ?? 0;
      for (const m of slice) written.add(m.kommo_message_id);
    }
  }
  return written;
}

/** Talks citados nos eventos de chat do lead. */
// deno-lint-ignore no-explicit-any
export function talksOfEvents(events: any[]): string[] {
  const talks = new Set<string>();
  for (const ev of events ?? []) {
    for (const v of Array.isArray(ev?.value_after) ? ev.value_after : []) {
      const t = v?.message?.talk_id;
      if (t !== undefined && t !== null && String(t) !== '' && String(t) !== '0') talks.add(String(t));
    }
  }
  return [...talks];
}
