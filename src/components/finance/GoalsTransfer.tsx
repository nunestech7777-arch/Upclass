import React, { useRef, useState } from 'react';
import { CopyPlus, Download, Upload, X } from 'lucide-react';
import type { FinanceSeller, ProfitGoal } from '../../lib/finance/calc';
import { addMonths, monthLabel } from '../../lib/finance/dates';
import { brl } from '../../lib/finance/format';
import { buildGoalsFile, parseMoneyInput, previewGoalsCopy, previewGoalsImport, validateGoalValues, type GoalsPreview } from '../../lib/finance/goalsIO';
import { useFinanceSource } from './useFinance';

interface Props {
  month: string;
  sellers: FinanceSeller[];
  goals: ProfitGoal[];
  onSaved: () => void;
}

/** Ações de metas do ranking (anexo 01/02): copiar mês anterior, exportar e importar JSON com prévia. */
export function GoalsTransferActions({ month, sellers, goals, onSaved }: Props) {
  const source = useFinanceSource();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ title: string; data: GoalsPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copyPrevious = async () => {
    setError(null);
    try {
      const previous = await source.loadGoals(addMonths(month, -1));
      setPreview({ title: `Copiar metas de ${monthLabel(addMonths(month, -1))}`, data: previewGoalsCopy(previous, sellers, goals) });
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  const exportJson = () => {
    const file = buildGoalsFile(month, goals, sellers);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metas-lucro-${month}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    setError(null);
    try {
      const parsed = JSON.parse(await file.text());
      setPreview({ title: `Importar metas para ${monthLabel(month)}`, data: previewGoalsImport(parsed, month, sellers, goals) });
    } catch {
      setPreview({ title: 'Importar metas', data: { drafts: [], errors: ['O arquivo não é um JSON válido.'], warnings: [] } });
    }
  };

  return (
    <>
      <div className="fin-toolbar">
        <button type="button" className="fin-btn" onClick={copyPrevious}>
          <CopyPlus size={15} /> Copiar metas do mês anterior
        </button>
        <button type="button" className="fin-btn" onClick={exportJson} disabled={goals.length === 0}>
          <Download size={15} /> Exportar metas (JSON)
        </button>
        <button type="button" className="fin-btn" onClick={() => fileInput.current?.click()}>
          <Upload size={15} /> Importar metas (JSON)
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="tone-deficit fin-small">{error}</p>}
      {preview && (
        <GoalsPreviewDialog
          title={preview.title}
          month={month}
          preview={preview.data}
          onClose={() => setPreview(null)}
          onApplied={() => {
            setPreview(null);
            onSaved();
          }}
        />
      )}
    </>
  );
}

function GoalsPreviewDialog({
  title,
  month,
  preview,
  onClose,
  onApplied,
}: {
  title: string;
  month: string;
  preview: GoalsPreview;
  onClose: () => void;
  onApplied: () => void;
}) {
  const source = useFinanceSource();
  // Metas novas vêm marcadas; substituir uma meta existente exige marcar a linha.
  const [rows, setRows] = useState(() =>
    preview.drafts.map((d) => ({ ...d, selected: d.action === 'create', profit: d.profit_target, worst: d.worst_case_target }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = rows.filter((r) => r.selected && r.action !== 'unchanged');
  const invalid = selected.map((r) => validateGoalValues(r.profit, r.worst)).find(Boolean);

  const apply = async () => {
    setSaving(true);
    setError(null);
    try {
      await source.saveGoals(
        month,
        selected.map((r) => ({ seller_id: r.seller_id, profit_target: r.profit, worst_case_target: r.worst }))
      );
      onApplied();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setSaving(false);
    }
  };

  const parse = parseMoneyInput;

  return (
    <div className="fin-modal-root" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fin-drawer-backdrop" onClick={onClose} />
      <div className="fin-modal">
        <header className="fin-modal-head">
          <h3>{title}</h3>
          <button type="button" className="fin-icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        {preview.errors.length > 0 && (
          <ul className="fin-msg-list tone-deficit">
            {preview.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {preview.warnings.length > 0 && (
          <ul className="fin-msg-list tone-warn">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th />
                  <th className="align-left">Vendedor</th>
                  <th className="align-left">Situação</th>
                  <th className="align-right">Meta (lucro)</th>
                  <th className="align-right">Pior cenário</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.seller_id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        disabled={r.action === 'unchanged'}
                        onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))}
                        aria-label={`Aplicar meta de ${r.seller_name}`}
                      />
                    </td>
                    <td className="align-left">{r.seller_name}</td>
                    <td className="align-left fin-small">
                      {r.action === 'create' && <span className="tone-profit">Nova</span>}
                      {r.action === 'unchanged' && <span className="fin-muted">Igual à atual</span>}
                      {r.action === 'update' && (
                        <span className="tone-warn">
                          Substitui {brl(r.existing?.profit_target, 'sem meta')} / {brl(r.existing?.worst_case_target, '—')}
                        </span>
                      )}
                    </td>
                    <td className="align-right">
                      <input
                        className="fin-input num"
                        inputMode="decimal"
                        value={r.profit ?? ''}
                        onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, profit: parse(e.target.value) } : x)))}
                        aria-label={`Meta de ${r.seller_name}`}
                      />
                    </td>
                    <td className="align-right">
                      <input
                        className="fin-input num"
                        inputMode="decimal"
                        value={r.worst ?? ''}
                        onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, worst: parse(e.target.value) } : x)))}
                        aria-label={`Pior cenário de ${r.seller_name}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {invalid && <p className="tone-deficit fin-small">{invalid}.</p>}
        {error && <p className="tone-deficit fin-small">{error}</p>}
        <footer className="fin-modal-foot">
          <button type="button" className="fin-btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="fin-btn is-primary"
            onClick={apply}
            disabled={saving || selected.length === 0 || !!invalid || preview.errors.length > 0}
          >
            {saving ? 'Salvando…' : `Aplicar ${selected.length} meta(s) em ${monthLabel(month)}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
