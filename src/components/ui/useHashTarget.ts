import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const WAIT_MS = 4000;
/** Depois de chegar, a página ainda pode crescer acima da seção (blocos carregando): reajusta a posição. */
const SETTLE_MS = 5000;

/**
 * Link com #id (ex.: card que leva a /metas#meta-mensal): rola até a seção quando ela aparece na tela
 * (a página pode ainda estar carregando) e a destaca por um instante.
 */
export function useHashTarget() {
  const { pathname, hash, key } = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    const timers: number[] = [];
    let observer: ResizeObserver | null = null;
    let userScrolled = false;
    const stop = () => (userScrolled = true);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', stop);
    // Arrastar a barra de rolagem ou tocar/clicar na página também é o usuário assumindo a rolagem.
    window.addEventListener('pointerdown', stop, { passive: true });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollTo = (el: HTMLElement, smooth: boolean) => el.scrollIntoView({ behavior: smooth && !reduced ? 'smooth' : 'auto', block: 'start' });
    const started = Date.now();
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        // Seção recolhível (<details>): abre para mostrar o conteúdo que o card prometeu.
        if (el instanceof HTMLDetailsElement) el.open = true;
        scrollTo(el, true);
        el.classList.remove('uc-target-flash');
        void el.offsetWidth;
        el.classList.add('uc-target-flash');
        const anchor = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        // Enquanto o conteúdo acima ainda muda de tamanho, mantém a seção no lugar (até o usuário rolar).
        const realign = () => {
          if (userScrolled || !el.isConnected) return;
          if (Math.abs(el.getBoundingClientRect().top - anchor) > 24) scrollTo(el, false);
        };
        let pending = 0;
        observer = new ResizeObserver(() => {
          window.clearTimeout(pending);
          pending = window.setTimeout(realign, 150);
          timers.push(pending);
        });
        observer.observe(document.body);
        timers.push(window.setTimeout(() => observer?.disconnect(), SETTLE_MS));
        return;
      }
      if (Date.now() - started < WAIT_MS) timers.push(window.setTimeout(tryScroll, 120));
    };
    timers.push(window.setTimeout(tryScroll, 60));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      observer?.disconnect();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', stop);
      window.removeEventListener('pointerdown', stop);
    };
  }, [pathname, hash, key]);
}
