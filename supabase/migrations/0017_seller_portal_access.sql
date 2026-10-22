-- Painel do Vendedor: papéis (administrador × vendedor), vínculo login ↔ vendedor, RLS restrita a
-- administradores, metas SEMANAIS de aparelhos por vendedor e funções de leitura do vendedor.
--
-- Antes desta migração toda conta logada tinha acesso total a todas as tabelas
-- ("authenticated_full_access"). Depois dela:
--   * só contas com papel `admin` ativo em `user_access` leem/gravam as tabelas diretamente;
--   * a conta de vendedor NÃO lê nenhuma tabela: usa apenas as funções `seller_portal_*`, que
--     descobrem o vendedor pelo `auth.uid()` (nunca por um id enviado pelo navegador) e devolvem só
--     colunas autorizadas (sem custo, lucro, receita conciliada ou cliente);
--   * conta sem linha em `user_access` (ex.: criada fora do painel) não acessa nada.
-- As contas que já existem em auth.users viram administradoras (preserva o acesso atual).
--
-- Aditiva: nenhuma tabela é recriada, nenhuma venda/meta/vendedor é alterado ou apagado.

-- ============================================================
-- user_access: papel e vínculo de cada conta do Supabase Auth
-- ============================================================
create table if not exists user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'seller')),
  -- Vínculo pelo id interno estável do vendedor (sellers.id); o id do MercadoPhone fica em
  -- sellers.external_id. Nome e e-mail nunca são chave: renomear no MercadoPhone não quebra nada.
  seller_id uuid unique references sellers(id) on delete restrict,
  enabled boolean not null default true,
  -- Só exibição/auditoria (o e-mail de verdade está em auth.users).
  email text,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  constraint user_access_role_seller_check check (
    (role = 'seller' and seller_id is not null) or (role = 'admin' and seller_id is null)
  )
);

comment on table user_access is 'Papel de cada conta (admin | seller) e vínculo 1:1 conta ↔ vendedor. Gravado só pela function seller-access (service_role). Sem linha = sem acesso.';
comment on column user_access.enabled is 'false = acesso desativado (não afeta sellers.show_in_ranking).';

alter table user_access enable row level security;

-- Contas existentes = donos/gerentes que já usam o painel. Só na PRIMEIRA aplicação (tabela
-- vazia): reaplicar a migração nunca promove a admin uma conta desvinculada ou criada depois.
insert into user_access (user_id, role, email)
select id, 'admin', email from auth.users
where not exists (select 1 from user_access)
on conflict (user_id) do nothing;

-- ============================================================
-- Funções de papel (usadas nas políticas e nas funções do vendedor)
-- ============================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid() and role = 'admin' and enabled
  )
$$;

create or replace function public.current_seller_id() returns uuid
language sql stable security definer set search_path = public as $$
  select seller_id from public.user_access
  where user_id = auth.uid() and role = 'seller' and enabled
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.current_seller_id() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.current_seller_id() to authenticated, service_role;

-- ============================================================
-- RLS: "qualquer logado" → "só administrador"
-- Troca toda política de acesso amplo do schema public (inclusive tabelas criadas pelo painel do
-- Supabase que seguiram a mesma convenção de nome).
-- ============================================================
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname, cmd from pg_policies
    where schemaname = 'public' and policyname in ('authenticated_full_access', 'authenticated_read')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.cmd = 'SELECT' then
      execute format('drop policy if exists admin_read on %I.%I', r.schemaname, r.tablename);
      execute format(
        'create policy admin_read on %I.%I for select to authenticated using ((select public.is_admin()))',
        r.schemaname, r.tablename
      );
    else
      execute format('drop policy if exists admin_full_access on %I.%I', r.schemaname, r.tablename);
      execute format(
        'create policy admin_full_access on %I.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
        r.schemaname, r.tablename
      );
    end if;
  end loop;
end $$;

-- user_access: administrador só LÊ; gravações apenas pela function seller-access (service_role,
-- que ignora RLS). Ninguém altera o próprio papel ou vínculo pelo navegador.
drop policy if exists admin_read on user_access;
create policy admin_read on user_access for select to authenticated using ((select public.is_admin()));

-- ============================================================
-- admin_audit_log: operações administrativas de acesso e de metas
-- ============================================================
create table if not exists admin_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  seller_id uuid,
  target_user_id uuid,
  details jsonb
);

create index if not exists idx_admin_audit_log_occurred_at on admin_audit_log(occurred_at desc);
create index if not exists idx_admin_audit_log_seller on admin_audit_log(seller_id);

alter table admin_audit_log enable row level security;
drop policy if exists admin_read on admin_audit_log;
create policy admin_read on admin_audit_log for select to authenticated using ((select public.is_admin()));

-- ============================================================
-- seller_weekly_goals: meta semanal de APARELHOS (iPhones) por vendedor
-- Semana da loja: segunda a domingo, datas comerciais em America/Sao_Paulo (mesma regra de
-- sales.sold_date e do Dashboard). Uma linha por vendedor e semana: cadastrar a meta de uma semana
-- nunca altera outra, então o histórico fica preservado. Independente das metas mensais do Forecast.
-- ============================================================
create table if not exists seller_weekly_goals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id) on delete restrict,
  week_start date not null check (extract(isodow from week_start) = 1),
  -- Meta ausente = sem linha ("Sem meta definida"); zero não é meta válida.
  device_target integer not null check (device_target > 0),
  created_by uuid default auth.uid(),
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  unique (seller_id, week_start)
);

comment on table seller_weekly_goals is 'Meta semanal de aparelhos (iPhones) por vendedor. week_start = segunda-feira (semana segunda→domingo, fuso da loja).';

create index if not exists idx_seller_weekly_goals_week on seller_weekly_goals(week_start);

alter table seller_weekly_goals enable row level security;
drop policy if exists admin_full_access on seller_weekly_goals;
create policy admin_full_access on seller_weekly_goals
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Autor da alteração pelo token (não pelo que o navegador mandar).
create or replace function public.seller_weekly_goals_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text := (select email from auth.users where id = auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_email := v_email;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_by_email := v_email;
  new.updated_at := now();
  return new;
end $$;

-- Trilha de auditoria em trigger AFTER: num upsert que vira UPDATE, o BEFORE INSERT também
-- dispara — só o AFTER reflete o que de fato foi gravado.
create or replace function public.seller_weekly_goals_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into admin_audit_log (actor_id, actor_email, action, seller_id, details)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    'weekly_goal_' || lower(tg_op),
    coalesce(new.seller_id, old.seller_id),
    jsonb_build_object(
      'week_start', coalesce(new.week_start, old.week_start),
      'from', case when tg_op <> 'INSERT' then old.device_target end,
      'to', case when tg_op <> 'DELETE' then new.device_target end
    )
  );
  return null;
end $$;

drop trigger if exists trg_seller_weekly_goals_stamp on seller_weekly_goals;
create trigger trg_seller_weekly_goals_stamp
  before insert or update on seller_weekly_goals
  for each row execute function public.seller_weekly_goals_stamp();

drop trigger if exists trg_seller_weekly_goals_audit on seller_weekly_goals;
create trigger trg_seller_weekly_goals_audit
  after insert or update or delete on seller_weekly_goals
  for each row execute function public.seller_weekly_goals_audit();

revoke all on function public.seller_weekly_goals_stamp() from public, anon, authenticated;
revoke all on function public.seller_weekly_goals_audit() from public, anon, authenticated;

-- ============================================================
-- Funções do Painel do Vendedor (security definer; o vendedor vem SEMPRE do token)
-- ============================================================

-- Papel e vínculo da conta logada (roteamento do app). Só os dados da própria conta.
create or replace function public.my_access()
returns table (role text, enabled boolean, seller_id uuid, seller_name text, seller_photo_url text, mp_seller_id text)
language sql stable security definer set search_path = public as $$
  select ua.role, ua.enabled, s.id, s.name, s.photo_url, s.external_id
  from public.user_access ua
  left join public.sellers s on s.id = ua.seller_id
  where ua.user_id = auth.uid()
$$;

-- Itens vendidos PELO vendedor logado (vendedor do item, não do pedido). Sem custo, lucro,
-- receita conciliada, cliente ou itens de outros vendedores do mesmo pedido.
create or replace function public.seller_portal_sales(p_from date, p_to date)
returns table (
  id uuid,
  sold_at timestamptz,
  sold_date date,
  mp_order_id text,
  product_name text,
  quantity integer,
  amount numeric,
  item_status text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_seller uuid := public.current_seller_id();
begin
  if v_seller is null then
    raise exception 'acesso de vendedor não autorizado' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'período inválido (até 367 dias)' using errcode = '22023';
  end if;
  return query
    select s.id, s.sold_at, s.sold_date, s.mp_order_id, p.name, s.quantity, s.amount, s.item_status
    from public.sales s
    join public.products p on p.id = s.product_id
    where s.seller_id = v_seller
      and s.sold_date between p_from and p_to
      -- 'removed' = versão antiga de um item que não existe mais no pedido (não é venda).
      and s.item_status <> 'removed'
    order by s.sold_at desc, s.external_id;
end $$;

-- Metas semanais do vendedor logado nas semanas que tocam o período.
create or replace function public.seller_portal_weekly_goals(p_from date, p_to date)
returns table (week_start date, device_target integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_seller uuid := public.current_seller_id();
begin
  if v_seller is null then
    raise exception 'acesso de vendedor não autorizado' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'período inválido (até 367 dias)' using errcode = '22023';
  end if;
  return query
    select g.week_start, g.device_target
    from public.seller_weekly_goals g
    where g.seller_id = v_seller
      and g.week_start between p_from - 6 and p_to
    order by g.week_start;
end $$;

revoke all on function public.my_access() from public, anon;
revoke all on function public.seller_portal_sales(date, date) from public, anon;
revoke all on function public.seller_portal_weekly_goals(date, date) from public, anon;
grant execute on function public.my_access() to authenticated;
grant execute on function public.seller_portal_sales(date, date) to authenticated;
grant execute on function public.seller_portal_weekly_goals(date, date) to authenticated;

-- ============================================================
-- Storage: fotos de vendedores (bucket público seller-avatars)
-- Leitura continua pública (URL pública). Envio/troca/remoção de fotos passam a ser só do
-- administrador. As políticas antigas do bucket foram criadas pelo painel do Supabase (nomes
-- desconhecidos): troca as que citam o bucket. Se o papel que roda a migração não puder alterar
-- storage.objects, só avisa — o restante da migração continua valendo.
-- ============================================================
do $$
declare
  r record;
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname <> 'seller_avatars_admin_write'
      and (coalesce(qual, '') like '%seller-avatars%' or coalesce(with_check, '') like '%seller-avatars%')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
  drop policy if exists seller_avatars_admin_write on storage.objects;
  create policy seller_avatars_admin_write on storage.objects
    for all to authenticated
    using (bucket_id = 'seller-avatars' and (select public.is_admin()))
    with check (bucket_id = 'seller-avatars' and (select public.is_admin()));
exception when insufficient_privilege then
  raise warning 'storage.objects: sem permissão para trocar as políticas do bucket seller-avatars — revisar no painel do Supabase (Storage > Policies).';
end $$;
