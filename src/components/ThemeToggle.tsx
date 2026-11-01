import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { switchThemeFrom } from '../lib/themeTransition';
import './ThemeToggle.css';

/** Sol e lua em botões redondos; o tema ativo fica preenchido. A troca cobre a página a partir do botão. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const pick = (next: 'light' | 'dark') => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (next !== theme) switchThemeFrom(e.currentTarget, next, setTheme);
  };
  return (
    <div className={`uc-theme-toggle ${className}`} role="group" aria-label="Tema">
      <button type="button" className={theme === 'light' ? 'is-active' : ''} aria-pressed={theme === 'light'} aria-label="Tema claro" title="Tema claro" onClick={pick('light')}>
        <Sun size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button type="button" className={theme === 'dark' ? 'is-active' : ''} aria-pressed={theme === 'dark'} aria-label="Tema escuro" title="Tema escuro" onClick={pick('dark')}>
        <Moon size={15} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
