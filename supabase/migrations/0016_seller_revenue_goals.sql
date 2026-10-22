-- Metas mensais de FATURAMENTO (R$) por vendedor, de aparelhos e de acessórios.
-- Mesma tabela e mesma chave (vendedor + mês) das metas em unidades (0014/0015): duas colunas novas,
-- nulas por padrão. Aditiva: nenhuma linha existente é alterada e nenhuma meta é convertida
-- (meta financeira nula = "Sem meta"). Faturamento não é lucro: metas de lucro seguem em
-- seller_profit_goals.

alter table seller_device_goals add column if not exists device_revenue_target numeric(12, 2);
alter table seller_device_goals add column if not exists accessory_revenue_target numeric(12, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seller_device_goals_device_revenue_target_check') then
    alter table seller_device_goals add constraint seller_device_goals_device_revenue_target_check
      check (device_revenue_target is null or device_revenue_target >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seller_device_goals_accessory_revenue_target_check') then
    alter table seller_device_goals add constraint seller_device_goals_accessory_revenue_target_check
      check (accessory_revenue_target is null or accessory_revenue_target >= 0);
  end if;
end $$;

comment on column seller_device_goals.device_revenue_target is 'Meta mensal de faturamento (R$, valorTotal) de iPhones do vendedor. NULL = sem meta. Independente de device_target.';
comment on column seller_device_goals.accessory_revenue_target is 'Meta mensal de faturamento (R$, valorTotal) de acessórios pagos do vendedor. NULL = sem meta. Independente de accessory_target.';
