# Kommo + Meu Supervisor — referência

Consulte só a seção necessária (o resumo está em [CONTEXTO.md](CONTEXTO.md)). Nunca registre tokens, secrets, telefones ou textos de clientes aqui.

**Índice**
1. [Endpoints, webhooks e funções](#1-endpoints-webhooks-e-funções)
2. [Fluxo das mensagens](#2-fluxo-das-mensagens)
3. [Tabelas e campos](#3-tabelas-e-campos)
4. [Classificação do autor e do status](#4-classificação-do-autor-e-do-status)
5. [Fórmulas das métricas](#5-fórmulas-das-métricas)
6. [Datas e períodos](#6-datas-e-períodos)
7. [Análise IA](#7-análise-ia)
8. [Auditoria de 28/10/2026](#8-auditoria-de-28102026)
9. [Testes e comandos](#9-testes-e-comandos)
10. [Problemas conhecidos e decisões](#10-problemas-conhecidos-e-decisões)

## 1. Endpoints, webhooks e funções
Cliente da API v4 do Kommo: `supabase/functions/_shared/kommo.ts` (`call`, limitador ~7 req/s; secrets `KOMMO_SUBDOMAIN`, `KOMMO_API_TOKEN`).

| Endpoint Kommo | Função em `kommo.ts` |
|---|---|
| `GET users` | `fetchAllUsers` |
| `GET leads/{id}`, `GET leads?filter[id][]=` | `fetchLead`, `fetchLeadResponsibles` |
| `GET events` (incoming/outgoing_chat_message) | `fetchLeadChatMessageEvents`, `fetchRecentChatEvents`, `fetchChatEventsBetween` |
| `GET talks/{id}`, `GET talks/{id}/messages` | `fetchTalk`, `fetchTalkMessages` (histórico; desligado por `KOMMO_TALK_HISTORY`) |
| `GET/POST/DELETE webhooks` | `fetchWebhooks`, `setWebhook` |

Edge Functions (`supabase/functions/`, `verify_jwt` em `supabase/config.toml`):

| Função | Acesso | Papel |
|---|---|---|
| `kommo-webhook` | `?secret=KOMMO_WEBHOOK_SECRET` | Recebe `message add` e `add_outgoing_message`; grava bruto e ingere |
| `kommo-sync-events` | secret | Cron: marcadores para mensagens não entregues; renova `kommo_users` (6 h) |
| `kommo-reprocess` | secret | Cron: reprocessa eventos com falha |
| `kommo-sync` | admin ativo ou service role | Sincroniza `kommo_users` |
| `kommo-lead-responsibles` | admin ativo ou service role | Responsável ATUAL dos leads (só leitura) |
| `kommo-seller-backfill` | service role | Preenche `conversations.seller_id` nulo (simulação por padrão) |
| `kommo-talk-probe` | service role | Diagnóstico só leitura: `?talk_id`, `?token_info=1`, `?webhooks=1`, `?chat_events_day=AAAA-MM-DD&type=incoming\|outgoing` |
| `kommo-audit`, `kommo-outgoing-probe` | secret | Diagnóstico / assinatura de teste antiga |

Crons (`cron.job`, criados no banco a partir de `supabase/cron.kommo.sql.example`, não por migração): `kommo-sync-events-recent` (*/5, global), `kommo-sync-events-followup` (06:40 UTC), `kommo-reprocess-failed` (*/10), `mercadophone-sync-30min` (*/30, outra integração — não mexer).

## 2. Fluxo das mensagens
1. Kommo → `kommo-webhook` → insere `kommo_webhook_events` (payload bruto) → `extractWebhookMessages` / `extractOutgoingWebhookMessages` → `normalizeKommoMessage` (`_shared/kommoMessage.ts`; `classifySender`: `incoming` = cliente, `outgoing` = vendedor/bot/sistema por `author.type`) → `ingestWebhookPayload` (`_shared/kommoIngest.ts`) → SQL `kommo_ingest_message` (0006): acha/cria a conversa, grava a mensagem (deduplica por `external_id`), atualiza `occurred_at`, resolve `seller_id` pelo responsável do lead **só quando nulo**.
2. `kommo-sync-events` compara eventos da events API com o banco (`planPlaceholders`) e insere marcadores via `kommo_insert_event_placeholders` (0012): `created_by > 0` = vendedor (`sender_id`), `0` = "Automação ou envio externo". Marcadores não mudam `occurred_at` (0009).
3. Front (`supervisorApi.ts`): `loadPeriodBase` → candidatas, mensagens, respostas prontas, `conversationsInPeriod`, `classifyConversations`, `kommoProcessedConversations`, responsável (se o período inclui hoje) → `loadPeriodSummary` aplica o filtro de atendente e `summarize`.

## 3. Tabelas e campos
- `conversations`: `id`, `seller_id` (**responsável do lead**, não atendente), `client_name`, `occurred_at` (última mensagem real), `kommo_lead_id`, `kommo_chat_id`, `raw_payload->>'origin'` (canal), `score`/`summary`/`strengths`/`improvements` (avaliação futura; hoje vazios).
- `conversation_messages`: `conversation_id`, `external_id` (id Kommo, único), `kommo_talk_id`, `sender` (`client|seller|bot|system`), `sender_id` (usuário Kommo para `seller`), `sender_name`, `message_type` (`unavailable` = marcador), `direction`, `sent_at` (UTC), `received_seq` (desempate), `raw_payload->>'origin'`.
- `kommo_users` (`id`, `name`, `synced_at`), `sellers.kommo_user_id` (vínculo), `kommo_webhook_events` (`payload`, `received_at`, `processed`, `error`, `result->>'probe'`).
- RLS: leitura só admin (`is_admin()`, 0017). Consultas pesadas em `kommo_webhook_events` estouram o tempo limite: janelas curtas e em sequência.

## 4. Classificação do autor e do status
`outgoingKind` (`attendance.ts`):

| Mensagem | Tipo |
|---|---|
| `seller` com `sender_id` | `human` (identificado) |
| `seller` sem id; `bot` com nome de canal e texto único | `external` (humano não identificado) |
| `bot` Salesbot/Bot; nome de canal com texto repetido em 3+ conversas (`templateTexts`, janela 14 dias + período) | `automatic` |
| `bot` "Automação ou envio externo", sem nome, ou qualquer `bot` não-Salesbot com `unavailable` | `unknown` |

`classifyAttendance` (ordem): algum `human` → **atendida** (atendentes em ordem de 1ª resposta, com contagem); senão `external` → **atendente não identificado**; senão `unknown` → **não determinado**; senão `automatic` → **automático**; senão cliente escreveu → **não atendida**; senão **não determinado**. `awaitingDistribution` = (não atendida ou automático) e responsável atual conhecido e não vinculado a vendedor **ativo**.

## 5. Fórmulas das métricas
- **Conversa no período** (`conversationsInPeriod`): mensagem do cliente ou humana (`human`/`external`) antes do fim; `period_last_at` = última delas.
- **Desempenho por atendente** (`summarize`): conversas em que ele é atendente; uma conversa com 2 atendentes conta para os 2 (total não duplica).
- **Tempo de resposta** (`conversationStats`): 1ª mensagem do cliente → 1ª resposta humana; resposta até 24 h após o fim fecha a rodada; rodada fica com quem respondeu; gráfico por dia usa o dia da mensagem do cliente (`openedAt`).
- **Clientes sem resposta**: última mensagem do cliente sem resposta humana **no fim do período**. **Taxa de resposta** = `answeredInPeriod / (answeredInPeriod + awaiting)`.
- **Critério Kommo** (`kommoProcessedConversations`): por usuário, talks distintos com mensagem dele; Robô = Σ por autor não-usuário (Salesbot, nomes de canal); total = soma; "Automação ou envio externo" fica fora.

## 6. Datas e períodos
`rangeToInstants` (`filters.ts`): `AAAA-MM-DDT00:00:00-03:00`, fim exclusivo (Brasília sem horário de verão). Candidatas: `occurred_at ≥ início − 7 dias`. Mensagens: `[início, min(agora, fim + 24 h))`. `responsibles = 'historical'` quando `range.to < storeToday()`.

## 7. Análise IA
- `buildEvaluationTargets(conversationId, messages, period, sellerByKommoUser)` (`aiEvaluation.ts`): usa `classifyAttendance`; um alvo por usuário Kommo que enviou mensagem humana no período; `ownMessageIds` só dele, `contextMessageIds` da conversa toda (sem duplicar), `otherParticipants`, contagens de aparelho/automático/desconhecido, `attribution: 'autor_da_mensagem'`, `ruleVersion = ATTRIBUTION_RULE_VERSION`. Elegível = vendedor vinculado.
- Quem chama passa só vendedores **ativos** em `sellerByKommoUser` e marca `template` nas mensagens (como `loadPeriodBase`).
- `ConversationEvaluation` (`aiCriteria.ts`): chave futura (conversa, usuário Kommo, hash dos `messageIds`, versão) — as mesmas mensagens não são avaliadas duas vezes em períodos diferentes. Não há tabela para avaliação por participante — criar só quando a IA for autorizada.
- `fetchAnalyzedConversations(kommoUserId)` filtra pelo autor (mensagens `seller` com aquele `sender_id`); hoje olha as 500 avaliações mais recentes (rever ao ativar a IA). Avaliação salva em `conversations` é por conversa e aparece para todos os atendentes dela.
- Garantia: `aiEvaluation.test.ts` falha se `aiEvaluation.ts`, `aiCriteria.ts` ou `SupervisorAiAnalysis.tsx` tiverem chamada de rede/IA.

## 8. Auditoria de 28/10/2026
Referências de regressão (calcule, não fixe no código): critério Kommo 239 (Yasmin 75, Caroline 30, Karen 30, Thuane 26, Amanda 9, Robô 69 = Salesbot 59 + Instagram 4 + WhatsApp Lite 3 + WhatsApp Business 3, em 67 talks distintos); Emerson 0; enviadas 1.400 (Cloud API 936, Instagram 430, Lite 34); recebidas 1.180 distintas (painel do Kommo: 1.181 eventos — a mensagem `e0bc59d5…` do Instagram veio em 2 eventos); conversas únicas 191; não atendidas 28; 2+ atendentes 17; clientes sem resposta 58. Conferir eventos: `kommo-talk-probe?chat_events_day=2026-10-28`.

## 9. Testes e comandos
- Lógica: `src/lib/supervisor/{attendance,aiEvaluation,supervisor,kommoUsers}.test.ts`; integração: `supabase/functions/_shared/{kommoMessage,kommoTalkMessages,sellerBackfill}.test.ts`.
- `npm test` (todos), `node --test src/lib/supervisor/*.test.ts`, `npx tsc -b`, `npx oxlint src supabase/functions`, `npx vite build`.
- SQL só leitura: `npx supabase db query --linked -o csv -f arquivo.sql`. Deploy: `npx supabase functions deploy <fn> --project-ref kcbjaknpaezmjiafdgpe` (só com autorização). Nunca `db push`.

## 10. Problemas conhecidos e decisões
- **Decisão:** atribuição sempre por autor; `conversations.seller_id` fica como está (outras telas e o backfill dependem dele) e não é usado como prova.
- **Decisão:** nada de cálculo novo no banco; tudo derivado das mensagens no front, sem migração.
- **Decisão:** envio pelo aparelho com texto único = humano não identificado (o Kommo põe no Robô); mostramos os dois números.
- Responsável histórico do lead não existe no banco; só o atual (Edge Function, cache de 5 min, tempo limite de 12 s).
- Se a CLI do Supabase der 403, ela pode estar logada em outra conta.
