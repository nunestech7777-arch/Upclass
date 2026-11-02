import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Notice } from './notices';

/**
 * Avisos publicados pela página aberta (do período que ela já carregou): vão para a Central de
 * Avisos em vez de ficar fixos na tela. Somem quando a página sai ou o período muda — nada é
 * consultado nem gravado aqui.
 */
interface PageNoticesValue {
  notices: Notice[];
  publish: (key: string, notices: Notice[]) => void;
}

const PageNoticesContext = createContext<PageNoticesValue | null>(null);

export function PageNoticesProvider({ children }: { children: React.ReactNode }) {
  const [byKey, setByKey] = useState<Record<string, Notice[]>>({});
  const publish = useCallback((key: string, notices: Notice[]) => {
    setByKey((prev) => {
      if (notices.length === 0) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: notices };
    });
  }, []);
  const value = useMemo(() => ({ notices: Object.values(byKey).flat(), publish }), [byKey, publish]);
  return <PageNoticesContext.Provider value={value}>{children}</PageNoticesContext.Provider>;
}

/** Avisos das páginas abertas (lidos pela central). */
export function usePageNoticeList(): Notice[] {
  return useContext(PageNoticesContext)?.notices ?? [];
}

/** A página publica seus avisos enquanto estiver aberta. `notices` deve vir de um useMemo. */
export function usePageNotices(key: string, notices: Notice[]) {
  const publish = useContext(PageNoticesContext)?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(key, notices);
    return () => publish(key, []);
  }, [publish, key, notices]);
}
