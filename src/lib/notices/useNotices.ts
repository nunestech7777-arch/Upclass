import { useCallback, useEffect, useRef, useState } from 'react';
import { FINANCIAL_UPDATED_EVENT, fetchNoticeSignature, fetchNotices } from './noticesApi';
import type { Notice } from './notices';

/** Conferência da assinatura com a aba visível (a rotina de conciliação roda a cada 30 min). */
export const NOTICE_POLL_MS = 2 * 60 * 1000;
/** Ao voltar para a aba, só confere se a última conferência tiver mais que isso. */
const REFOCUS_MIN_MS = 60 * 1000;

export interface NoticesState {
  notices: Notice[];
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
  refresh: () => void;
}

/**
 * Avisos derivados dos dados atuais. Barato por desenho: com a aba aberta, a cada 2 min só lê a
 * assinatura (2 linhas); os avisos são relidos quando ela muda (sincronização, webhook, conciliação
 * manual) ou quando a conciliação manual avisa. Aba em segundo plano não consulta nada.
 */
export function useNotices(enabled: boolean): NoticesState {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const signature = useRef<string | null>(null);
  const checkedAt = useRef(0);
  const inflight = useRef(false);
  /** Pedido de releitura durante uma consulta em andamento: roda logo depois dela. */
  const again = useRef(false);
  const alive = useRef(true);

  // `queue`: pedido explícito (botão, conciliação manual) que chega com uma consulta em andamento —
  // roda logo depois dela. A montagem não enfileira (a consulta em andamento já serve).
  const check = useCallback(async (force: boolean, queue = false) => {
    if (inflight.current) {
      if (queue) again.current = true;
      return;
    }
    inflight.current = true;
    checkedAt.current = Date.now();
    try {
      const sig = await fetchNoticeSignature();
      // Leitura ok: um erro anterior (rede) não fica preso quando a assinatura não mudou.
      if (alive.current) setError(null);
      if (!force && sig === signature.current) return;
      if (alive.current) setLoading(true);
      const next = await fetchNotices();
      signature.current = sig;
      if (!alive.current) return;
      setNotices(next);
      setError(null);
      setLoadedAt(Date.now());
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      inflight.current = false;
      if (alive.current) setLoading(false);
      // No finally: vale também quando a assinatura não mudou (retorno antecipado acima).
      if (again.current && alive.current) {
        again.current = false;
        void check(true, true);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    void check(true);
    const visible = () => document.visibilityState === 'visible';
    const timer = window.setInterval(() => visible() && void check(false), NOTICE_POLL_MS);
    const onFocus = () => visible() && Date.now() - checkedAt.current > REFOCUS_MIN_MS && void check(false);
    const onUpdated = () => void check(true, true);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    window.addEventListener(FINANCIAL_UPDATED_EVENT, onUpdated);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(FINANCIAL_UPDATED_EVENT, onUpdated);
    };
  }, [enabled, check]);

  const refresh = useCallback(() => void check(true, true), [check]);
  return { notices, loading, error, loadedAt, refresh };
}
