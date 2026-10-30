import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { fetchKommoUsers, fetchSellers, updateSellerKommoMapping } from '../../lib/api';
import type { KommoUser, Seller } from '../../lib/database.types';
import { formatInstantBR } from '../../lib/finance/dates';
import { buildKommoUserOptions, lastSyncOf, matchesSearch, missingUserIds } from '../../lib/supervisor/kommoUsers';
import { syncKommoUsersNow } from '../../lib/supervisor/supervisorApi';

/**
 * Vínculo vendedor (MercadoPhone, tabela sellers) ↔ usuário do Kommo (kommo_users). Grava só
 * sellers.kommo_user_id; vendas, metas e logins não mudam. A lista vem da sincronização de usuários
 * (kommo-sync), disparável pelo botão e renovada sozinha pelo kommo-sync-events a cada 6 h.
 */
export function KommoMappingCard() {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [kommoUsers, setKommoUsers] = useState<KommoUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sync, setSync] = useState<{ running: boolean; message: string | null; error: boolean }>({ running: false, message: null, error: false });

  const load = useCallback(() => {
    setLoadError(null);
    return Promise.all([fetchSellers(), fetchKommoUsers()])
      .then(([s, k]) => {
        setSellers(s);
        setKommoUsers(k);
        setLoaded(true);
      })
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const change = (seller: Seller, kommoUserId: string) => {
    const nextValue = kommoUserId || null;
    const before = seller.kommo_user_id;
    setSaveError(null);
    // Mesma regra do índice único no banco: um usuário Kommo ligado a um só vendedor.
    const owner = nextValue ? sellers.find((s) => s.id !== seller.id && s.kommo_user_id === nextValue) : undefined;
    if (owner) {
      setSaveError(`Esse usuário do Kommo já está vinculado a ${owner.name}. Desvincule lá primeiro.`);
      return;
    }
    setSellers((prev) => prev.map((s) => (s.id === seller.id ? { ...s, kommo_user_id: nextValue } : s)));
    updateSellerKommoMapping(seller.id, nextValue).catch((err: Error) => {
      setSellers((prev) => prev.map((s) => (s.id === seller.id ? { ...s, kommo_user_id: before } : s)));
      setSaveError(`Não foi possível salvar o vínculo de ${seller.name}: ${err.message}`);
    });
  };

  const runSync = async () => {
    setSync({ running: true, message: null, error: false });
    try {
      const before = new Set(kommoUsers.map((u) => u.id));
      const n = await syncKommoUsersNow();
      const fresh = await fetchKommoUsers();
      setKommoUsers(fresh);
      const added = fresh.filter((u) => !before.has(u.id)).map((u) => u.name);
      setSync({
        running: false,
        error: false,
        message: `${n} usuário(s) recebidos do Kommo${added.length ? ` · novos: ${added.join(', ')}` : ' · nenhum usuário novo'}.`,
      });
    } catch (err) {
      setSync({ running: false, error: true, message: `Falha ao sincronizar: ${(err as Error).message}` });
    }
  };

  const lastSync = lastSyncOf(kommoUsers);
  const missing = useMemo(() => missingUserIds(kommoUsers), [kommoUsers]);
  const linked = sellers.filter((s) => s.kommo_user_id).length;
  const visible = sellers.filter((s) => matchesSearch(s, kommoUsers, search));

  return (
    <div className="sv-mapping">
      <p className="sv-muted">
        Vincule cada vendedor (cadastro de vendas) ao usuário correspondente no Kommo para que as conversas apareçam no vendedor certo.
        Vendas, metas e logins não são alterados.
        {loaded && ` ${linked} de ${sellers.length} vendedores vinculados · ${kommoUsers.length} usuários do Kommo${lastSync ? ` · última sincronização ${formatInstantBR(lastSync)}` : ''}.`}
      </p>

      <div className="sv-mapping-tools">
        <div className="sv-search sv-mapping-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar vendedor ou usuário do Kommo" aria-label="Buscar vendedor" />
        </div>
        <button type="button" className="sv-btn" onClick={runSync} disabled={sync.running}>
          <RefreshCw size={14} className={sync.running ? 'fin-spin' : ''} aria-hidden="true" />
          {sync.running ? 'Sincronizando…' : 'Sincronizar usuários do Kommo'}
        </button>
      </div>

      {sync.message && <p className={sync.error ? 'sv-bad' : 'sv-good'}>{sync.message}</p>}
      {saveError && <p className="sv-bad">{saveError}</p>}
      {loadError && <p className="sv-bad">Não foi possível carregar vendedores e usuários do Kommo: {loadError}</p>}
      {!loaded && !loadError && <p className="sv-muted">Carregando…</p>}
      {loaded && sellers.length === 0 && <p className="sv-muted">Nenhum vendedor cadastrado ainda.</p>}
      {loaded && kommoUsers.length === 0 && sellers.length > 0 && (
        <p className="sv-muted">Nenhum usuário Kommo sincronizado ainda. Use “Sincronizar usuários do Kommo”.</p>
      )}
      {loaded && sellers.length > 0 && kommoUsers.length > 0 && visible.length === 0 && <p className="sv-muted">Nenhum vendedor encontrado para “{search}”.</p>}
      {loaded && kommoUsers.length > 0 && visible.length > 0 && (
        <ul className="sv-mapping-list">
          {visible.map((seller) => {
            const options = buildKommoUserOptions(kommoUsers, sellers, seller.id);
            const linkedMissing = !!seller.kommo_user_id && missing.has(seller.kommo_user_id);
            return (
              <li key={seller.id}>
                <span className="sv-mapping-name">
                  {seller.name}
                  {!seller.active && <small className="sv-muted"> (inativo)</small>}
                  {linkedMissing && <small className="sv-warn">Usuário não encontrado no Kommo na última sincronização</small>}
                </span>
                <select
                  className="sv-select"
                  value={seller.kommo_user_id ?? ''}
                  onChange={(e) => change(seller, e.target.value)}
                  aria-label={`Usuário Kommo de ${seller.name}`}
                >
                  <option value="">Não vinculado</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id} disabled={!!o.takenBy}>
                      {o.label}
                      {o.takenBy ? ` — vinculado a ${o.takenBy}` : ''}
                      {o.missing ? ' (não encontrado no Kommo)' : ''}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
