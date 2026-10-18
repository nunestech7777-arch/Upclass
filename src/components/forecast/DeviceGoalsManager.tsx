import React, { useEffect, useMemo, useState } from 'react';
import { CopyPlus, EyeOff, Save, Smartphone, Trash2 } from 'lucide-react';
import type { FinanceSeller } from '../../lib/finance/calc';
import { addMonths, formatInstantBR, monthLabel } from '../../lib/finance/dates';
import { int } from '../../lib/finance/format';
import { parseDeviceTarget } from '../../lib/finance/forecast';
import { MigrationPendingError, type DeviceGoal } from '../../lib/finance/financeApi';
import { MonthPicker } from '../finance/MonthPicker';
import { EmptyState } from '../finance/FinancePrimitives';
import { useFinanceParams, useFinanceSource } from '../finance/useFinance';
import '../finance/finance.css';

type Draft = { device: string; accessory: string };

const text = (v: number | null | undefined) => (v == null ? '' : String(v));

/**
 * Metas mensais por vendedor de APARELHOS (iPhones) e de ACESSÓRIOS — independentes entre si e da
 * meta de lucro. Usadas na projeção do Forecast.
 */
export function DeviceGoalsManager() {
  const source = useFinanceSource();
  const { month, setMonth } = useFinanceParams();
  const [sellers, setSellers] = useState<FinanceSeller[]>([]);
  const [goals, setGoals] = useState<DeviceGoal[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [accessoryAvailable, setAccessoryAvailable] = useState(true);
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
    Promise.all([source.loadSellers(), source.loadDeviceGoals(month), source.accessoryGoalsAvailable()])
      .then(([s, g, hasAccessory]) => {
        if (!alive) return;
        setSellers(s);
        setGoals(g);
        setAccessoryAvailable(hasAccessory);
        setDrafts(Object.fromEntries(g.map((goal) => [goal.seller_id, { device: text(goal.device_target), accessory: text(goal.accessory_target) }])));
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
    const d = drafts[s.id] ?? { device: '', accessory: '' };
    const device = parseDeviceTarget(d.device);
    const accessory = parseDeviceTarget(d.accessory);
    const existing = goalBySeller.get(s.id);
    const deviceChanged = (existing?.device_target ?? null) !== device;
    const accessoryChanged = accessoryAvailable && (existing?.accessory_target ?? null) !== accessory;
    return { d, device, accessory, existing, invalid: Number.isNaN(device) || Number.isNaN(accessory), changed: deviceChanged || accessoryChanged };
  };
  const changedRows = listed.map((s) => ({ s, ...rowState(s) })).filter((r) => r.changed);
  const hasInvalid = changedRows.some((r) => r.invalid);
  const totalDevices = goals.reduce((a, g) => a + (g.device_target ?? 0), 0);
  const totalAccessories = goals.reduce((a, g) => a + (g.accessory_target ?? 0), 0);

  const copyPrevious = async () => {
    setMessage(null);
    try {
      const previous = await source.loadDeviceGoals(addMonths(month, -1));
      const next = { ...drafts };
      let filled = 0;
      for (const g of previous) {
        const cur = next[g.seller_id] ?? { device: '', accessory: '' };
        const merged = {
          device: cur.device.trim() === '' && g.device_target != null ? String(g.device_target) : cur.device,
          accessory: accessoryAvailable && cur.accessory.trim() === '' && g.accessory_target != null ? String(g.accessory_target) : cur.accessory,
        };
        if (merged.device !== cur.device || merged.accessory !== cur.accessory) filled += 1;
        next[g.seller_id] = merged;
      }
      setDrafts(next);
      setMessage(filled > 0 ? `${filled} vendedor(es) copiado(s) de ${monthLabel(addMonths(month, -1))}. Revise e salve.` : 'Nada a copiar: o mês anterior não tem metas (ou elas já estão preenchidas).');
    } catch (err) {
      setMessage(`Erro: ${(err as Error).message}`);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const upserts = changedRows.filter((r) => r.device != null || (accessoryAvailable && r.accessory != null));
      const removals = changedRows.filter((r) => r.device == null && (!accessoryAvailable || r.accessory == null) && r.existing);
      await source.saveDeviceGoals(
        month,
        upserts.map((r) => ({
          seller_id: r.s.id,
          device_target: r.device as number | null,
          ...(accessoryAvailable ? { accessory_target: r.accessory as number | null } : {}),
        }))
      );
      for (const r of removals) await source.deleteDeviceGoal(month, r.s.id);
      setMessage(`${upserts.length + removals.length} vendedor(es) salvo(s) em ${monthLabel(month)}.`);
      setNonce((n) => n + 1);
    } catch (err) {
      setMessage(`Erro ao salvar: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: FinanceSeller) => {
    if (!window.confirm(`Remover as metas de aparelhos e acessórios de ${s.name} em ${monthLabel(month)}?`)) return;
    await source.deleteDeviceGoal(month, s.id);
    setNonce((n) => n + 1);
  };

  return (
    <section className="fin-page" aria-label="Metas de aparelhos e acessórios">
      <div className="fin-panel">
        <div className="fin-ranking-head">
          <h2 className="fin-panel-title is-large">
            <Smartphone size={20} className="tone-profit" />
            Metas de aparelhos e acessórios por vendedor
          </h2>
          <MonthPicker month={month} onChange={setMonth} allowFuture={3} />
        </div>
        <p className="fin-muted fin-small">
          Metas mensais de iPhones e de acessórios (pagos; brindes não contam) de cada vendedor, usadas na projeção do Forecast. São independentes entre si e da meta de
          lucro. Vazio = “Sem meta” (zero também não gera percentual).
        </p>
        {error ? (
          <EmptyState title={error instanceof MigrationPendingError ? 'Metas individuais ainda não ativas no banco' : 'Erro ao carregar metas'}>
            {error instanceof MigrationPendingError ? 'Aplique a migração 0014_seller_device_goals.sql.' : error.message}
          </EmptyState>
        ) : (
          <>
            {!accessoryAvailable && (
              <p className="fin-notice is-partial">
                <span>A meta de acessórios por vendedor ainda não está ativa no banco: aplique a migração 0015_seller_accessory_goals.sql para habilitar a coluna.</span>
              </p>
            )}
            <div className="fin-toolbar">
              <button type="button" className="fin-btn" onClick={copyPrevious}>
                <CopyPlus size={15} /> Copiar metas do mês anterior
              </button>
              <label className="fin-check">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Mostrar vendedores inativos
              </label>
            </div>
            <div className="fin-goal-box">
              <span className="fin-eyebrow">Soma das metas · {monthLabel(month)}</span>
              <p>
                <strong className="tone-goal">{goals.some((g) => g.device_target != null) ? `${int(totalDevices)} aparelhos` : 'Sem metas de aparelhos'}</strong>
                {' · '}
                <strong className="tone-goal">{goals.some((g) => g.accessory_target != null) ? `${int(totalAccessories)} acessórios` : 'Sem metas de acessórios'}</strong>
              </p>
            </div>
            <div className="fin-table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="fin-table">
                <thead>
                  <tr>
                    <th className="align-left">Vendedor</th>
                    <th className="align-right">Meta de aparelhos</th>
                    <th className="align-right">Meta de acessórios</th>
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
                          {r.invalid && <div className="tone-deficit fin-small">Use um número inteiro, sem negativos</div>}
                        </td>
                        <td className="align-right">
                          <input
                            className="fin-input num"
                            inputMode="numeric"
                            placeholder="Sem meta"
                            value={r.d.device}
                            onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...r.d, device: e.target.value } }))}
                            aria-label={`Meta de aparelhos de ${s.name}`}
                          />
                        </td>
                        <td className="align-right">
                          <input
                            className="fin-input num"
                            inputMode="numeric"
                            placeholder={accessoryAvailable ? 'Sem meta' : 'Migração 0015'}
                            value={r.d.accessory}
                            disabled={!accessoryAvailable}
                            onChange={(e) => setDrafts((p) => ({ ...p, [s.id]: { ...r.d, accessory: e.target.value } }))}
                            aria-label={`Meta de acessórios de ${s.name}`}
                          />
                        </td>
                        <td className="align-left fin-small fin-muted">
                          {r.existing?.updated_at ? `${formatInstantBR(r.existing.updated_at)}${r.existing.updated_by_email ? ` · ${r.existing.updated_by_email}` : ''}` : '—'}
                        </td>
                        <td>
                          {r.existing && (
                            <button type="button" className="fin-icon-btn" onClick={() => remove(s)} aria-label={`Remover metas de ${s.name}`}>
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
