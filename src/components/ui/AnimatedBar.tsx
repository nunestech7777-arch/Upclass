import React, { useEffect, useRef, useState } from 'react';
import { BAR_DURATION_MS, BAR_EASING, useFirstVisible, usePrefersReducedMotion } from '../../lib/motion';

interface Props {
  /** Percentual real (pode passar de 100); o preenchimento fica limitado a 100%. */
  pct: number | null | undefined;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Preenchimento de barra de progresso com o padrão do Dashboard: nasce em 0% e cresce até o valor quando
 * aparece (mesma duração, curva e atraso da contagem do número ao lado); em trocas de filtro desliza do
 * valor anterior ao novo; cada entrada na página (inclusive ao voltar) cresce de novo. Movimento reduzido: sem animação.
 */
export function AnimatedBar({ pct, className, style }: Props) {
  const target = pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const { visible, takeDelay } = useFirstVisible(ref);
  const [bar, setBar] = useState({ width: 0, delay: 0 });

  useEffect(() => {
    if (!visible) return;
    const delay = takeDelay();
    setBar((b) => (b.width === target ? b : { width: target, delay }));
    // takeDelay lê/zera um ref; fora das dependências de propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, target]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        display: 'block',
        ...style,
        width: `${bar.width}%`,
        transition: reduced ? 'none' : `width ${BAR_DURATION_MS}ms ${BAR_EASING} ${bar.delay}ms`,
      }}
    />
  );
}
