import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { firstDay, lastDay, storeToday } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import type { FinancialSyncResponse } from '../../lib/finance/financeApi';
import { useFinanceSource } from './useFinance';

const COUNT_LABELS: [string, string][] = [
  ['rows_checked', 'Linhas verificadas'],
  ['rows_ok', 'Conciliadas (custo e lucro)'],
  ['rows_zero_cost', '… com custo zero informado'],
  ['rows_mismatch', 'Lucro divergente'],
  ['rows_ambiguous', 'Ambíguas'],
  ['rows_not_found', 'Pedido ausente no histórico'],
  ['rows_pending_cost', 'Sem custo na origem'],
  ['rows_cancelled', 'Canceladas na origem'],
  ['rows_removed', 'Obsoletas (fora da versão atual do pedido)'],
  ['history_items_without_row', 'Itens do Mercado Phone sem linha no painel'],
  ['rows_to_update', 'Linhas que seriam/foram alteradas'],
];

/**
 * Recuperação do custo histórico por período: prévia primeiro (só leitura), depois aplicação.
 * A aplicação continua automaticamente de onde parou quando o período não cabe numa chamada.
 */
export function FinancialSyncDialog({ month, onClose, onApplied }: { month: string; onClose: () => void; onApplied: () => void }) {
  const source = useFinanceSource();
  const today = storeToday();
  const [start, setStart] = useState(firstDay(month));
  const [end, setEnd] = useState(lastDay(month) < today ? lastDay(month) : today);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [result, setResult] = useState<FinancialSyncResponse | null>(null);
  const [applied, setApplied] = useState(false);

  const run = async (mode: 'preview' | 'apply') => {
    setBusy(mode);
    setResult(null);
    try {
      let from = start;
      let total: Record<string, number> = {};
      let issues: NonNullable<FinancialSyncResponse['issues']> = [];
      for (;;) {
        const res = await source.runSync(from, end, mode);
        if (!res.ok) {
          setResult(res);
          return;
        }
        total = Object.fromEntries(
          [...new Set([...Object.keys(total), ...Object.keys(res.counts ?? {})])].map((k) => [k, (total[k] ?? 0) + (res.counts?.[k] ?? 0)])
        );
        issues = [...issues, ...(res.issues ?? [])].slice(0, 100);
        if (!res.next_start) break;
        from = res.next_start;
      }
      setResult({ ok: true, mode, counts: total, issues });
      if (mode === 'apply') {
        setApplied(true);
        onApplied();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fin-modal-root" role="dialog" aria-modal="true" aria-label="Conciliar custos com o Mercado Phone">
      <div className="fin-drawer-backdrop" onClick={onClose} />
      <div className="fin-modal">
        <header className="fin-modal-head">
          <h3>Conciliar custos com o Mercado Phone</h3>
          <button type="button" className="fin-icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <p className="fin-muted fin-small">
          Busca receita líquida, custo histórico e lucro de cada item no histórico de vendas do Mercado Phone e confere com as vendas do
          painel. Linhas nunca são apagadas: canceladas e obsoletas ficam marcadas. Comece por um período curto e confira a prévia.
        </p>
        <div className="fin-sync-form">
          <label>
            De
            <input type="date" className="fin-input" value={start} max={end} onChange={(e) => { setStart(e.target.value); setResult(null); }} />
          </label>
          <label>
            Até
            <input type="date" className="fin-input" value={end} min={start} max={today} onChange={(e) => { setEnd(e.target.value); setResult(null); }} />
          </label>
        </div>
        {result && !result.ok && <p className="tone-deficit fin-small">Falha: {result.error}</p>}
        {result?.ok && (
          <div className="fin-sync-result">
            <strong>{result.mode === 'apply' ? 'Conciliação aplicada' : 'Prévia (nada foi gravado)'}</strong>
            <dl>
              {COUNT_LABELS.map(([k, label]) => (
                <React.Fragment key={k}>
                  <dt>{label}</dt>
                  <dd>{int(result.counts?.[k] ?? 0)}</dd>
                </React.Fragment>
              ))}
            </dl>
            {result.issues && result.issues.length > 0 && (
              <details>
                <summary>{int(result.issues.length)} ocorrência(s) para conferência</summary>
                <ul className="fin-msg-list">
                  {result.issues.map((i, idx) => (
                    <li key={idx}>
                      Pedido {i.orderId}: {i.detail}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <footer className="fin-modal-foot">
          <button type="button" className="fin-btn" onClick={() => run('preview')} disabled={!!busy}>
            {busy === 'preview' && <Loader2 size={14} className="fin-spin" />} Gerar prévia
          </button>
          <button
            type="button"
            className="fin-btn is-primary"
            disabled={!!busy || !result?.ok || result.mode !== 'preview' || applied}
            onClick={() => run('apply')}
            title={!result?.ok || result.mode !== 'preview' ? 'Gere a prévia do período antes de aplicar' : undefined}
          >
            {busy === 'apply' && <Loader2 size={14} className="fin-spin" />} Aplicar conciliação
          </button>
        </footer>
      </div>
    </div>
  );
}
