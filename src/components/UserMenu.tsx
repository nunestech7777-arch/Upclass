import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './UserMenu.css';

function displayName(sellerName: string | null | undefined, email: string | null | undefined): string {
  if (sellerName) return sellerName;
  const local = (email ?? '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Minha conta';
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? '')).toUpperCase() || 'U';
}

/** Avatar, nome e seta (como no vídeo de referência); abre o menu da conta com a opção Sair. */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, access, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const name = displayName(access?.sellerName, user?.email);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('.uc-user-btn')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`uc-user ${compact ? 'is-compact' : ''}`}>
      <button
        type="button"
        className="uc-user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Conta: ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="uc-user-avatar" aria-hidden="true">
          {access?.photoUrl ? <img src={access.photoUrl} alt="" /> : initials(name)}
        </span>
        {!compact && <span className="uc-user-name">{name}</span>}
        {!compact && <ChevronDown size={15} className="uc-user-chevron" aria-hidden="true" />}
      </button>
      {open && (
        <div id={menuId} className="uc-user-menu" role="menu">
          {user?.email && <span className="uc-user-email">{user.email}</span>}
          <button type="button" role="menuitem" className="uc-user-item" onClick={() => (setOpen(false), signOut())}>
            <LogOut size={16} aria-hidden="true" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}
