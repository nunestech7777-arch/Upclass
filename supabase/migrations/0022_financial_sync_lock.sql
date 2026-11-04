-- Trava compartilhada da conciliação financeira (04/11/2026).
--
-- O botão "Atualizar dados" do Dashboard (mercadophone-financial-sync, modo `pending`), a conciliação
-- manual por período e a rotina de 30 min (mercadophone-sync) gravam custo/lucro nas mesmas linhas de
-- `sales`. Esta trava garante uma conciliação por vez, mesmo entre instâncias diferentes das Edge
-- Functions: quem não consegue a trava não concilia (o botão responde "ocupado"; a rotina espera
-- alguns segundos e, se continuar ocupada, registra a execução pulada).
--
-- * financial_sync_lock: uma linha só (id = 1). `holder` identifica a execução dona; `expires_at` é o
--   prazo da trava — uma execução que caiu sem liberar não trava as outras depois do prazo.
-- * try_financial_sync_lock(holder, ttl): pega a trava se estiver livre, vencida ou já for do mesmo
--   dono. O UPDATE com WHERE é atômico: duas chamadas ao mesmo tempo → só uma recebe true.
-- * release_financial_sync_lock(holder): libera só se ainda for do dono.
-- Só o service_role (Edge Functions) executa as funções; a tabela não tem política (RLS sem acesso
-- para anon/authenticated). Nenhum dado existente é alterado.

create table if not exists financial_sync_lock (
  id smallint primary key default 1 check (id = 1),
  holder text,
  acquired_at timestamptz,
  expires_at timestamptz
);

comment on table financial_sync_lock is 'Trava de uma conciliação financeira por vez (botão, manual e rotina de 30 min). Uma linha; gravada só pelas funções try/release_financial_sync_lock.';

insert into financial_sync_lock (id) values (1) on conflict (id) do nothing;

alter table financial_sync_lock enable row level security;
revoke all on financial_sync_lock from anon, authenticated;

create or replace function public.try_financial_sync_lock(p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  got boolean;
begin
  if p_holder is null or length(p_holder) = 0 or p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 900 then
    raise exception 'trava: dono e prazo (1 a 900 s) são obrigatórios';
  end if;
  update financial_sync_lock
     set holder = p_holder,
         acquired_at = now(),
         expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = 1
     and (holder is null or expires_at is null or expires_at < now() or holder = p_holder)
  returning true into got;
  return coalesce(got, false);
end;
$$;

create or replace function public.release_financial_sync_lock(p_holder text)
returns void
language sql security definer set search_path = public as $$
  update financial_sync_lock
     set holder = null, acquired_at = null, expires_at = null
   where id = 1 and holder = p_holder;
$$;

revoke all on function public.try_financial_sync_lock(text, integer) from public, anon, authenticated;
revoke all on function public.release_financial_sync_lock(text) from public, anon, authenticated;
grant execute on function public.try_financial_sync_lock(text, integer) to service_role;
grant execute on function public.release_financial_sync_lock(text) to service_role;
