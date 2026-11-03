# Navegação por cards

Cards de indicador funcionam como atalhos para o detalhamento. Implementado em 02/11/2026.

## Como funciona
- `src/components/ui/useCardLink.ts`: o card vira um link acessível (`role="link"`, Tab + Enter, `data-card-link`). Não envolve o conteúdo num `<a>`. Por isso botões e links internos (ex.: "Ver detalhes", foto do vendedor) mantêm o próprio clique e não navegam pelo card. Texto selecionado não navega.
- `src/lib/cardLinks.ts`: único lugar com rotas e parâmetros. **Não montar URL de card à mão nos componentes.**
- `KpiCard` aceita `to`. Sem `to`, o card não é clicável.
- `src/components/ui/useHashTarget.ts` (no `Layout`): link com `#id` rola até a seção e a destaca. Abre `<details>`. Enquanto a página cresce acima, mantém a posição até o usuário rolar (até 5 s).
- Estilo em `src/index.css`:
  - `[data-card-link]` tem hover só em dispositivos com mouse, efeito de pressão no toque e foco visível;
  - `.uc-target-flash` dá o destaque da seção de destino.
- **Período:** o filtro geral (`PeriodContext`) acompanha a navegação. Quando o card representa outro intervalo (dia escolhido, mês do Forecast diferente do período), o link leva `?periodo=custom&de=&ate=`, que passa a ser o período geral.
- **Período persistente:** como o período geral fica salvo, depois de abrir um dia (Resultado diário) ou o mês do Forecast o sistema continua nesse período até o usuário trocar.
- **Financeiro a partir do Dashboard:** Resultado financeiro é mensal; com o Dashboard numa semana, os números do destino são do mês inteiro.
- **Vendas** (`Sales.tsx`) aplica `?categoria=` (Aparelhos/Acessórios), `?produto=` (id), `?busca=` e `?vendedor=` ao chegar. Filtros manuais seguem funcionando.
- **Permissões:** todos os destinos estão sob `RequireAdmin` (`App.tsx`), e os dados têm RLS de administrador. O Painel do Vendedor não ganhou links para telas administrativas.

## Mapa de cards
| Tela | Card | Destino | Leva junto |
|---|---|---|---|
| Dashboard | Aparelhos / Acessórios vendidos | Vendas | categoria, período |
| Dashboard | Faturamento, Lucro bruto, Margem | Resultado financeiro | mês do período |
| Dashboard | Meta da Semana / Meta do Mês | Metas `#meta-semanal` / `#meta-mensal` | — |
| Dashboard | Total de Vendas | Vendas | período ("Ver produtos vendidos" abre o modal) |
| Dashboard | Aparelho / Acessório mais vendido | Vendas | produto (id) ou, quando o nome agrupa mais de um cadastro, busca pelo nome + categoria — a busca é por "contém" e pode trazer variantes ("iPhone 15" acha "iPhone 15 Pro") ("Ver detalhes" abre o modal) |
| Forecast | Vendidos (unidades) | Vendas | categoria, vendedor filtrado, mês |
| Forecast | Vendidos (R$), Faturamento conciliado | Resultado financeiro | mês |
| Forecast | Meta total da equipe, Faltam para a meta | Metas `#metas-vendedor` | mês |
| Forecast | Acessórios vendidos, iPhone, Atendimentos válidos | Vendas | categoria, vendedor, mês |
| Forecast | Maior ticket médio / Maior PA | Relatório do vendedor | — |
| Forecast | Para revisão (Apple) | `#fc-review` (abre a lista) | — |
| Resultado financeiro | Lucro realizado, Falta para a meta, Projeção/Fechamento | Resultado diário | mês |
| Resultado financeiro | Meta total, Pior cenário | Metas `#metas-lucro` | mês |
| Resultado diário | Meta diária | Metas `#metas-lucro` | mês |
| Resultado diário | Acumulado, % da meta | Resultado financeiro | mês |
| Resultado diário | Dias na meta / Necessário por dia | `#fin-days-table` / `#fin-plan` | — |
| Resultado diário | Vendas do dia por vendedor (card do vendedor) | Vendas | vendedor, dia (o nome continua abrindo o painel) |
| Meu Supervisor | Atendimentos, Conversas no período | Conversas | vendedor e canal filtrados |
| Meu Supervisor | Tempo médio, Taxa de resposta | Desempenho | vendedor e canal |
| Meu Supervisor | Conversas analisadas, Pendentes, Qualidade/Avaliação | Análise IA | vendedor e canal |
| Vendedores | Card do vendedor | Relatório do vendedor | — |
| Relatório do vendedor | CONVERSÃO | Dashboard `#ranking-conversao` | — |

Cards que já abriam detalhamento continuam iguais:
- Vendas e Estoque: os cards abrem os próprios modais de detalhe.
- Vendedores: os cards de líder trocam a aba.
- Tabelas de ranking: as linhas abrem o vendedor.
- Resultado diário: os dias abrem o detalhe.

## Sem clique (motivo)
- **Projeção total / Fechamento e Ritmo necessário (Forecast):** já são o próprio detalhamento da tela.
- **Ticket médio e PA da equipe, A conciliar (Forecast):** não há tela de destino. A conciliação é um modal do Dashboard, sem rota.
- **Produtos Apple / Outros Apple (Forecast):** Vendas não tem filtro Apple.
- **Desvio do ritmo (Resultado diário):** não há detalhamento próprio.
- **Clientes sem resposta (Supervisor):** a lista de Conversas não tem esse filtro (a regra é a última mensagem do cliente sem resposta). Mandar para "não atendidas" mostraria outro número.
- **Oportunidades identificadas, Mensagens enviadas (Supervisor):** sem dado ou sem lista correspondente.
- **Metas (configuração), Configurações, Painel TV, Painel do Vendedor:** são telas de edição ou exibição, ou de outro papel.

## Testes
- `src/lib/cardLinks.test.ts`: URLs, parâmetros e leitura de volta pela tela Vendas.
- Navegador (02/11/2026):
  - todos os cards acima;
  - filtros aplicados na tela de destino;
  - período mantido;
  - botão Voltar;
  - botões internos sem navegação dupla;
  - toque em largura de celular;
  - rolagem até a seção.
