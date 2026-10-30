# Kommo + Meu Supervisor — contexto

Leia este arquivo primeiro. Para detalhes, abra **só a seção necessária** de [REFERENCIA.md](REFERENCIA.md). O código e os testes são a fonte definitiva; se divergirem daqui, confie no código e corrija este texto.

## 1. Visão geral
Sistema interno da loja (Upclass / Você de iPhone): React + TypeScript (Vite) no front, Supabase (Postgres + Edge Functions em Deno) no back. As conversas de WhatsApp (Cloud API = `waba`, Lite = `com.amocrm.amocrmwa`) e Instagram (`instagram_business`) chegam pelo **Kommo**. A área **Meu Supervisor** (`/supervisor`, só administradores) mostra atendimento, desempenho e prepara a futura **Análise IA** (desativada).

## 2. Arquitetura da integração
- **Webhook** `supabase/functions/kommo-webhook` recebe mensagens recebidas (`message add`) e enviadas (`add_outgoing_message`, desde 27/10/2026). Grava o payload bruto em `kommo_webhook_events` e ingere via `ingestWebhookPayload` (`_shared/kommoIngest.ts`) → função SQL `kommo_ingest_message` (migração 0006).
- **Complemento por eventos** `kommo-sync-events` (cron a cada 5 min, `global`): busca na events API mensagens que o webhook não entregou e grava **marcadores sem texto** (`message_type = 'unavailable'`) com autor e horário reais (`kommo_insert_event_placeholders`, 0012).
- **Usuários do Kommo** em `kommo_users`, atualizados por `kommo-sync` (botão em Configurações) e automaticamente a cada 6 h (`_shared/kommoUsers.ts`).
- **Vínculo vendedor ↔ usuário Kommo**: `sellers.kommo_user_id` (tela Meu Supervisor → Configurações).

## 3. Regras fundamentais (não quebrar)
1. **Atendente = autor da mensagem**, nunca o responsável do lead. Mensagem de vendedor tem `sender = 'seller'` e `sender_id` = id do usuário no Kommo. `conversations.seller_id` é o responsável do lead (pode ser quem só distribuiu) e **não** prova atendimento.
2. **EMERSON SUPERVISOR** (usuário Kommo `11336555`) é a conta de distribuição: não está vinculado a vendedor. Só aparece como atendente quando ele mesmo enviou mensagem no período.
3. **Tipo do autor** (`outgoingKind`, `src/lib/supervisor/attendance.ts`): vendedor com id = humano identificado; autor com nome de canal ("WhatsApp Lite", "Instagram"…) = enviado pelo aparelho (humano **não identificado**), ou resposta pronta se o mesmo texto aparece em 3+ conversas; Salesbot = automático; "Automação ou envio externo" (marcador sem texto) = autor desconhecido.
4. **Período**: dias no fuso de Brasília (UTC−3), fim exclusivo. Status, atendentes e "clientes sem resposta" usam **só mensagens do período**. Respostas até 24 h depois entram **apenas** no tempo de resposta.
5. **Nunca inventar** atendente, nota ou avaliação. Sem evidência: "Atendente não identificado" / "Status não determinado".

## 4. Métricas principais
- **Status por conversa** (um só, sem duplicar): atendida, não atendida, atendente não identificado, atendimento automático, status não determinado. Sinal à parte: **aguardando distribuição** (sem resposta humana e o lead está **hoje** com quem não é vendedor ativo) — só em períodos que incluem hoje.
- **Conversas únicas** × **Conversas processadas — critério Kommo** (por autor, atendimentos/talks distintos com mensagem dele; Robô soma cada autor automático; total = soma das linhas). Conferido com o painel oficial do Kommo.
- Tempo de resposta (1ª mensagem do cliente → 1ª resposta humana), taxa de resposta do período, clientes sem resposta no fim do período, desempenho por atendente (conversa com 2 atendentes conta para os dois).

## 5. Correções já feitas (não repetir os erros)
- O sistema atribuía conversa ao responsável do lead → passou a usar o autor da mensagem.
- Respostas do dia seguinte inflavam o dia anterior (EMERSON aparecia com 7 em 28/10 sem ter enviado nada) → atribuição só com mensagens do período.
- "Aguardando distribuição" usava o responsável de hoje em dias passados → oculto em períodos históricos.
- Período escolhido por `occurred_at` perdia conversas continuadas depois → conversa entra se tem mensagem do cliente ou humana no período (candidatas com 7 dias de folga).
- A Análise IA filtrava avaliações por `seller_id` → agora por autor (`fetchAnalyzedConversations(kommoUserId)`).

## 6. Análise IA (preparada, DESATIVADA)
- Nenhuma chamada de IA existe: `aiEvaluation.ts` e `aiCriteria.ts` são puros (sem rede/banco) e um teste falha se eles ou `SupervisorAiAnalysis.tsx` ganharem chamada de rede. A página só lê o banco como o resto do Supervisor.
- `buildEvaluationTargets` (`src/lib/supervisor/aiEvaluation.ts`) gera **um alvo por participante humano identificado**, com só as mensagens dele (`ownMessageIds`), o contexto completo, os demais participantes, período e `ATTRIBUTION_RULE_VERSION`. Só vendedor vinculado é elegível.
- `buildAnalysisTranscript` (`aiCriteria.ts`) rotula "Vendedor avaliado", "Outro atendente", "Robô", "Atendente não identificado".
- Ativar exige autorização do dono (custo de API) e decidir onde guardar avaliações por participante (hoje só existe `conversations.score/summary/strengths/improvements`, uma por conversa).

## 7. Limitações conhecidas
- O Kommo não diz quem digitou mensagens enviadas pelo aparelho; o painel dele as põe em "Robô", nós em "atendente não identificado".
- Antes de 27/10/2026 parte das respostas só existe como marcador sem autor → "status não determinado".
- O responsável do lead só é conhecido no momento atual (não há histórico de distribuição gravado).
- O painel do Kommo conta **eventos** de mensagem; o banco guarda mensagens únicas (ex.: 1.181 × 1.180 em 28/10 por um evento duplicado no Kommo).

## 8. Pendências
- `KOMMO_TALK_HISTORY` continua desligado (token sem escopo de histórico).
- Armazenamento de avaliações por participante (sem tabela criada).
- Assinatura de teste antiga do Kommo ainda envia duplicatas para `kommo-outgoing-probe` (inofensivo; remoção só pelo suporte do Kommo).

## 9. Arquivos principais
| Assunto | Caminho |
|---|---|
| Classificação e critério Kommo | `src/lib/supervisor/attendance.ts` |
| Métricas, período, tempo de resposta | `src/lib/supervisor/metrics.ts` |
| Consultas e montagem do período | `src/lib/supervisor/supervisorApi.ts` (`loadPeriodBase`, `loadPeriodSummary`) |
| Análise IA | `src/lib/supervisor/aiEvaluation.ts`, `aiCriteria.ts` |
| Telas | `src/pages/supervisor/*`, `src/components/supervisor/*` |
| Integração | `supabase/functions/kommo-*`, `supabase/functions/_shared/kommo*.ts` |

## 10. Como continuar
1. Identifique a área (integração, métricas, telas ou IA) e leia só a seção correspondente da REFERENCIA.
2. Leia o código citado antes de mudar; reaproveite `attendance.ts`/`metrics.ts`, não crie outra regra de atribuição.
3. Valide e respeite as regras de segurança e de atualização da documentação do `CLAUDE.md` (raiz).
