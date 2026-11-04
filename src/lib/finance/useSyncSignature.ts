import { useCallback, useEffect, useRef } from 'react';
import { FINANCIAL_UPDATED_EVENT } from '../notices/noticesApi';

/** Leitura leve em segundo plano (mesmo ritmo do sino de avisos). */
export const SIGNATURE_POLL_MS = 2 * 60_000;
/** Voltar à aba relê a assinatura só se a última leitura tiver mais que isto. */
const REFOCUS_MIN_MS = 15_000;

/**
 * Observa a assinatura da sincronização financeira (última execução da rotina e última tentativa de
 * conciliação — muda quando a rotina roda, concilia ou recebe venda) e chama `onChange` quando ela muda.
 * Duas leituras de 1 linha a cada 2 min com a aba visível, ao voltar para a aba e depois de uma
 * conciliação manual; nada consulta o MercadoPhone. A primeira leitura só guarda a referência.
 *
 * `baseline()` lê e guarda a assinatura atual sem disparar `onChange` — usar ANTES de recarregar os
 * dados, para uma mudança no meio da recarga não passar despercebida.
 */
export function useSyncSignature(read: (() => Promise<string>) | undefined, onChange: () => void) {
  const seen = useRef<string | null>(null);
  const checkedAt = useRef(0);
  const inflight = useRef(false);
  const changed = useRef(onChange);
  changed.current = onChange;

  const check = useCallback(async () => {
    if (!read || inflight.current) return;
    inflight.current = true;
    checkedAt.current = Date.now();
    try {
      const sig = await read();
      const before = seen.current;
      seen.current = sig;
      if (before !== null && before !== sig) changed.current();
    } catch {
      // Rede ou sessão: a próxima leitura tenta de novo; os dados na tela continuam válidos.
    } finally {
      inflight.current = false;
    }
  }, [read]);

  const baseline = useCallback(async () => {
    if (!read) return;
    try {
      seen.current = await read();
      checkedAt.current = Date.now();
    } catch {
      // sem referência: a próxima leitura só guarda
    }
  }, [read]);

  useEffect(() => {
    if (!read) return;
    void check();
    const visible = () => document.visibilityState === 'visible';
    const timer = window.setInterval(() => visible() && void check(), SIGNATURE_POLL_MS);
    const onFocus = () => visible() && Date.now() - checkedAt.current > REFOCUS_MIN_MS && void check();
    const onUpdated = () => void check();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    window.addEventListener(FINANCIAL_UPDATED_EVENT, onUpdated);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(FINANCIAL_UPDATED_EVENT, onUpdated);
    };
  }, [read, check]);

  return { baseline };
}
