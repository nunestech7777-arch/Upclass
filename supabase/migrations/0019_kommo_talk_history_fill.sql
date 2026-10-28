-- Grava o histórico oficial dos talks (GET /api/v4/talks/{id}/messages) de forma conservadora.
-- Diferente de kommo_ingest_message (pensada para o webhook), esta função:
--   * só preenche MARCADORES (message_type = 'unavailable'); mensagens reais já gravadas nunca são reescritas;
--   * não move a linha de conversa, não cria conversa e não mexe em conversations.occurred_at
--     (mesma regra dos marcadores, 0009) nem em kommo_chat_id/kommo_contact_id/kommo_lead_id;
--   * só troca o autor do marcador quando a API identifica alguém (author_identified = true) — senão
--     mantém o vendedor que a events API (created_by) já conhecia;
--   * incoming com id desconhecido é descartado se a conversa já tem a mesma mensagem real do cliente
--     (mesmo texto, ±2s): é a do webhook com outro id, e gravar duplicaria a transcrição.
-- Reverter: drop function kommo_fill_talk_messages(uuid, jsonb); (não altera tabelas)

create or replace function kommo_fill_talk_messages(p_conversation_id uuid, p_messages jsonb) returns jsonb
language plpgsql
as $$
declare
  v_conv conversations%rowtype;
  v_item record;
  v_existing record;
  v_id uuid;
  v_sent_at timestamptz;
  v_identified boolean;
  v_inserted integer := 0;
  v_filled integer := 0;
  v_kept integer := 0;
  v_webhook_duplicate integer := 0;
  v_failed integer := 0;
begin
  -- Mesmo lock da ingestão do webhook e dos marcadores: serializa gravações da conversa.
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('error', 'conversation_not_found');
  end if;

  for v_item in
    select e.value as m from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) with ordinality e order by e.ordinality
  loop
    begin
      v_sent_at := (v_item.m->>'sent_at')::timestamptz;
      v_identified := coalesce((v_item.m->>'author_identified')::boolean, false);

      select id, message_type into v_existing
      from conversation_messages
      where external_id = v_item.m->>'kommo_message_id'
      for update;

      if found then
        if v_existing.message_type <> 'unavailable' then
          v_kept := v_kept + 1;
          continue;
        end if;
        update conversation_messages cm set
          message = coalesce(v_item.m->>'message_text', ''),
          message_type = coalesce(v_item.m->>'message_type', 'text'),
          sender = case when v_identified then v_item.m->>'sender_type' else cm.sender end,
          sender_id = case when v_identified then coalesce(v_item.m->>'sender_id', cm.sender_id) else cm.sender_id end,
          sender_name = case when v_identified then coalesce(v_item.m->>'sender_name', cm.sender_name) else cm.sender_name end,
          sent_at = v_sent_at,
          created_at_original = coalesce(v_item.m->>'created_at_original', cm.created_at_original),
          timestamp_valid = true,
          raw_payload = coalesce(cm.raw_payload, v_item.m->'raw_payload'),
          updated_at = now()
        where cm.id = v_existing.id;
        v_filled := v_filled + 1;
        continue;
      end if;

      if v_item.m->>'direction' = 'incoming' and exists (
        select 1 from conversation_messages x
        where x.conversation_id = p_conversation_id
          and x.direction = 'incoming'
          and x.message_type <> 'unavailable'
          and x.message = coalesce(v_item.m->>'message_text', '')
          and x.sent_at between v_sent_at - interval '2 seconds' and v_sent_at + interval '2 seconds'
      ) then
        v_webhook_duplicate := v_webhook_duplicate + 1;
        continue;
      end if;

      v_id := null;
      insert into conversation_messages (
        external_id, conversation_id, sender, sender_id, sender_name, message, message_type, direction,
        sent_at, created_at_original, timestamp_valid, kommo_talk_id, kommo_chat_id, kommo_lead_id,
        kommo_contact_id, kommo_entity_type, kommo_entity_id, raw_payload
      ) values (
        v_item.m->>'kommo_message_id', v_conv.id, v_item.m->>'sender_type', v_item.m->>'sender_id',
        v_item.m->>'sender_name', coalesce(v_item.m->>'message_text', ''), coalesce(v_item.m->>'message_type', 'text'),
        v_item.m->>'direction', v_sent_at, v_item.m->>'created_at_original', true, v_item.m->>'kommo_talk_id',
        v_conv.kommo_chat_id, v_conv.kommo_lead_id, v_conv.kommo_contact_id,
        case when v_conv.kommo_lead_id is not null then 'lead' end, v_conv.kommo_lead_id, v_item.m->'raw_payload'
      )
      on conflict (external_id) do nothing
      returning id into v_id;

      if v_id is null then
        v_kept := v_kept + 1;
      else
        v_inserted := v_inserted + 1;
      end if;
    exception when others then
      -- Savepoint implícito do bloco: só este item é desfeito.
      v_failed := v_failed + 1;
      raise warning 'kommo_fill_talk_messages: item % falhou: %', v_item.m->>'kommo_message_id', sqlerrm;
    end;
  end loop;

  update conversations c
  set messages_count = (select count(*) from conversation_messages m where m.conversation_id = c.id)
  where c.id = p_conversation_id;

  return jsonb_build_object(
    'inserted', v_inserted, 'filled', v_filled, 'kept', v_kept,
    'webhook_duplicate', v_webhook_duplicate, 'failed', v_failed
  );
end;
$$;

revoke all on function kommo_fill_talk_messages(uuid, jsonb) from public, anon, authenticated;
grant execute on function kommo_fill_talk_messages(uuid, jsonb) to service_role;
