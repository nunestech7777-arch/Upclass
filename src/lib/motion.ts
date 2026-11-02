import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia?.(QUERY);
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

const isReduced = (): boolean => (typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches) ?? false;

/** Preferência do sistema por movimento reduzido (reage se o usuário mudar com a página aberta). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(QUERY).matches ?? false,
    () => false
  );
}

/** Intervalo da cascata de entrada (o mesmo de --dv-stagger em dashboard.css). */
export const STAGGER_MS = 55;

/** Atraso para a contagem de um número começar quando o card da posição `i` da cascata já está visível. */
export const countDelay = (i: number): number => 220 + i * STAGGER_MS;

/** Duração da contagem dos números e atraso quando o card é revelado pela rolagem. */
export const COUNT_DURATION_MS = 900;
export const SCROLL_COUNT_DELAY_MS = 180;

/** Barras de progresso: mesma duração e curva da contagem, para andarem juntas com o número ao lado. */
export const BAR_DURATION_MS = COUNT_DURATION_MS;
export const BAR_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** Atraso da contagem de um número conforme o card em que está (marcado por usePageMotion ou, no Dashboard, --dv-i). */
export function countDelayFor(el: Element): number {
  const card = el.closest<HTMLElement>('[data-uc-i], [data-uc-scroll]');
  if (!card) {
    const i = parseFloat(getComputedStyle(el).getPropertyValue('--dv-i'));
    return countDelay(Number.isFinite(i) ? i : 0);
  }
  if (card.dataset.ucScroll != null) return SCROLL_COUNT_DELAY_MS;
  return countDelay(Number(card.dataset.ucI) || 0);
}

/**
 * Momento da primeira exibição de um número ou barra: quando entra na área visível. Na abertura segue
 * a cascata do card (`delay` ou a posição do card); revelado pela rolagem, acompanha a entrada do card.
 * `takeDelay` entrega esse atraso uma única vez — mudanças de valor depois disso começam na hora.
 */
export function useFirstVisible(ref: RefObject<Element | null>, delay?: number) {
  const [visible, setVisible] = useState(false);
  const delayRef = useRef<number | undefined>(delay);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    let first = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!first) delayRef.current = SCROLL_COUNT_DELAY_MS;
          else if (delayRef.current === undefined) delayRef.current = countDelayFor(el);
          setVisible(true);
          io.disconnect();
        }
        first = false;
      },
      { rootMargin: revealRootMargin() }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  const takeDelay = (): number => {
    const d = delayRef.current ?? 0;
    delayRef.current = 0;
    return d;
  };
  return { visible, takeDelay };
}

/** Mesma curva do token --ease-out (cubic-bezier(.16, 1, .3, 1)), aproximada por expo-out para uso em JS. */
export const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Borda de baixo da área considerada visível, em relação a `innerHeight`. No computador, um bloco entra
 * quando já mostra 24 px. Em telas de toque o navegador desenha a página também por baixo das barras
 * flutuantes (Safari no iPhone: ~80 px abaixo do `innerHeight`), então essa faixa conta como visível —
 * senão um card que aparece sob a barra de vidro ficaria oculto, deixando um vão na tela.
 */
const viewportBottomExtra = (): number =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 96 : -24;
const revealRootMargin = (): string => `0px 0px ${viewportBottomExtra()}px 0px`;

/**
 * Observa quando um bloco chega à tela para ser revelado. Dois critérios, para servir a qualquer
 * tamanho: o bloco chegou à borda visível (viewportBottomExtra; blocos altos, como tabelas longas, que nunca ficam
 * com boa parte visível) ou o bloco está inteiro visível (um item pequeno no fim da página). `onReveal` recebe só os que acabaram de chegar.
 */
export function createRevealObserver(onReveal: (els: HTMLElement[]) => void) {
  const handle = (entries: IntersectionObserverEntry[]) => {
    const els = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
    if (els.length) onReveal(els);
  };
  const byTop = new IntersectionObserver(handle, { rootMargin: revealRootMargin() });
  const whole = new IntersectionObserver(handle, { threshold: 1 });
  return {
    observe(el: Element) {
      byTop.observe(el);
      whole.observe(el);
    },
    unobserve(el: Element) {
      byTop.unobserve(el);
      whole.unobserve(el);
    },
    disconnect() {
      byTop.disconnect();
      whole.disconnect();
    },
  };
}

/**
 * Revela na rolagem: entre os elementos de `selector` dentro de `ref`, os que já estão abaixo da
 * dobra ao montar ficam ocultos (`rv-pending`) e entram (`rv-in`, com `--rv-i` para a cascata do
 * lote) quando chegam à área visível. Os que já aparecem na tela seguem a entrada normal.
 * Roda antes da pintura para não piscar. `active` liga o efeito quando o conteúdo existir.
 */
export function useScrollReveal(ref: RefObject<HTMLElement | null>, selector: string, active: boolean): void {
  const reduced = usePrefersReducedMotion();
  useLayoutEffect(() => {
    const root = ref.current;
    if (!active || !root || reduced || typeof IntersectionObserver === 'undefined') return;
    const fold = window.innerHeight + viewportBottomExtra();
    const targets = [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => el.getBoundingClientRect().top > fold);
    if (!targets.length) return;
    for (const el of targets) el.classList.add('rv-pending');
    const io = createRevealObserver((els) => {
      let batch = 0;
      for (const el of els) {
        io.unobserve(el);
        if (!el.classList.contains('rv-pending')) continue;
        el.style.setProperty('--rv-i', String(batch++));
        el.classList.replace('rv-pending', 'rv-in');
      }
    });
    for (const el of targets) io.observe(el);
    return () => {
      io.disconnect();
      // Se o efeito for desfeito antes da rolagem, nada fica escondido.
      for (const el of targets) el.classList.remove('rv-pending');
    };
  }, [ref, selector, active, reduced]);
}

/**
 * Animação das séries do Recharts igual à do gráfico do Dashboard: linhas se desenham da esquerda
 * para a direita, barras sobem, áreas e pizzas crescem; em atualizações o Recharts transforma o
 * desenho anterior. Desligada com movimento reduzido. Uso: `<Line {...chartMotion()} … />`.
 */
export function chartMotion(reduced: boolean = isReduced()) {
  return { isAnimationActive: !reduced, animationBegin: 150, animationDuration: 1100, animationEasing: 'ease-out' as const };
}

/* ------------------------------------------------------------------------------------------------
 * Entrada das demais páginas — a mesma cascata do Dashboard aplicada por JS a qualquer rota.
 * Cada bloco visível (cards, painéis e os trechos de texto entre eles) sai do desfoque em ordem de
 * leitura, com o mesmo intervalo, duração e curva do Dashboard; o que está abaixo da dobra espera e
 * entra na rolagem; barras (AnimatedBar) e números crescem com o card; o título se revela da esquerda para
 * a direita. Usa a Web Animations API para não depender das classes que o React controla.
 * ---------------------------------------------------------------------------------------------- */

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const ENTER_MS = 800;
const ENTER_LITE_MS = 600;
const MAX_CASCADE = 12;
const HEAD_DELAY_MS = 100;

/** Cards e painéis do sistema: cada um entra como uma peça (como os cards do Dashboard). */
export const CARD_SELECTOR = [
  '.fin-kpi', '.fin-panel', '.card', '.dashboard-metric-card', '.mc-card', '.mc-filters-card', '.seller-kpi-card',
  '.seller-card', '.leader-card', '.fc-card', '.fin-goal-box', '.sv-panel', '.sv-status-card', '.sv-seller-card',
  '.sv-att-card', '.sales-table-card', '.inventory-table-card', '.sold-summary-card', '.profile-section',
].join(', ');
const SKIP_SELECTOR = [
  '.dv-page', '[role="dialog"]', '[aria-modal="true"]', '.fin-drawer-root', '.fin-modal-root', '.modal-overlay',
  '.mc-modal-overlay', '.sold-modal-overlay', '.sales-modal-shell', '.seller-photo-modal', '.access-modal', '.turn-modal',
  '.fin-tooltip', '.recharts-wrapper', 'script', 'style',
].join(', ');

const FULL: Keyframe[] = [
  { opacity: 0, transform: 'translateY(14px) scale(0.985)', filter: 'blur(8px)' },
  { opacity: 1, transform: 'none', filter: 'none' },
];
const LITE: Keyframe[] = [
  { opacity: 0, transform: 'translateY(10px)' },
  { opacity: 1, transform: 'none' },
];

const isLite = () => window.matchMedia?.('(max-width: 760px), (pointer: coarse)').matches ?? false;

/**
 * Chama `cb` quando a página para de travar: dois quadros seguidos rápidos (telas pesadas, como o
 * Meu Supervisor, renderizam por centenas de ms logo depois de receber os dados). Limite de 1,2 s.
 */
function whenSettled(cb: () => void): () => void {
  let raf = 0;
  let last = 0;
  let calm = 0;
  const t0 = performance.now();
  const step = (now: number) => {
    calm = last && now - last < 40 ? calm + 1 : 0;
    last = now;
    if (calm >= 2 || now - t0 > 1200) cb();
    else raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Peças da página em ordem de documento: cards inteiros e blocos sem card dentro; wrappers são abertos. */
function collectPieces(root: Element, out: HTMLElement[], depth = 0): void {
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || child.matches(SKIP_SELECTOR)) continue;
    if (child.getClientRects().length === 0) continue;
    if (child.matches(CARD_SELECTOR) || depth >= 6 || !child.querySelector(CARD_SELECTOR)) out.push(child);
    else collectPieces(child, out, depth + 1);
  }
}

function enter(el: HTMLElement, delay: number, lite: boolean): Animation {
  const anim = el.animate(lite ? LITE : FULL, { duration: lite ? ENTER_LITE_MS : ENTER_MS, easing: EASE, delay, fill: 'backwards' });
  const title = el.matches('h1') ? el : el.querySelector<HTMLElement>('h1');
  if (title && !lite) revealTitle(title, delay + 80);
  return anim;
}

/** Título que se revela da esquerda para a direita (o mesmo do "Dashboard"). */
function revealTitle(title: HTMLElement, delay: number): void {
  const mask = 'linear-gradient(90deg, #000 45%, transparent 55%)';
  title.style.setProperty('mask-image', mask);
  title.style.setProperty('-webkit-mask-image', mask);
  title.style.setProperty('mask-size', '250% 100%');
  title.style.setProperty('-webkit-mask-size', '250% 100%');
  const anim = title.animate(
    [
      { maskPosition: '100% 0', WebkitMaskPosition: '100% 0', transform: 'translateX(-6px)' },
      { maskPosition: '0 0', WebkitMaskPosition: '0 0', transform: 'none' },
    ] as Keyframe[],
    { duration: 900, easing: EASE, delay, fill: 'backwards' }
  );
  const clear = () => {
    for (const p of ['mask-image', '-webkit-mask-image', 'mask-size', '-webkit-mask-size']) title.style.removeProperty(p);
  };
  anim.onfinish = clear;
  anim.oncancel = clear;
}

/**
 * Liga a entrada em cascata no container das páginas (`.main-content`). Observa o que o React
 * adiciona: a primeira leva de uma rota e o conteúdo que chega depois do carregamento entram em
 * sequência; o que já foi animado (mesmo nó do DOM) não anima de novo em re-renderizações.
 */
export function usePageMotion(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const main = ref.current;
    if (!main || typeof MutationObserver === 'undefined') return;
    const seen = new WeakSet<Element>();
    const pending = new Map<Element, Animation>();
    const waits = new Set<() => void>();
    const holds = new Set<Animation>();
    let firstBatch = true;
    let page: Element | null = null;

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : createRevealObserver((els) => {
            let batch = 0;
            for (const el of els) {
              const anim = pending.get(el);
              io?.unobserve(el);
              pending.delete(el);
              if (!anim) continue;
              anim.cancel();
              el.dataset.ucScroll = '';
              enter(el, batch++ * STAGGER_MS, isLite());
            }
          });

    const scan = () => {
      // Nova rota = novo elemento raiz: a primeira leva espera o cabeçalho, como no Dashboard.
      if (main.firstElementChild !== page) {
        page = main.firstElementChild;
        firstBatch = true;
      }
      if (!page || page.matches('.dv-page')) return;
      const pieces: HTMLElement[] = [];
      collectPieces(page, pieces);
      const fresh = pieces.filter((el) => !seen.has(el));
      if (!fresh.length) return;
      for (const el of fresh) seen.add(el);
      if (isReduced()) return;
      const lite = isLite();
      const fold = window.innerHeight + viewportBottomExtra();
      const base = firstBatch ? HEAD_DELAY_MS : 0;
      firstBatch = false;
      const inView = fresh
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ el, rect }) => {
          if (rect.top <= fold || !io) return true;
          // Abaixo da dobra: fica no estado inicial até chegar à tela.
          const anim = el.animate(lite ? LITE : FULL, { duration: 1, fill: 'both' });
          anim.pause();
          pending.set(el, anim);
          io.observe(el);
          return false;
        })
        // Ordem de leitura: linha por linha (tolerância de meia linha), da esquerda para a direita.
        .sort((a, b) => (Math.abs(a.rect.top - b.rect.top) > 12 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left));
      // Ficam no estado inicial até a página estabilizar; então entram em cascata, sem pular quadros.
      const batchHolds = inView.map(({ el }, i) => {
        el.dataset.ucI = String(Math.min(i, MAX_CASCADE));
        const hold = el.animate(lite ? LITE : FULL, { duration: 1, fill: 'both' });
        hold.pause();
        holds.add(hold);
        return hold;
      });
      const stop = whenSettled(() => {
        waits.delete(stop);
        inView.forEach(({ el }, i) => {
          batchHolds[i].cancel();
          holds.delete(batchHolds[i]);
          enter(el, base + Math.min(i, MAX_CASCADE) * STAGGER_MS, lite);
        });
      });
      waits.add(stop);
    };

    scan();
    // Só interessa quando o React insere elementos; troca de texto (números contando) não varre a página.
    const mo = new MutationObserver((records) => {
      if (records.some((r) => Array.from(r.addedNodes).some((n) => n.nodeType === Node.ELEMENT_NODE))) scan();
    });
    mo.observe(main, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io?.disconnect();
      // Nada pode ficar preso no estado inicial (oculto) se o efeito for desfeito no meio da espera.
      for (const stop of waits) stop();
      for (const hold of holds) hold.cancel();
      for (const anim of pending.values()) anim.cancel();
    };
  }, [ref]);
}
