import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthShell } from './brand/AuthShell';
import '../pages/Login.css';

export function RequireAuth() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <AuthShell role="status" ariaLive="polite">
        <div className="login-spinner" aria-hidden="true" />
        <p className="access-screen-text">Carregando o sistema Upclass…</p>
      </AuthShell>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
}

