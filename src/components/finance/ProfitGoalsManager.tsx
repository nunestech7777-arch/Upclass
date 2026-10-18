import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, EyeOff, Save, Trash2 } from 'lucide-react';
import type { FinanceSeller, ProfitGoal } from '../../lib/finance/calc';
import { formatInstantBR, monthLabel } from '../../lib/finance/dates';
import { brl, int } from '../../lib/finance/format';
import { parseMoneyInput, validateGoalValues } from '../../lib/finance/goalsIO';
import { MigrationPendingError } from '../../lib/finance/financeApi';
import { MonthPicker } from './MonthPicker';
import { GoalsTransferActions } from './GoalsTransfer';
import { EmptyState } from './FinancePrimitives';
import { useFinanceParams, useFinanceSource } from './useFinance';
import './finance.css';

type Draft = { profit: string; worst: string };

const toText = (v: number | null | undefined) => (v == null ? '' : String(v));
const toNumber = parseMoneyInput;

/**
 * Metas mensais de lucro por vendedor (e pior cenário). A meta da operação é a soma das metas
 * individuais. Vendedores ocultos do ranking continuam editáveis aqui.
 */
export function ProfitGoalsManager() {
  const source = useFinanceSource();
  const { month, setMonth } = useFinanceParams();
  const [sellers, setSellers] = useState<FinanceSeller[]>([]);
  const [goals, setGoals] = useState<ProfitGoal[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([source.loadSellers(), source.loadGoals(month)])
      .then(([s, g]) => {
        if (!alive) return;
        setSellers(s);
        setGoals(g);
        setDrafts(Object.fromEntries(g.map((goal) => [goal.seller_id, { profit: toText(goal.profit_target), worst: toText(goal.worst_case_target) }])));
      })
      .catch((err) => alive && setError(err))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [source, month, nonce]);

  const goalBySeller = useMemo(() => new Map(goals.map((g) => [g.seller_id, g])), [goals]);
  const listed = useMemo(
    () =>
      sellers
        .filter((s) => showInactive || s.active || goalBySeller.has(s.id))
        .sort((a, b) => Number(b.show_in_ranking) - Number(a.show_in_ranking) || a.name.localeCompare(b.name)),
    [sellers, showInactive, goalBySeller]
  );

  const rowState = (s: FinanceSeller) => {
    const d = drafts[s.id] ?? { profit: '', worst: '' };
    const profit = toNumber(d.profit);
    const worst = toNumber(d.worst);
    const existing = goalBySeller.get(s.id);
    const invalid = validateGoalValues(profit, worst);
    const changed = (existing?.profit_target ?? null) !== profit || (existing?.worst_case_target ?? null) !== worst;
    return { d, profit, worst, existing, invalid, changed };
  };

  const changedRows = listed.map((s) => ({ s, ...rowState(s) })).filter((r) => r.changed);
  const hasInvalid = changedRows.some((r) => r.invalid);
  const total = goals.reduce((a, g) => a + (g.profit_target ?? 0), 0);
  const totalWorst = goals.reduce((a, g) => a + (g.worst_case_target ?? 0), 0);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const upserts = changedRows.filter((r) => r.profit != null || r.worst != null);
      const removals = changedRows.filter((r) => r.profit == null && r.worst == null && r.existing);
      await source.saveGoals(
        month,
        upserts.map((r) => ({ seller_id: r.s.id, profit_target: r.profit as number | null, worst_case_target: r.worst as number | null }))
      );
      for (const r of removals) await source.deleteGoal(month, r.s.id);
      setMessage(`${upserts.length + removals.length} meta(s) salva(s) em ${monthLabel(month)}.`);
      setNonce((n) => n + 1);
    } catch (err) {
      setMessage(`Erro ao salvar: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: FinanceSeller) => {
    if (!window.confirm(`Remover a meta de lucro de ${s.name} em ${monthLabel(month)}?`)) return;
    await source.deleteGoal(month, s.id);
    setNonce((n) => n + 1);
  };

  return (
    <section className="fin-page" aria-label="Metas de lucro">
      <div className="fin-panel">
        <div className="fin-ranking-head">
          <h2 className="fin-panel-title is-large">
            <CircleDollarSign size={20} className="tone-profit" />
            Metas de lucro por vendedor
          </h2>
          <MonthPicker month={month} onChange={setMonth} allowFuture={3} />
        </div>
        <p className="fin-muted fin-small">
          A meta da operação é a soma das metas individuais do mês. Meta vazia = “Sem meta” (diferente de zero). O pior cenário deve ser menor ou
          igual à meta. As metas de unidades acima continuam valendo para os rankings de quantidade.{' '}
          <Link className="fin-link" to={`/resultado-financeiro?mes=${month}`}>
            Ver resultado do mês
          </Link>
        </p>

        {error ? (
          <EmptyState title={error instanceof MigrationPendingError ? 'Módulo financeiro ainda não ativado no banco' : 'Erro ao carregar metas'}>
            {error.message}
          </EmptyState>
        ) : (
          <>
            <GoalsTransferActions month={month} sellers={sellers} goals={goals} onSaved={() => setNonce((n) => n + 1)} />
            <div className="fin-goal-box">
              <span className="fin-eyebrow">Meta da operação · {monthLabel(month)}</span>
              <p>
                <strong className="tone-goal">{goals.length ? brl(total) : 'Sem metas cadastradas'}</strong>
                {goals.length > 0 && (
                  <>
                    {' '}
                    · pior cenário <strong className="tone-worst">{brl(totalWorst)}</strong> · {int(goals.length)} vendedor(es)
                  </>
                )}
              </p>
            </div>
            <label className="fin-check">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Mostrar vendedores inativos
            </label>
            <div className="fin-table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="fin-table">
                <thead>
                  <tr>
                    <th className="align-left">Vendedor</th>
                    <th className="align-right">Meta de lucro (R$)</th>
                    <th className="align-right">Pior cenário (R$)</th>
                    <th className="align-left">Última alteração</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listed.map((s) => {
                    const r = rowState(s);
                    return (
                      <tr key={s.id} className={r.changed ? 'is-selected' : ''}>
                        <td className="align-left">
                          <strong>{s.name}</strong>
                          {!s.show_in_ranking && (
                            <span className="fin-tag">
                              <EyeOff size={11} /> oculto do ranking
                            </span>
                          )}
                          {!s.active && <span className="fin-tag">inativo</span>}
                          {r.invalid && <div className="tone-deficit fin-small">{r.invalid}</div>}
                        </td>
                        <td className="align-right">
                          <input
                            className="fin-input num"
                            inputMode="decimal"
                            placeholder="Sem meta"
                            value={r.d.profit}
                            onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...r.d, profit: e.target.value } }))}
                            aria-label={`Meta de lucro de ${s.name}`}
                          />
                        </td>
                        <td className="align-right">
                          <input
                            className="fin-input num"
                            inputMode="decimal"
                            placeholder="—"
                            value={r.d.worst}
                            onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...r.d, worst: e.target.value } }))}
                            aria-label={`Pior cenário de ${s.name}`}
                          />
                        </td>
                        <td className="align-left fin-small fin-muted">
                          {r.existing?.updated_at
                            ? `${formatInstantBR(r.existing.updated_at)}${r.existing.updated_by_email ? ` · ${r.existing.updated_by_email}` : ''}`
                            : '—'}
                        </td>
                        <td>
                          {r.existing && (
                            <button type="button" className="fin-icon-btn" onClick={() => remove(s)} aria-label={`Remover meta de ${s.name}`}>
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="fin-modal-foot">
              {message && <span className="fin-small fin-muted">{message}</span>}
              <button type="button" className="fin-btn is-primary" onClick={save} disabled={saving || changedRows.length === 0 || hasInvalid}>
                <Save size={15} /> {saving ? 'Salvando…' : `Salvar ${changedRows.length || ''} alteração(ões)`}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
