-- Ranking de Conversão do Dashboard: conversas atendidas por usuário do Kommo num intervalo.
--
-- Atendimento = conversa distinta com ao menos uma mensagem humana (sender = 'seller') cujo autor
-- (sender_id = usuário do Kommo) foi registrado, enviada dentro de [p_from, p_to). Mesma regra de
-- autoria do Meu Supervisor; o responsável do lead não entra.
--
-- Índice parcial só das mensagens humanas com autor (cerca de metade da tabela), com autor e conversa
-- junto: sem ele a contagem de um mês lê a tabela inteira (23 s medidos em 02/11/2026, acima do tempo
-- limite da API). Sem tabela nova e sem mudar dado nenhum.
create index if not exists idx_conversation_messages_human_author_sent
  on conversation_messages (sent_at) include (sender_id, conversation_id)
  where sender = 'seller' and sender_id is not null;

-- Só leitura. SECURITY INVOKER: roda com a RLS de quem chama (conversation_messages
-- já é só de administrador, 0017) — devolve só contagens, nunca texto ou dados do cliente.
create or replace function public.kommo_attended_conversations(p_from timestamptz, p_to timestamptz)
returns table (kommo_user_id text, conversations bigint)
language sql stable security invoker set search_path = public as $$
  select m.sender_id, count(distinct m.conversation_id)
  from conversation_messages m
  where m.sender = 'seller'
    and m.sender_id is not null
    and m.sent_at >= p_from
    and m.sent_at < p_to
  group by m.sender_id
$$;

revoke all on function public.kommo_attended_conversations(timestamptz, timestamptz) from public, anon;
grant execute on function public.kommo_attended_conversations(timestamptz, timestamptz) to authenticated, service_role;
