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
11. [Cache e carregamento](#11-cache-e-carregamento)
12. [Ranking de Conversão (Dashboard)](#12-ranking-de-conversão-dashboard)

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
- **Sem resposta × Não atendida** (conciliado em 02/11/2026, out/2026): "Não atendida" = nenhuma resposta humana no período; "Sem resposta" = cliente esperando no fim do período, inclusive conversas atendidas antes. Toda não atendida está em "sem resposta". 897 = 438 não atendidas + 286 atendidas com nova mensagem pendente no fim + 159 não determinadas + 10 só automáticas + 4 atendente não identificado. Card da Visão geral (`AwaitingCard`, `awaitingBreakdown` em `src/lib/supervisor/awaiting.ts`): agrupa `summary.awaitingList` (mesmo predicado do total, inclusive com filtro de vendedor) pela situação de atendimento; selo "Conferida" = lista sem repetição, igual ao total e toda classificada. Cada categoria abre `/supervisor/conversas?pendente=<categoria>`.
- **Critério Kommo** (`kommoProcessedConversations`): por usuário, talks distintos com mensagem dele; Robô = Σ por autor não-usuário (Salesbot, nomes de canal); total = soma; "Automação ou envio externo" fica fora.

## 6. Datas e períodos
`rangeToInstants` (`filters.ts`): `AAAA-MM-DDT00:00:00-03:00`, fim exclusivo (Brasília sem horário de verão). Transcrição (`transcriptPeriodView` em `src/lib/transcript.ts`, `ConversationThread`): mostra o histórico completo, mas marca as mensagens fora do período escolhido ("Resposta posterior ao período selecionado — não altera o status de …") e separa os contadores "No período" (definem o status) e "Histórico exibido". Só exibição; o status continua usando só as mensagens do período. Candidatas: `occurred_at ≥ início − 7 dias`. Mensagens: `[início, min(agora, fim + 24 h))`. `responsibles = 'historical'` quando `range.to < storeToday()`.

## 7. Análise IA
- `buildEvaluationTargets(conversationId, messages, period, sellerByKommoUser)` (`aiEvaluation.ts`): usa `classifyAttendance`; um alvo por usuário Kommo que enviou mensagem humana no período; `ownMessageIds` só dele, `contextMessageIds` da conversa toda (sem duplicar), `otherParticipants`, contagens de aparelho/automático/desconhecido, `attribution: 'autor_da_mensagem'`, `ruleVersion = ATTRIBUTION_RULE_VERSION`. Elegível = vendedor vinculado.
- Quem chama passa só vendedores **ativos** em `sellerByKommoUser` e marca `template` nas mensagens (como `loadPeriodBase`).
- `ConversationEvaluation` (`aiCriteria.ts`): chave futura (conversa, usuário Kommo, hash dos `messageIds`, versão) — as mesmas mensagens não são avaliadas duas vezes em períodos diferentes. Não há tabela para avaliação por participante — criar só quando a IA for autorizada.
- `fetchAnalyzedConversations(kommoUserId)` filtra pelo autor (mensagens `seller` com aquele `sender_id`); hoje olha as 500 avaliações mais recentes (rever ao ativar a IA). Avaliação salva em `conversations` é por conversa e aparece para todos os atendentes dela.
- Garantia: `aiEvaluation.test.ts` falha se `aiEvaluation.ts`, `aiCriteria.ts` ou `SupervisorAiAnalysis.tsx` tiverem chamada de rede/IA.

## 8. Auditoria de 28/10/2026
Referências de regressão (calcule, não fixe no código): critério Kommo 239 (Yasmin 75, Caroline 30, Karen 30, Thuane 26, Amanda 9, Robô 69 = Salesbot 59 + Instagram 4 + WhatsApp Lite 3 + WhatsApp Business 3, em 67 talks distintos); Emerson 0; enviadas 1.400 (Cloud API 936, Instagram 430, Lite 34); recebidas 1.180 distintas (painel do Kommo: 1.181 eventos — a mensagem `e0bc59d5…` do Instagram veio em 2 eventos); conversas únicas 191; não atendidas 28; 2+ atendentes 17; clientes sem resposta 58. Conferir eventos: `kommo-talk-probe?chat_events_day=2026-10-28`.

## 9. Testes e comandos
- Lógica: `src/lib/supervisor/{attendance,aiEvaluation,supervisor,kommoUsers,swrStore}.test.ts` (`swrStore` = cache e política, seção 11); integração: `supabase/functions/_shared/{kommoMessage,kommoTalkMessages,sellerBackfill}.test.ts`.
- `npm test` (todos), `node --test src/lib/supervisor/*.test.ts`, `npx tsc -b`, `npx oxlint src supabase/functions`, `npx vite build`.
- SQL só leitura: `npx supabase db query --linked -o csv -f arquivo.sql`. Deploy: `npx supabase functions deploy <fn> --project-ref kcbjaknpaezmjiafdgpe` (só com autorização). Nunca `db push`.

## 10. Problemas conhecidos e decisões
- **Decisão:** atribuição sempre por autor; `conversations.seller_id` fica como está (outras telas e o backfill dependem dele) e não é usado como prova.
- **Decisão:** nada de cálculo novo no banco; tudo derivado das mensagens no front, sem migração.
- **Decisão:** envio pelo aparelho com texto único = humano não identificado (o Kommo põe no Robô); mostramos os dois números.
- Responsável histórico do lead não existe no banco; só o atual (Edge Function, cache de 5 min, tempo limite de 12 s).
- Se a CLI do Supabase der 403, ela pode estar logada em outra conta.

## 11. Cache e carregamento
- **Onde:** só na memória da aba (`swrStore.ts`, sem biblioteca), nunca em localStorage/IndexedDB; nada de token no cache. Some ao fechar ou recarregar a aba.
- **O quê / chave:** `supervisorApi.ts` guarda os dados-base do período (conversas, mensagens sem texto, classificação) com a chave `conta:papel|de|até|canal|live/past` (`cachePolicy.periodCacheKey`; a marca muda na virada do dia, e o dia que fechou é buscado de novo, completo), no máximo 10 períodos na memória. O filtro de atendente é aplicado em memória (`derivePeriodSummary`, memorizado por base + atendente). Também em cache: vendedores e usuários do Kommo (10 min), avaliações salvas (5 min), respostas prontas do canal (10 min) e responsáveis dos leads (5 min).
- **Prazo:** período com hoje 2 min; só dias passados 30 min (`cachePolicy.ts`). Vencido, a tela mostra o dado guardado na hora e atualiza em segundo plano (stale-while-revalidate). Revalida ao abrir e ao voltar para a aba; sozinho, a cada 3 min, só com hoje num período de até 7 dias e a aba visível (cada ciclo refaz o período inteiro — períodos longos só pelo botão ou ao voltar).
- **Duas etapas:** o banco responde primeiro e a tela aparece; o responsável atual dos leads (Kommo, ~2 s) chega depois e só completa "aguardando distribuição" (`responsibles = 'pending'` → "…").
- **Invalidação:** botão de atualizar no topo (ignora o prazo; reaproveita busca em andamento); mudança de vínculo vendedor ↔ Kommo ou sincronização de usuários (`invalidateSupervisorData`); logout, troca de conta ou de papel apagam tudo (`setSupervisorCacheScope` no `SupervisorLayout` + `onAuthStateChange`), e respostas de buscas iniciadas antes são descartadas.
- **Falha:** os dados anteriores continuam, com o aviso "Falha ao atualizar · dados de HH:MM" e o botão para tentar de novo (`SupervisorFreshness.tsx`).
- **Medido em 01/11/2026 (Este mês, dev local):** 1º acesso 4–10,7 s → 0,9 s até os indicadores (2,4 s com o Kommo); volta em até 1 min 87 ms → 0,17 s e 0 requisições; volta após 2 min 1,5 s com tela em "carregando" e 24 requisições → 0,25 s com o dado guardado e 19 requisições em segundo plano.
- **Limitações:** cada aba tem seu cache; dado corrigido no banco de um dia passado aparece em até 30 min (ou no botão); vendedor cadastrado/renomeado em outra tela aparece em até 10 min; o botão "Atualizar" refaz o período, não as avaliações salvas (5 min); cada atualização refaz o período inteiro (não há busca incremental).

## 12. Ranking de Conversão (Dashboard)
Fica só no Dashboard principal (não no Meu Supervisor). Aprovado em 02/11/2026.
- **Índice:** vendas por atendimento = pedidos ÷ atendimentos × 100. **Não é taxa real de conversão:** a venda do MercadoPhone só traz `clienteNome` (sem telefone/CPF), então não há vínculo confiável conversa → venda; vendas de balcão também contam e o índice pode passar de 100%.
- **Atendimento (Kommo):** conversa distinta com ≥1 mensagem `sender='seller'` com `sender_id` (autor, mesma regra do §4) em [início, fim) do período, UTC−3 — conta a mensagem no período, sem a janela de conversas candidatas do Supervisor (diferença mínima possível). Dois atendentes → conta para os dois. Bot, resposta pronta, envio pelo aparelho e responsável do lead não contam. Contado no banco: `kommo_attended_conversations(p_from, p_to)` (migração 0021, SECURITY INVOKER — RLS só admin) com índice parcial `idx_conversation_messages_human_author_sent` (sem ele, um mês levou 23 s e estoura o tempo limite da API; com ele, 0,1–0,4 s). Aplicada em produção em 02/11/2026 via `db query --linked -f` (não `db push`).
- **Venda (MercadoPhone):** pedido distinto (`mp_order_id`) com ≥1 item ativo do vendedor do item que não seja brinde, por `sold_date`. Pedido com dois vendedores conta para os dois; cancelados fora.
- **Vínculos:** vendedor do item = vendedor MercadoPhone (`sellers.external_id`); Kommo por `sellers.kommo_user_id` (nunca por nome). Sem vínculo Kommo ou sem atendimentos no período: fora do card do Dashboard (decisão do dono, 02/11); na tela Vendedores aparecem sem posição ("Sem vínculo Kommo" / "Sem atendimentos", nunca 0%).
- **Elegíveis:** vendedores ativos e visíveis no ranking. Posição só com ≥ 30 atendimentos (`MIN_ATTENDANCES`); abaixo aparece sem posição. Desempate: pedidos, atendimentos, nome.
- **Datas:** vendas pela data da venda (não do lançamento); a loja lança 1–6 dias depois com data retroativa → aviso "Vendas em lançamento" quando o período alcança os últimos 6 dias.
- **Cache:** só memória, chave conta + período + live/past; TTL do §11; só o clique em Atualizar força; trocar de período reaproveita o valor em cache.
- **Pedido sem `mp_order_id`:** cada linha conta como um pedido (não ocorreu em out/2026).
- **Fonte única (02/11/2026):** a mesma conta alimenta o card do Dashboard, a tela Vendedores (aba "Por Conversão", "Maior Conversão", "Taxa de Conversão" de cada card, com "N atendimentos · N vendas") e o KPI CONVERSÃO do relatório do vendedor (mês do relatório). Funções: `buildConversionRanking` (cálculo), `sortByConversion` (ordem e posições dos cards; quem não se classifica fica "Sem posição"), `conversionLeader` (1º classificado; sem ele "Sem dados suficientes"), `conversionText` (texto; nunca "0%" para dado ausente). Hook `useConversionRanking` (vendas de `loadDashboard` + atendimentos da 0021, ambos em cache). A taxa antiga por `conversations.result_type` (nunca preenchido → 0%) saiu dessas telas; `computeSellerPerformance.conversion` só sobra no Painel TV, que não a exibe.
- **Arquivos:** `src/lib/finance/conversionRanking.ts` (regra), `conversionApi.ts` (consulta/cache), `src/components/dashboard/ConversionRanking.tsx`, `useConversionRanking.ts`, `src/pages/Dashboard.tsx`, `Sellers.tsx`, `SellerReport.tsx`.
- **Testes:** `src/lib/finance/conversionRanking.test.ts`, `supabase/tests/kommoAttendedConversations.integration.test.ts`.
- **Diagnóstico out/2026:** Yasmim 1.132 atend./58 pedidos, Karen 830/48, Thuane 903/40, Caroline 754/36, Amanda 297/3; Graciane e Anderson sem vínculo Kommo; July vinculada sem mensagens desde 24/08; usuário "EMERSON SUPERVISOR" (381 conversas) sem vendedor vinculado.
