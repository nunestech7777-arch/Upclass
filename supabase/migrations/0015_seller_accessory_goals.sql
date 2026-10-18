-- Meta mensal de ACESSÓRIOS por vendedor, independente da meta de aparelhos.
-- Mesma tabela e mesma chave (vendedor + mês) da meta de aparelhos: coluna nova, nula por padrão.
-- Aditiva: nenhuma linha existente é alterada (meta de acessórios nula = "Sem meta").

alter table seller_device_goals add column if not exists accessory_target integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seller_device_goals_accessory_target_check') then
    alter table seller_device_goals add constraint seller_device_goals_accessory_target_check
      check (accessory_target is null or accessory_target >= 0);
  end if;
end $$;

comment on column seller_device_goals.accessory_target is 'Meta mensal de acessórios pagos do vendedor (brindes não contam). NULL = sem meta. Independente de device_target.';
