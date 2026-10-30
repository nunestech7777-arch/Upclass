import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, BrainCircuit, FileText, LayoutGrid, MessagesSquare, Settings2, Sparkles } from 'lucide-react';
import '../../components/finance/finance.css';
import '../../components/supervisor/supervisor.css';
import { fetchKommoUsers, fetchSellers } from '../../lib/api';
import type { KommoUser, Seller } from '../../lib/database.types';
import { formatRange } from '../../lib/finance/dashboard';
import { SupervisorFiltersBar } from '../../components/supervisor/SupervisorFiltersBar';
import { useSupervisorFilters, type SupervisorContext } from '../../components/supervisor/useSupervisor';

const SECTIONS = [
  { path: '', label: 'Visão geral', icon: LayoutGrid },
  { path: 'conversas', label: 'Conversas', icon: MessagesSquare },
  { path: 'analise-ia', label: 'Análise IA', icon: Sparkles },
  { path: 'vendedores', label: 'Desempenho', icon: BarChart3 },
  { path: 'relatorios', label: 'Relatórios diários', icon: FileText },
  { path: 'configuracoes', label: 'Configurações', icon: Settings2 },
] as const;

/** Área "Meu Supervisor": Kommo, conversas e supervisão comercial num só lugar. */
export function SupervisorLayout() {
  const filtersState = useSupervisorFilters();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [kommoUsers, setKommoUsers] = useState<KommoUser[]>([]);
  const location = useLocation();
  const section = location.pathname.replace(/^\/supervisor\/?/, '').split('/')[0];
  const showFilters = section !== 'configuracoes' && section !== 'relatorios';

  useEffect(() => {
    fetchSellers()
      .then((list) => setSellers([...list].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'))))
      .catch(() => setSellers([]));
    fetchKommoUsers()
      .then(setKommoUsers)
      .catch(() => setKommoUsers([]));
  }, []);

  const { filters, preset, today, update, search } = filtersState;
  const context = useMemo<SupervisorContext>(() => {
    const names = new Map(sellers.map((s) => [s.id, s.name]));
    const kommoNames = new Map(kommoUsers.map((u) => [String(u.id), u.name]));
    const sellerByKommo = new Map(sellers.filter((s) => s.kommo_user_id).map((s) => [String(s.kommo_user_id), s.name]));
    const kommoUserName = (id: string | null | undefined) =>
      id ? (sellerByKommo.get(id) ?? kommoNames.get(id) ?? `Usuário Kommo ${id}`) : 'Não identificado';
    return {
      filters,
      preset,
      today,
      update,
      search,
      sellers,
      // Chave de atendente: id do vendedor, "kommo:<id>" (usuário do Kommo sem vendedor) ou null.
      sellerName: (id) => {
        if (!id) return 'Sem atendente identificado';
        if (id.startsWith('kommo:')) return `${kommoNames.get(id.slice(6)) ?? `Usuário Kommo ${id.slice(6)}`} (sem vendedor vinculado)`;
        return names.get(id) ?? 'Vendedor removido';
      },
      kommoUserName,
    };
  }, [filters, preset, today, update, search, sellers, kommoUsers]);

  const query = filtersState.search ? `?${filtersState.search}` : '';

  return (
    <div className="fin-page sv-page">
      <header className="sv-header">
        <div className="sv-title-group">
          <span className="sv-title-icon" aria-hidden="true">
            <BrainCircuit size={22} />
          </span>
          <div>
            <h1 className="sv-title">Meu Supervisor</h1>
            <p className="sv-subtitle">Conversas do Kommo, supervisão comercial e desempenho da equipe.</p>
          </div>
        </div>
        {showFilters && <span className="sv-range-chip">{formatRange(filtersState.filters.range)}</span>}
      </header>

      <nav className="sv-tabs" aria-label="Seções do Meu Supervisor">
        {SECTIONS.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={`/supervisor${path ? `/${path}` : ''}${query}`}
            end={path === ''}
            className={({ isActive }) => `sv-tab ${isActive ? 'is-active' : ''}`}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {showFilters && (
        <SupervisorFiltersBar
          filters={filtersState.filters}
          preset={filtersState.preset}
          today={filtersState.today}
          sellers={sellers}
          update={filtersState.update}
        />
      )}

      <Outlet context={context} />
    </div>
  );
}

/** Endereço alternativo /meu-supervisor → /supervisor, mantendo os filtros da URL. */
export function SupervisorRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/supervisor${search}`} replace />;
}
