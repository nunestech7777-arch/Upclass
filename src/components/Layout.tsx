import React, { useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';
import { PeriodBar } from './PeriodBar';
import { BottomNav } from './BottomNav';
import { usePageMotion } from '../lib/motion';

export function Layout() {
  const pageRef = useRef<HTMLDivElement>(null);
  // Cards, números e blocos de todas as páginas entram com a mesma cascata do Dashboard. A animação
  // observa só a área da página (o primeiro filho dela é a raiz da rota atual), fora a barra de período.
  usePageMotion(pageRef);

  return (
    <div className="app-container">
      <TopNav />
      <main className="main-content">
        <PeriodBar />
        <div ref={pageRef} className="page-host">
          <Outlet />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
