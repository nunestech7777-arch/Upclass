import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { RequireAuth } from './components/RequireAuth';
import { RequireAdmin, RequireSeller } from './components/RequireRole';
import { SellerPortal } from './pages/SellerPortal';
import { SetPassword } from './pages/SetPassword';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Forecast } from './pages/Forecast';
import { Sales } from './pages/Sales';
import { Sellers } from './pages/Sellers';
import { SellerReport } from './pages/SellerReport';
import { Inventory } from './pages/Inventory';
import { Goals } from './pages/Goals';
import { TVPanel } from './pages/TVPanel';
import { Settings } from './pages/Settings';
import { FinancialResults } from './pages/FinancialResults';
import { DailyResults } from './pages/DailyResults';

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route path="/definir-senha" element={<SetPassword />} />
              <Route element={<RequireSeller />}>
                <Route path="/vendedor" element={<SellerPortal />} />
              </Route>
              <Route element={<RequireAdmin />}>
              <Route path="/painel-loja" element={<TVPanel />} />
              <Route path="/tv" element={<TVPanel />} />
              <Route path="/dashboard-loja" element={<TVPanel />} />
              <Route path="/" element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="forecast" element={<Forecast />} />
                <Route path="vendas" element={<Sales />} />
                <Route path="vendedores" element={<Sellers />} />
                <Route path="vendedores/:id" element={<SellerReport />} />
                <Route path="resultado-financeiro" element={<FinancialResults />} />
                <Route path="resultados-diarios" element={<DailyResults />} />
                <Route path="estoque" element={<Inventory />} />
                <Route path="metas" element={<Goals />} />
                <Route path="configuracoes" element={<Settings />} />
              </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

