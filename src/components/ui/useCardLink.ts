import type React from 'react';
import { useLocation, useNavigate, type To } from 'react-router-dom';

/** Elementos que têm clique próprio dentro de um card: o clique neles não navega pelo card. */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="link"]:not([data-card-link])';

/**
 * Card navegável (atalho para o detalhamento do indicador): o card inteiro vira um link acessível
 * (role="link", Enter abre), sem envolver o conteúdo num <a> — botões e links internos continuam
 * funcionando e não disparam a navegação do card. `to` null = card sem destino (nada muda).
 * `to` só com "#id" rola até a seção da própria página, mantendo os filtros da URL.
 */
export function useCardLink(to: To | null | undefined, label?: string) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  if (!to) return {};
  const target = typeof to === 'string' && to.startsWith('#') ? `${pathname}${search}${to}` : to;
  const go = () => navigate(target);
  return {
    role: 'link',
    tabIndex: 0,
    'data-card-link': '',
    ...(label ? { 'aria-label': label } : {}),
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      // Card dentro de card: só o mais interno navega.
      if (e.defaultPrevented) return;
      const hit = (e.target as HTMLElement).closest(INTERACTIVE);
      if (hit && hit !== e.currentTarget) return;
      // Texto selecionado com o mouse não vira navegação.
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      go();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) {
        e.preventDefault();
        go();
      }
    },
  } as const;
}
