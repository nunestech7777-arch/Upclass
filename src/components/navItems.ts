import {
  BrainCircuit,
  CalendarDays,
  CircleDollarSign,
  LayoutDashboard,
  MonitorPlay,
  Package,
  Receipt,
  Settings,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

/** Páginas do sistema (administrador), usadas pelo menu do topo e pela barra inferior do celular. */
export type NavItem = { path: string; label: string; icon: typeof LayoutDashboard; group: string; openInNewTab?: boolean };

// Mesmas rotas e mesma ordem do antigo menu lateral; o grupo só aparece no menu "Mais".
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Operação' },
  { path: '/forecast', label: 'Forecast', icon: TrendingUp, group: 'Operação' },
  { path: '/vendas', label: 'Vendas', icon: Receipt, group: 'Operação' },
  { path: '/vendedores', label: 'Vendedores', icon: Users, group: 'Desempenho e equipe' },
  { path: '/supervisor', label: 'Meu Supervisor', icon: BrainCircuit, group: 'Desempenho e equipe' },
  { path: '/resultado-financeiro', label: 'Resultado financeiro', icon: CircleDollarSign, group: 'Desempenho e equipe' },
  { path: '/resultados-diarios', label: 'Resultados diários', icon: CalendarDays, group: 'Desempenho e equipe' },
  { path: '/estoque', label: 'Estoque', icon: Package, group: 'Desempenho e equipe' },
  { path: '/metas', label: 'Metas', icon: Target, group: 'Desempenho e equipe' },
  { path: '/painel-loja', label: 'Painel da Loja', icon: MonitorPlay, group: 'Administração', openInNewTab: true },
  { path: '/configuracoes', label: 'Configurações', icon: Settings, group: 'Administração' },
];

export const isActivePath = (item: NavItem, pathname: string) =>
  !item.openInNewTab && (item.path === '/' ? pathname === '/' : pathname === item.path || pathname.startsWith(`${item.path}/`));
