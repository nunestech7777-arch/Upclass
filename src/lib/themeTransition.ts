import { flushSync } from 'react-dom';

type Theme = 'light' | 'dark';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Troca de tema como no vídeo de referência: o tema novo cobre a página inteira num círculo que
 * cresce a partir do botão clicado (nos dois sentidos). Usa View Transitions do navegador; sem
 * suporte ou com movimento reduzido, a troca é imediata.
 */
export function switchThemeFrom(origin: Element | null, next: Theme, apply: (theme: Theme) => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || reducedMotion() || !origin) {
    apply(next);
    return;
  }
  const r = origin.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const transition = doc.startViewTransition(() => {
    flushSync(() => apply(next));
  });
  transition.ready
    .then(() => {
      // Velocidade do vídeo (~4 px/ms), com limites para telas pequenas e grandes.
      const duration = Math.min(620, Math.max(340, radius / 4));
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    })
    .catch(() => {});
}
