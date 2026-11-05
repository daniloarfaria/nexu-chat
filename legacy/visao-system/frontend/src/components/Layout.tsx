import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Upload, Package, Tag, Users,
  Search, TrendingUp, BarChart3, Settings, Sun, Moon,
  Gem, ChevronRight
} from 'lucide-react';
import { useAppStore } from '../store/appStore';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/import', icon: Upload, label: 'Importar XML' },
  { section: 'Catálogo' },
  { path: '/products', icon: Package, label: 'Produtos' },
  { path: '/categories', icon: Tag, label: 'Categorias' },
  { path: '/suppliers', icon: Users, label: 'Fornecedores' },
  { section: 'Ferramentas' },
  { path: '/search', icon: Search, label: 'Consulta' },
  { path: '/pricing', icon: TrendingUp, label: 'Precificação' },
  { path: '/reports', icon: BarChart3, label: 'Relatórios' },
  { section: 'Sistema' },
  { path: '/settings', icon: Settings, label: 'Configurações' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { darkMode, toggleDarkMode } = useAppStore();
  const location = useLocation();

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Gem size={16} color="white" />
          </div>
          <div className="sidebar-logo-text">
            <span className="sidebar-logo-name">Equipe da Visão</span>
            <span className="sidebar-logo-sub">Semijoias</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item, i) => {
            if ('section' in item) {
              return (
                <span key={i} className="sidebar-section-label">{item.section}</span>
              );
            }
            const Icon = item.icon!;
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path!);

            return (
              <NavLink
                key={item.path}
                to={item.path!}
                className={`sidebar-item ${isActive ? 'active' : ''}`}
              >
                <Icon className="sidebar-item-icon" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="flex items-center justify-between" style={{ padding: '8px 4px' }}>
            <span className="text-sm text-tertiary" style={{ color: 'var(--sidebar-text)' }}>
              {darkMode ? 'Modo Escuro' : 'Modo Claro'}
            </span>
            <button
              className={`dark-toggle ${darkMode ? 'on' : ''}`}
              onClick={toggleDarkMode}
              aria-label="Alternar tema"
              id="dark-mode-toggle"
            >
              <div className="dark-toggle-thumb" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-breadcrumb flex items-center gap-2 text-sm text-secondary flex-1">
            {getBreadcrumb(location.pathname)}
          </div>
          <div className="flex items-center gap-3">
            <div className="info-pill">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
              Sistema Online
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="page-content animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}

function getBreadcrumb(path: string) {
  const map: Record<string, string> = {
    '/': 'Dashboard',
    '/import': 'Importar XML',
    '/products': 'Produtos',
    '/categories': 'Categorias',
    '/suppliers': 'Fornecedores',
    '/search': 'Consulta',
    '/pricing': 'Precificação',
    '/reports': 'Relatórios',
    '/settings': 'Configurações',
  };
  const label = Object.entries(map).find(([k]) => path === k || (k !== '/' && path.startsWith(k)))?.[1] || 'Página';
  return (
    <>
      <span style={{ color: 'var(--sidebar-text)', fontSize: 12 }}>Equipe da Visão</span>
      <ChevronRight size={12} style={{ color: 'var(--sidebar-text)' }} />
      <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: 13 }}>{label}</span>
    </>
  );
}
