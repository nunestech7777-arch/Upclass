import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { NAV_ITEMS, isActivePath, type NavItem } from './navItems';
import { BrandLogo } from './brand/BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { usePrefersReducedMotion } from '../lib/motion';
import './TopNav.css';

// Espaço extra do item selecionado (ícone + espaçamento) e intervalo entre itens no trilho.
const ICON_EXTRA = 24;
const GAP = 2;
const CHEVRON_EXTRA = 23; // seta do "Mais" (15px) + espaçamento (8px)
const PILL_MS = 340;
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

function ItemContent({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <>
      <Icon size={16} strokeWidth={2.2} aria-hidden="true" />
      <span>{item.label}</span>
    </>
  );
}

/**
 * Barra superior no estilo do vídeo de referência: logo, trilho arredondado com as páginas (a selecionada
 * numa pílula que desliza com desfoque de movimento e é a única com ícone), tema e conta. O que não cabe
 * na largura disponível vai para o botão "Mais" — no celular, as páginas ficam numa segunda linha.
 */
export function TopNav() {
  const { pathname } = useLocation();
  const reduced = usePrefersReducedMotion();
  const navRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState(NAV_ITEMS.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreId = useId();

  const visible = NAV_ITEMS.slice(0, visibleCount);
  const overflow = NAV_ITEMS.slice(visibleCount);
  const activeOverflow = overflow.find((i) => isActivePath(i, pathname)) ?? null;

  // Quantas páginas cabem no trilho (mede os rótulos numa cópia invisível).
  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const fit = () => {
      const widths = Array.from(measure.querySelectorAll<HTMLElement>('[data-measure="item"]')).map((el) => el.offsetWidth);
      const moreW = measure.querySelector<HTMLElement>('[data-measure="more"]')?.offsetWidth ?? 90;
      const avail = nav.clientWidth - 8; // padding do trilho
      const activeIdx = NAV_ITEMS.findIndex((i) => isActivePath(i, pathname));
      const width = (i: number) => widths[i] + (i === activeIdx ? ICON_EXTRA : 0);
      const all = widths.reduce((sum, _, i) => sum + width(i) + (i ? GAP : 0), 0);
      if (all <= avail) return setVisibleCount(NAV_ITEMS.length);
      // Se a página atual cair no "Mais", o botão mostra o nome dela (ícone + rótulo + seta), bem mais largo que "Mais".
      const reserve = (visibleItems: number) =>
        activeIdx >= visibleItems ? widths[activeIdx] + ICON_EXTRA + CHEVRON_EXTRA : moreW + ICON_EXTRA;
      let used = 0;
      let count = 0;
      for (let i = 0; i < widths.length; i++) {
        const next = used + (count ? GAP : 0) + width(i);
        if (next + GAP + reserve(i + 1) > avail) break;
        used = next;
        count++;
      }
      setVisibleCount(Math.max(1, count));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(nav);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [pathname]);

  // Pílula: acompanha o item selecionado quadro a quadro (o ícone entra e os vizinhos se ajustam),
  // com desfoque proporcional à velocidade — o "motion blur" do vídeo.
  const pillState = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const pillAnim = useRef(0);
  const pillBusyUntil = useRef(0);
  useLayoutEffect(() => {
    const track = trackRef.current;
    const pill = pillRef.current;
    if (!track || !pill) return;
    const target = () => track.querySelector<HTMLElement>('.tn-link.active, .tn-more-btn.active');
    // Posição em relação ao trilho (o botão "Mais" fica dentro de outro contêiner posicionado).
    const rectOf = (el: HTMLElement) => {
      const t = track.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // Vertical: centro do trilho (a entrada dos itens desloca o eixo Y por alguns instantes).
      return { x: r.left - t.left - track.clientLeft, y: (track.clientHeight - el.offsetHeight) / 2, w: r.width, h: el.offsetHeight };
    };
    const paint = (r: { x: number; y: number; w: number; h: number }, blur = 0) => {
      pill.style.transform = `translate(${r.x}px, ${r.y}px)`;
      pill.style.width = `${r.w}px`;
      pill.style.height = `${r.h}px`;
      pill.style.filter = blur > 0.2 ? `blur(${blur.toFixed(2)}px)` : '';
      pillState.current = r;
    };
    const snap = () => {
      const el = target();
      if (!el) {
        pill.style.opacity = '0';
        pillState.current = null;
        return;
      }
      pill.style.opacity = '1';
      paint(rectOf(el));
    };
    const el = target();
    const from = pillState.current;
    cancelAnimationFrame(pillAnim.current);
    if (!el || !from || reduced) snap();
    else {
      pill.style.opacity = '1';
      const t0 = performance.now();
      pillBusyUntil.current = t0 + PILL_MS;
      let lastX = from.x;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / PILL_MS);
        const k = easeOutQuart(t);
        const to = rectOf(el);
        const cur = { x: from.x + (to.x - from.x) * k, y: to.y, w: from.w + (to.w - from.w) * k, h: to.h };
        const speed = Math.abs(cur.x - lastX);
        lastX = cur.x;
        paint(cur, t < 1 ? Math.min(4, speed * 0.12) : 0);
        if (t < 1) pillAnim.current = requestAnimationFrame(step);
      };
      pillAnim.current = requestAnimationFrame(step);
    }
    // Mudança de tamanho (janela, fonte, "Mais"): reposiciona, a não ser no meio do deslize.
    const ro = new ResizeObserver(() => {
      if (performance.now() >= pillBusyUntil.current) snap();
    });
    ro.observe(track);
    return () => {
      ro.disconnect();
    };
  }, [pathname, visibleCount, reduced]);
  useEffect(() => () => cancelAnimationFrame(pillAnim.current), []);

  // Menu "Mais": fecha ao clicar fora, com Esc ou ao navegar.
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMoreOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        moreRef.current?.querySelector<HTMLButtonElement>('.tn-more-btn')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    moreRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  let seq = 0;
  const enter = () => ({ '--tn-i': seq++ }) as React.CSSProperties;

  return (
    <header className="app-topnav">
      <div className="tn-row">
        <NavLink to="/" className="tn-brand" aria-label="Upclass — ir para o Dashboard" style={enter()}>
          <BrandLogo className="tn-logo" alt="" />
        </NavLink>

        <nav ref={navRef} className="tn-nav" aria-label="Navegação principal">
          <div ref={trackRef} className="tn-track">
            <span ref={pillRef} className="tn-pill" aria-hidden="true" />
            {visible.map((item) =>
              item.openInNewTab ? (
                <a key={item.path} href={item.path} target="_blank" rel="noopener noreferrer" className="tn-link" title="Abre em nova guia" style={enter()}>
                  <ItemContent item={item} />
                </a>
              ) : (
                <NavLink key={item.path} to={item.path} end={item.path === '/'} className={({ isActive }) => `tn-link ${isActive ? 'active' : ''}`} style={enter()}>
                  <ItemContent item={item} />
                </NavLink>
              )
            )}
            {overflow.length > 0 && (
              <div ref={moreRef} className="tn-more" style={enter()}>
                <button
                  type="button"
                  className={`tn-more-btn ${activeOverflow ? 'active' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  aria-controls={moreId}
                  onClick={() => setMoreOpen((o) => !o)}
                >
                  {activeOverflow ? <ItemContent item={activeOverflow} /> : <span>Mais</span>}
                  <ChevronDown size={15} className="tn-more-chevron" aria-hidden="true" />
                </button>
                {moreOpen && (
                  <div id={moreId} className="tn-more-menu" role="menu" aria-label="Mais páginas">
                    {overflow.map((item, i) => {
                      const Icon = item.icon;
                      const groupStart = i === 0 || overflow[i - 1].group !== item.group;
                      const content = (
                        <>
                          <Icon size={17} aria-hidden="true" />
                          <span>{item.label}</span>
                          {item.openInNewTab && <span className="tn-more-hint" aria-label="(abre em nova guia)">↗</span>}
                        </>
                      );
                      return (
                        <React.Fragment key={item.path}>
                          {groupStart && <span className="tn-more-group">{item.group}</span>}
                          {item.openInNewTab ? (
                            <a role="menuitem" href={item.path} target="_blank" rel="noopener noreferrer" className="tn-more-item">
                              {content}
                            </a>
                          ) : (
                            <NavLink role="menuitem" to={item.path} end={item.path === '/'} className={({ isActive }) => `tn-more-item ${isActive ? 'active' : ''}`}>
                              {content}
                            </NavLink>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cópia invisível para medir quanto cabe (rótulos sem ícone + botão "Mais"). */}
          <div ref={measureRef} className="tn-measure" aria-hidden="true">
            {NAV_ITEMS.map((item) => (
              <span key={item.path} className="tn-link" data-measure="item">
                <span>{item.label}</span>
              </span>
            ))}
            <span className="tn-more-btn" data-measure="more">
              <span>Mais</span>
              <ChevronDown size={15} />
            </span>
          </div>
        </nav>

        <div className="tn-actions" style={enter()}>
          <ThemeToggle />
          <span className="tn-divider" aria-hidden="true" />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
