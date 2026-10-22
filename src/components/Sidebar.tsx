import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  Package,
  Target,
  MonitorPlay,
  Settings,
  Receipt,
  CircleDollarSign,
  CalendarDays,
  LogOut,
  Sun,
  Moon,
  X
} from 'lucide-react';

import { BrandLogo } from './brand/BrandLogo';
import './Sidebar.css';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

type NavItem = { path: string; label: string; icon: typeof LayoutDashboard; openInNewTab?: boolean };

// Agrupado por função, mantendo as mesmas rotas e a mesma ordem de antes.
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operação',
    items: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard },
      { path: '/forecast', label: 'Forecast', icon: TrendingUp },
      { path: '/vendas', label: 'Vendas', icon: Receipt },
    ],
  },
  {
    label: 'Desempenho e equipe',
    items: [
      { path: '/vendedores', label: 'Vendedores', icon: Users },
      { path: '/resultado-financeiro', label: 'Resultado financeiro', icon: CircleDollarSign },
      { path: '/resultados-diarios', label: 'Resultados diários', icon: CalendarDays },
      { path: '/estoque', label: 'Estoque', icon: Package },
      { path: '/metas', label: 'Metas', icon: Target },
    ],
  },
  {
    label: 'Administração',
    items: [
      { path: '/painel-loja', label: 'Painel da Loja', icon: MonitorPlay, openInNewTab: true },
      { path: '/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const { signOut } = useAuth();

  // Close sidebar on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleNavClick = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleLogout = () => {
    if (onClose) {
      onClose();
    }
    signOut();
  };

  return (
    <>
      <div 
        className={`sidebar-backdrop ${isOpen ? 'open' : ''}`} 
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar ${isOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <BrandLogo on="dark" className="sidebar-logo" />
          <button 
            className="sidebar-close-btn" 
            onClick={onClose} 
            aria-label="Fechar menu"
            type="button"
          >
            <X size={20} />
          </button>
        </div>
        
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {navGroups.map((group) => (
            <div className="sidebar-group" key={group.label}>
              <p className="sidebar-group-label">{group.label}</p>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  if (item.openInNewTab) {
                    return (
                      <li key={item.path}>
                        <a 
                          href={item.path} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="nav-link"
                          title="Abrir Painel da Loja em nova guia"
                          onClick={handleNavClick}
                        >
                          <Icon size={19} aria-hidden="true" />
                          <span>{item.label}</span>
                          <span className="nav-link-hint" aria-label="(abre em nova guia)">↗</span>
                        </a>
                      </li>
                    );
                  }
                  return (
                    <li key={item.path}>
                      <NavLink 
                        to={item.path} 
                        end={item.path === '/'}
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        onClick={handleNavClick}
                      >
                        <Icon size={19} aria-hidden="true" />
                        <span>{item.label}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-theme-row">
            <span className="sidebar-theme-label">{theme === 'dark' ? 'Tema escuro' : 'Tema claro'}</span>
            <div 
              className={`sleek-theme-switch ${theme === 'dark' ? 'dark-active' : ''}`} 
              onClick={toggleTheme} 
              title="Alternar tema claro/escuro"
              aria-label="Alternar tema claro/escuro"
              aria-pressed={theme === 'dark'}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTheme(); } }}
            >
              <Sun size={13} color="#ffffff" className="switch-icon-sun" aria-hidden="true" />
              <Moon size={13} color="#ffffff" className="switch-icon-moon" aria-hidden="true" />
              <div className="switch-thumb" />
            </div>
          </div>

          <button className="btn-logout" onClick={handleLogout} type="button">
            <LogOut size={18} aria-hidden="true" />
            <span>Sair</span>
          </button>
        </div>
      </aside>
    </>
  );
}
