import React, { useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';
import { PeriodBar } from './PeriodBar';
import { usePageMotion } from '../lib/motion';

export function Layout() {
  const mainRef = useRef<HTMLElement>(null);
  // Cards, números e blocos de todas as páginas entram com a mesma cascata do Dashboard.
  usePageMotion(mainRef);

  return (
    <div className="app-container">
      <TopNav />
      <main ref={mainRef} className="main-content">
        <PeriodBar />
        <Outlet />
      </main>
    </div>
  );
}
