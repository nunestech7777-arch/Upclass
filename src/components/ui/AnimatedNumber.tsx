import React, { useEffect, useMemo, useRef, useState } from 'react';
import { countDelayFor, easeOutExpo, usePrefersReducedMotion, COUNT_DURATION_MS, SCROLL_COUNT_DELAY_MS } from '../../lib/motion';

/**
 * Contagem compartilhada por todos os números do sistema (mesma duração e curva do Dashboard).
 * A primeira contagem parte de zero e só começa quando o número entra na área visível; o atraso
 * acompanha a entrada do card (prop `delay` ou, sem ela, a posição do card na cascata da página).
 * Depois só anima quando os valores mudam de fato, partindo do que está na tela — recarregar com
 * o mesmo dado não reinicia a contagem. Com movimento reduzido mostra o valor final direto.
 */
function useCountUp(targets: readonly number[], delay: number | undefined, duration: number) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<number[]>(() => targets.map(() => 0));
  const shownRef = useRef<number[]>(targets.map(() => 0));
  const delayRef = useRef<number | undefined>(delay);
  const elRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const key = targets.join('|');

  useEffect(() => {
    const el = elRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    let first = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Visível já na abertura: segue a cascata; revelado na rolagem: acompanha o card.
          if (!first) delayRef.current = SCROLL_COUNT_DELAY_MS;
          else if (delayRef.current === undefined) delayRef.current = countDelayFor(el);
          setVisible(true);
          io.disconnect();
        }
        first = false;
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const to = key ? key.split('|').map(Number) : [];
    if (reduced) {
      // Fica sincronizado com o valor final: desligar a preferência depois não dispara contagem.
      shownRef.current = to;
      setShown(to);
      return;
    }
    const from = to.map((_, i) => shownRef.current[i] ?? 0);
    if (from.every((v, i) => v === to[i])) return;
    const whole = to.map((v, i) => Number.isInteger(v) && Number.isInteger(from[i]));
    const wait = delayRef.current ?? 0;
    delayRef.current = 0;
    let raf = 0;
    let start = 0;
    let prev = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      // Se a página travou (quadro muito atrasado), a contagem retoma de onde parou em vez de pular.
      if (prev && now - prev > 100) start += now - prev - 16;
      prev = now;
      const t = Math.min(1, Math.max(0, (now - start - wait) / duration));
      const k = easeOutExpo(t);
      const next = to.map((v, i) => {
        const x = t >= 1 ? v : from[i] + (v - from[i]) * k;
        return whole[i] ? Math.round(x) : x;
      });
      shownRef.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, reduced, duration, visible]);

  return { elRef, shown, reduced };
}

interface NumberProps {
  value: number | null | undefined;
  /** O mesmo formatador usado no texto estático (brl, pct, int…), aplicado a cada quadro. */
  format: (value: number | null | undefined) => string;
  duration?: number;
  /** Atraso da primeira contagem; sem ele, segue a posição do card na cascata da página. */
  delay?: number;
  className?: string;
}

/** Número com formatador próprio (o Dashboard usa este). */
export function AnimatedNumber({ value, format, duration = COUNT_DURATION_MS, delay, className }: NumberProps) {
  const valid = value != null && Number.isFinite(value);
  const targets = useMemo(() => (valid ? [value as number] : []), [valid, value]);
  const { elRef, shown, reduced } = useCountUp(targets, delay, duration);
  const display = reduced || !valid ? value : shown[0] ?? 0;
  return (
    <span ref={elRef} className={`uc-num ${className ?? ''}`}>
      {format(display)}
    </span>
  );
}

// Números no formato pt-BR dentro de um texto: "1.234,56", "94", "19,6".
const TOKEN = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;
// Datas e horários ("01/10/2026", "13:45") não contam.
const NOT_A_QUANTITY = /\d\s?[/:]\d|\d[/:]\s?\d/;

interface Token {
  value: number;
  decimals: number;
  grouped: boolean;
}

function parseText(text: string): { parts: string[]; tokens: Token[] } | null {
  if (NOT_A_QUANTITY.test(text.replace(/\s\/\s/g, ' de '))) return null;
  const parts: string[] = [];
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    parts.push(text.slice(last, m.index));
    const [int, dec = ''] = raw.split(',');
    tokens.push({
      value: Number(`${int.replace(/\./g, '')}.${dec || '0'}`),
      decimals: dec.length,
      grouped: raw.includes('.') || int.length < 4,
    });
    last = (m.index ?? 0) + raw.length;
  }
  parts.push(text.slice(last));
  return tokens.length ? { parts, tokens } : null;
}

function formatToken(v: number, t: Token): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: t.decimals, maximumFractionDigits: t.decimals, useGrouping: t.grouped });
}

interface TextProps {
  /** Texto já formatado pelos formatadores do sistema; cada número dentro dele conta, o resto fica igual. */
  text: string;
  duration?: number;
  delay?: number;
  className?: string;
}

/** Valor já formatado ("R$ 1.234,56", "19,6%", "94 / 200", "17 un."): conta preservando o formato. */
export function AnimatedText({ text, duration = COUNT_DURATION_MS, delay, className }: TextProps) {
  const parsed = useMemo(() => parseText(text), [text]);
  const targets = useMemo(() => parsed?.tokens.map((t) => t.value) ?? [], [parsed]);
  const { elRef, shown, reduced } = useCountUp(targets, delay, duration);
  const content =
    !parsed || reduced
      ? text
      : parsed.parts.reduce((acc, part, i) => acc + part + (i < parsed.tokens.length ? formatToken(shown[i] ?? 0, parsed.tokens[i]) : ''), '');
  return (
    <span ref={elRef} className={`uc-num ${parsed ? 'is-qty' : ''} ${className ?? ''}`}>
      {content}
    </span>
  );
}

/** Para componentes que recebem o valor pronto (string, número ou elemento): conta quando é texto. */
export function CountUpValue({ value }: { value: React.ReactNode }) {
  if (typeof value === 'string') return <AnimatedText text={value} />;
  if (typeof value === 'number') return <AnimatedText text={value.toLocaleString('pt-BR')} />;
  return <>{value}</>;
}
