import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, X } from 'lucide-react';
import { NAV_ITEMS, isActivePath, type NavItem } from './navItems';
import { usePrefersReducedMotion } from '../lib/motion';
import './BottomNav.css';

// Abas fixas da barra, nesta ordem (Meu Supervisor no centro); o resto vai para "Mais".
const TAB_PATHS = ['/', '/forecast', '/supervisor', '/resultado-financeiro'];
const SHORT_LABEL: Record<string, string> = { '/resultado-financeiro': 'Financeiro' };
const TABS = TAB_PATHS.map((p) => NAV_ITEMS.find((i) => i.path === p)!);
const MORE = NAV_ITEMS.filter((i) => !TAB_PATHS.includes(i.path));

// Cavidade da barra em volta do círculo: arco com folga constante (círculo de 42px, inteiro dentro da
// barra, com o centro 22px abaixo da borda de cima — ver .bn-orb no CSS) e cantos arredondados onde
// a cavidade abre na borda.
const ORB_Y = 22;
const NOTCH_R = 21 + 6;
const FILLET = 8;

/**
 * Fundo da barra com o dobro da largura e a cavidade exatamente no meio (x = w). Deslizar esse
 * desenho (transform) leva a cavidade junto com o círculo; os cantos arredondados vêm do recorte do
 * contêiner (.bn-bg).
 */
function barPaths(w: number, h: number, notch: boolean) {
  let cut = '';
  if (notch) {
    // Centro de cada canto arredondado: tangente à borda (y = 0) e ao arco da cavidade.
    const dx = Math.sqrt((NOTCH_R + FILLET) ** 2 - (FILLET - ORB_Y) ** 2);
    const k = NOTCH_R / (NOTCH_R + FILLET);
    const px = dx * k;
    const py = ORB_Y + (FILLET - ORB_Y) * k;
    // Com o centro do arco abaixo dos pontos de tangência, o arco passa de meia volta.
    const large = py < ORB_Y ? 1 : 0;
    cut =
      `L${w - dx},0 A${FILLET},${FILLET} 0 0 1 ${w - px},${py} ` +
      `A${NOTCH_R},${NOTCH_R} 0 ${large} 0 ${w + px},${py} ` +
      `A${FILLET},${FILLET} 0 0 1 ${w + dx},0 `;
  }
  const line = `M0,0 ${cut}L${2 * w},0`;
  return { line, fill: `${line} L${2 * w},${h} L0,${h} Z` };
}

/**
 * Navegação inferior do celular (só aparece até 760px; no computador vale o menu do topo): barra
 * flutuante com cinco abas. A aba ativa ganha um círculo azul com o ícone dela, dentro da barra e
 * acomodado numa cavidade côncava; círculo e cavidade deslizam juntos até a aba tocada. "Mais" abre
 * as demais páginas numa folha inferior.
 */
export function BottomNav() {
  const { pathname } = useLocation();
  const reduced = usePrefersReducedMotion();
  const barRef = useRef<HTMLElement>(null);
  const orbRef = useRef<HTMLSpanElement>(null);
  const bgRef = useRef<SVGSVGElement>(null);
  const placed = useRef(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const sheetId = useId();

  const activeTab = TABS.findIndex((i) => isActivePath(i, pathname));
  const moreActive = activeTab < 0 && MORE.some((i) => isActivePath(i, pathname));
  // Aba destacada: uma das abas, "Mais" (última posição) ou nenhuma.
  const activeIndex = moreOpen ? TABS.length : activeTab >= 0 ? activeTab : moreActive ? TABS.length : -1;

  // Círculo e cavidade da aba ativa: deslizam juntos (só transform, no compositor — não trava
  // enquanto a página nova monta) até o centro real da aba, medido no DOM.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const orb = orbRef.current;
    const bg = bgRef.current;
    if (!bar || !orb || !bg) return;
    const place = (animate: boolean) => {
      const w = bar.clientWidth;
      const h = bar.clientHeight;
      const tab = bar.querySelectorAll<HTMLElement>('.bn-tab')[activeIndex];
      const { line, fill } = barPaths(w, h, !!tab);
      bg.setAttribute('width', String(2 * w));
      bg.setAttribute('height', String(h));
      bg.setAttribute('viewBox', `0 0 ${2 * w} ${h}`);
      bg.children[0]?.setAttribute('d', fill);
      bg.children[1]?.setAttribute('d', line);
      orb.style.opacity = tab ? '1' : '0';
      if (!tab) return;
      const cx = tab.offsetLeft + tab.offsetWidth / 2;
      const moves: [Element & ElementCSSInlineStyle, string][] = [
        [orb, `translate3d(${cx}px, 0, 0)`],
        [bg, `translate3d(${cx - w}px, 0, 0)`],
      ];
      if (!animate || reduced || !placed.current) {
        for (const [el, transform] of moves) {
          el.style.transition = 'none';
          el.style.transform = transform;
        }
        void orb.getBoundingClientRect();
        for (const [el] of moves) el.style.transition = '';
        placed.current = true;
        return;
      }
      for (const [el, transform] of moves) el.style.transform = transform;
    };
    place(true);
    // Só reposiciona se a largura da barra mudar (o observador também dispara ao ser ligado, e isso
    // cortaria o deslize no meio).
    let width = bar.clientWidth;
    const ro = new ResizeObserver(() => {
      if (bar.clientWidth === width) return;
      width = bar.clientWidth;
      place(false);
    });
    ro.observe(bar);
    return () => ro.disconnect();
  }, [activeIndex, reduced]);

  // Folha "Mais": fecha ao navegar, com Esc ou tocando fora.
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  // Teclado virtual aberto: a barra sai de cena para não cobrir o campo.
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.matches('textarea, select, [contenteditable="true"]') || (el.matches('input') && !/^(checkbox|radio|button|submit|range|color|file)$/.test((el as HTMLInputElement).type)));
    const onIn = (e: FocusEvent) => isField(e.target) && setTyping(true);
    const onOut = () => setTyping(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  const label = (item: NavItem) => SHORT_LABEL[item.path] ?? item.label;
  const OrbIcon = activeIndex === TABS.length ? (moreOpen ? X : LayoutGrid) : TABS[activeIndex]?.icon;

  return (
    <>
      {moreOpen && <div className="bn-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />}
      {moreOpen && (
        <div id={sheetId} className="bn-sheet" role="dialog" aria-label="Mais páginas">
          <div className="bn-sheet-grid">
            {MORE.map((item) => {
              const Icon = item.icon;
              const content = (
                <>
                  <span className="bn-sheet-icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span>{item.label}</span>
                </>
              );
              return item.openInNewTab ? (
                <a key={item.path} href={item.path} target="_blank" rel="noopener noreferrer" className="bn-sheet-item" onClick={() => setMoreOpen(false)}>
                  {content}
                </a>
              ) : (
                <NavLink key={item.path} to={item.path} className={({ isActive }) => `bn-sheet-item ${isActive ? 'active' : ''}`}>
                  {content}
                </NavLink>
              );
            })}
          </div>
        </div>
      )}

      <nav ref={barRef} className={`bn-bar ${typing ? 'is-hidden' : ''}`} aria-label="Navegação principal">
        <span className="bn-bg" aria-hidden="true">
          <svg ref={bgRef}>
            <path className="bn-bg-fill" />
            <path className="bn-bg-line" />
          </svg>
        </span>
        <span ref={orbRef} className="bn-orb" aria-hidden="true">
          <span className="bn-orb-circle">
            {/* A chave troca o ícone com uma entrada curta quando a aba muda. */}
            {OrbIcon && <OrbIcon key={`${activeIndex}-${moreOpen}`} size={21} strokeWidth={2} />}
          </span>
        </span>
        {TABS.map((item, i) => {
          const Icon = item.icon;
          const center = item.path === '/supervisor';
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={`bn-tab ${center ? 'bn-tab-center' : ''} ${activeIndex === i ? 'is-active' : ''}`}
              aria-current={activeTab === i ? 'page' : undefined}
              onClick={() => setMoreOpen(false)}
            >
              <Icon size={22} strokeWidth={2} aria-hidden="true" />
              {center ? (
                <>
                  <span className="bn-label-long">{item.label}</span>
                  <span className="bn-label-short">Supervisor</span>
                </>
              ) : (
                <span>{label(item)}</span>
              )}
            </NavLink>
          );
        })}
        <button
          type="button"
          className={`bn-tab ${activeIndex === TABS.length ? 'is-active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? sheetId : undefined}
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setMoreOpen((o) => !o)}
        >
          {moreOpen ? <X size={22} strokeWidth={2} aria-hidden="true" /> : <LayoutGrid size={22} strokeWidth={2} aria-hidden="true" />}
          <span>Mais</span>
        </button>
      </nav>
    </>
  );
}
