# Upclass / Você de iPhone — instruções para agentes

Sistema interno de gestão da loja: React + TypeScript (Vite) e Supabase (Postgres + Edge Functions). Responda ao usuário em português.

## Kommo e Meu Supervisor
- Antes de mexer na integração Kommo, no Meu Supervisor (`/supervisor`) ou na Análise IA, leia **só** `docs/kommo-supervisor/CONTEXTO.md`. Abra `docs/kommo-supervisor/REFERENCIA.md` apenas na seção que a tarefa exigir (há índice no topo).
- Agentes especializados leem só o necessário: frontend → CONTEXTO + componentes em `src/pages/supervisor` e `src/components/supervisor`; backend → CONTEXTO + seções 1–3 da REFERENCIA; auditor → seções 5, 8 e 9.
- Sempre que uma alteração modificar a integração Kommo, as métricas do Meu Supervisor, a identificação dos atendentes ou a arquitetura da Análise IA, atualize a documentação técnica correspondente na mesma tarefa — só o trecho afetado, sem duplicar conteúdo. O código e os testes continuam sendo a fonte definitiva.

## Segurança
- Sem commit, push, deploy (Vercel ou Edge Functions), `db push`, migração ou chamada paga de IA sem autorização explícita do usuário.
- Não alterar migrações existentes, não apagar dados e não mexer na integração MercadoPhone sem pedido.
- Nunca imprimir tokens, secrets, telefones ou textos de clientes em logs, saídas ou documentos.

## Validação
`npm test`, `npx tsc -b`, `npx oxlint src supabase/functions`, `npx vite build`.
