import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, CopyPlus, EyeOff, Save, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { fetchSellers } from '../../lib/api';
import { addDays, formatDateBR, formatInstantBR, storeToday } from '../../lib/finance/dates';
import { weekRangeOf } from '../../lib/finance/dashboard';
import { int } from '../../lib/finance/format';
import type { Seller, SellerWeeklyGoal } from '../../lib/database.types';
import { EmptyState } from '../finance/FinancePrimitives';
import '../finance/finance.css';

/** Meta inteira > 0; vazio = sem meta; inválido = NaN. */
function parseWeeklyTarget(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : NaN;
}

const isMissingTable = (code: string | undefined) => code === '42P01' || code === 'PGRST205';

/**
 * Metas SEMANAIS de aparelhos (iPhones) por vendedor — as que o vendedor vê no Painel do Vendedor.
 * Semana da loja: segunda a domingo. Cada semana tem as próprias linhas: editar uma semana nunca
 * altera outra (histórico preservado) e não mexe nas metas mensais do Forecast.
 */
export function WeeklyGoalsManager() {
  const [weekStart, setWeekStart] = useState(() => weekRangeOf(storeToday()).from);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [goals, setGoals] = useState<SellerWeeklyGoal[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const weekEnd = addDays(weekStart, 6);

  const loadWeek = async (start: string) => {
    const { data, error: e } = await supabase.from('seller_weekly_goals').select('*').eq('week_start', start);
    if (e) {
      if (isMissingTable(e.code)) throw Object.assign(new Error('migração 0017 pendente'), { pending: true });
      throw new Error(e.message);
    }
    return (data ?? []) as SellerWeeklyGoal[];
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    Promise.all([fetchSellers(), loadWeek(weekStart)])
      .then(([s, g]) => {
        if (!alive) return;
        setSellers(s);
        setGoals(g);
        setDrafts(Object.fromEntries(g.map((goal) => [goal.seller_id, String(goal.device_target)])));
      })
      .catch((err: Error & { pending?: boolean }) => {
        if (!alive) return;
        setPending(!!err.pending);
        setError(err.message);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [weekStart, nonce]);

  const goalBySeller = useMemo(() => new Map(goals.map((g) => [g.seller_id, g])), [goals]);
  const listed = useMemo(
    () =>
      sellers
        .filter((s) => goalBySeller.has(s.id) || (s.active && (showHidden || s.show_in_ranking)))
        .sort((a, b) => Number(b.show_in_ranking) - Number(a.show_in_ranking) || a.name.localeCompare(b.name)),
    [sellers, goalBySeller, showHidden]
  );

  const rows = listed.map((s) => {
    const text = drafts[s.id] ?? '';
    const value = parseWeeklyTarget(text);
    const existing = goalBySeller.get(s.id);
    return { s, text, value, existing, invalid: Number.isNaN(value), changed: (existing?.device_target ?? null) !== value };
  });
  const changed = rows.filter((r) => r.changed);
  const hasInvalid = changed.some((r) => r.invalid);
  const total = goals.reduce((a, g) => a + g.device_target, 0);

  const copyPrevious = async () => {
    setMessage(null);
    try {
      const previous = await loadWeek(addDays(weekStart, -7));
      let filled = 0;
      const next = { ...drafts };
      for (const g of previous) {
        if ((next[g.seller_id] ?? '').trim() === '') {
          next[g.seller_id] = String(g.device_target);
          filled += 1;
        }
      }
      setDrafts(next);
      setMessage(filled > 0 ? `${filled} meta(s) copiada(s) da semana anterior. Revise e salve.` : 'Nada a copiar: a semana anterior não tem metas (ou os campos já estão preenchidos).');
    } catch (err) {
      setMessage(`Erro: ${(err as Error).message}`);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const upserts = changed.filter((r) => r.value != null).map((r) => ({ seller_id: r.s.id, week_start: weekStart, device_target: r.value as number }));
      if (upserts.length > 0) {
        const { error: e } = await supabase.from('seller_weekly_goals').upsert(upserts, { onConflict: 'seller_id,week_start' });
        if (e) throw new Error(e.message);
      }
      const removals = changed.filter((r) => r.value == null && r.existing);
      for (const r of removals) {
        const { error: e } = await supabase.from('seller_weekly_goals').delete().eq('id', r.existing!.id);
        if (e) throw new Error(e.message);
      }
      setMessage(`${upserts.length + removals.length} meta(s) salva(s) na semana de ${formatDateBR(weekStart)}.`);
      setNonce((n) => n + 1);
    } catch (err) {
      setMessage(`Erro ao salvar: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Seller, goal: SellerWeeklyGoal) => {
    if (!window.confirm(`Remover a meta semanal de ${s.name} (${formatDateBR(weekStart)} a ${formatDateBR(weekEnd)})? As outras semanas não mudam.`)) return;
    const { error: e } = await supabase.from('seller_weekly_goals').delete().eq('id', goal.id);
    setMessage(e ? `Erro: ${e.message}` : `Meta de ${s.name} removida.`);
    setNonce((n) => n + 1);
  };

  return (
    <section className="fin-page" aria-label="Metas semanais por vendedor">
      <div className="fin-panel">
        <div className="fin-ranking-head">
          <h2 className="fin-panel-title is-large">
            <CalendarDays size={20} className="tone-profit" />
            Metas semanais de aparelhos (Painel do Vendedor)
          </h2>
          <div className="fin-toolbar" style={{ margin: 0 }}>
            <button type="button" className="fin-icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior">
              <ChevronLeft size={16} />
            </button>
            <strong className="fin-small">
              {formatDateBR(weekStart)} a {formatDateBR(weekEnd)}
            </strong>
            <button type="button" className="fin-icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Próxima semana">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <p className="fin-muted fin-small">
          Meta individual de iPhones por semana (segunda a domingo, horário da loja). Cada vendedor vê somente a própria meta, sem poder alterá-la.
          Cada semana é independente: salvar aqui não muda semanas anteriores nem as metas mensais do Forecast. Vazio = “Sem meta definida”.
        </p>
        {error ? (
          <EmptyState title={pending ? 'Metas semanais ainda não ativas no banco' : 'Erro ao carregar metas semanais'}>
            {pending ? 'Aplique a migração 0017_seller_portal_access.sql.' : error}
          </EmptyState>
        ) : (
          <>
            <div className="fin-toolbar">
              <button type="button" className="fin-btn" onClick={copyPrevious}>
                <CopyPlus size={15} /> Copiar metas da semana anterior
              </button>
              <label className="fin-check">
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
                Mostrar vendedores ocultos do ranking
              </label>
            </div>
            <div className="fin-goal-box">
              <span className="fin-eyebrow">Soma das metas da semana</span>
              <p>
                <strong className="tone-goal">{goals.length > 0 ? `${int(total)} aparelhos · ${goals.length} vendedor(es)` : 'Nenhuma meta cadastrada nesta semana'}</strong>
              </p>
            </div>
            <div className="fin-table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="fin-table">
                <thead>
                  <tr>
                    <th className="align-left">Vendedor</th>
                    <th className="align-right">Meta semanal (aparelhos)</th>
                    <th className="align-left">Última alteração</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.s.id} className={r.changed ? 'is-selected' : ''}>
                      <td className="align-left">
                        <strong>{r.s.name}</strong>
                        {!r.s.show_in_ranking && (
                          <span className="fin-tag">
                            <EyeOff size={11} /> oculto do ranking
                          </span>
                        )}
                        {r.invalid && <div className="tone-deficit fin-small">Use um número inteiro maior que zero</div>}
                      </td>
                      <td className="align-right">
                        <input
                          className="fin-input num"
                          inputMode="numeric"
                          placeholder="Sem meta"
                          value={r.text}
                          onChange={(e) => setDrafts((p) => ({ ...p, [r.s.id]: e.target.value }))}
                          aria-label={`Meta semanal de ${r.s.name}`}
                        />
                      </td>
                      <td className="align-left fin-small fin-muted">
                        {r.existing ? `${formatInstantBR(r.existing.updated_at)}${r.existing.updated_by_email ? ` · ${r.existing.updated_by_email}` : ''}` : '—'}
                      </td>
                      <td>
                        {r.existing && (
                          <button type="button" className="fin-icon-btn" onClick={() => remove(r.s, r.existing!)} aria-label={`Remover meta semanal de ${r.s.name}`}>
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="fin-modal-foot">
              {message && <span className="fin-small fin-muted">{message}</span>}
              <button type="button" className="fin-btn is-primary" onClick={save} disabled={saving || changed.length === 0 || hasInvalid}>
                <Save size={15} /> {saving ? 'Salvando…' : `Salvar ${changed.length || ''} alteração(ões)`}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
