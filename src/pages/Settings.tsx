import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, KeyRound } from 'lucide-react';
import { SellerAvatar } from '../components/SellerAvatar';
import { SellerPhotoModal } from '../components/SellerPhotoModal';
import { AccessBadge, SellerAccessModal } from '../components/SellerAccessModal';
import { AccessApiError, accessStatusOf, sellerAccessApi, type SellerLogin } from '../lib/accessApi';
import {
  fetchPanelSettings,
  updatePanelSettings,
  fetchSellers,
  updateSellerRankingVisibility,
  fetchKommoUsers,
  updateSellerKommoMapping,
} from '../lib/api';
import type { Seller, KommoUser } from '../lib/database.types';

const DEFAULTS = {
  show_ranking: true,
  show_goals: true,
  show_products: true,
  show_tv_panel: true,
};

export function Settings() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [kommoUsers, setKommoUsers] = useState<KommoUser[]>([]);
  const [editingPhotoSeller, setEditingPhotoSeller] = useState<Seller | null>(null);
  const [accessSellerId, setAccessSellerId] = useState<string | null>(null);
  const [logins, setLogins] = useState<SellerLogin[]>([]);
  const [loginsError, setLoginsError] = useState<string | null>(null);
  const loginBySeller = useMemo(() => new Map(logins.map((l) => [l.seller_id, l])), [logins]);

  const loadLogins = useCallback(async () => {
    try {
      setLogins(await sellerAccessApi.list());
      setLoginsError(null);
    } catch (err) {
      const e = err as AccessApiError;
      setLoginsError(
        e.code === 'not_deployed'
          ? 'Gerenciamento de acesso indisponível: publique a function seller-access e aplique a migração 0017.'
          : `Não foi possível carregar os logins: ${e.message}`
      );
    }
  }, []);

  useEffect(() => {
    fetchPanelSettings()
      .then((data) => setSettings({
        show_ranking: data.show_ranking,
        show_goals: data.show_goals,
        show_products: data.show_products,
        show_tv_panel: data.show_tv_panel,
      }))
      .finally(() => setLoading(false));
    fetchSellers().then(setSellers);
    fetchKommoUsers().then(setKommoUsers);
    loadLogins();
  }, [loadLogins]);

  const toggle = (key: keyof typeof settings) => {
    const nextValue = !settings[key];
    setSettings(prev => ({ ...prev, [key]: nextValue }));
    updatePanelSettings({ [key]: nextValue });
  };

  const toggleSellerRanking = (seller: Seller) => {
    const nextValue = !seller.show_in_ranking;
    setSellers((prev) => prev.map((s) => (s.id === seller.id ? { ...s, show_in_ranking: nextValue } : s)));
    updateSellerRankingVisibility(seller.id, nextValue);
  };

  const changeSellerKommoMapping = (seller: Seller, kommoUserId: string) => {
    const nextValue = kommoUserId || null;
    setSellers((prev) => prev.map((s) => (s.id === seller.id ? { ...s, kommo_user_id: nextValue } : s)));
    updateSellerKommoMapping(seller.id, nextValue);
  };

  return (
    <div className="flex-col gap-6" style={{ width: '100%' }}>
      <div className="flex-between" style={{marginBottom: '16px', flexWrap: 'wrap', gap: '12px'}}>
        <h1 className="h1">Configurações do Painel</h1>
      </div>

      <div className="card" style={{maxWidth: '600px', width: '100%', opacity: loading ? 0.6 : 1}}>
        <div className="flex-col gap-6">
          <div className="flex-between" style={{paddingBottom: '16px', borderBottom: '1px solid var(--border-color)', gap: '12px'}}>
            <div>
              <h3 style={{fontWeight: 600, marginBottom: '4px'}}>Exibir Ranking</h3>
              <p className="text-muted text-sm">Mostra o ranking de vendedores no dashboard principal.</p>
            </div>
            <button
              className="ios-hit"
              onClick={() => toggle('show_ranking')}
              style={{
                width: '44px', height: '24px', borderRadius: '12px',
                backgroundColor: settings.show_ranking ? 'var(--primary)' : 'var(--border-color)',
                position: 'relative', transition: 'all 0.2s', flexShrink: 0
              }}
              type="button"
            >
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                position: 'absolute', top: '2px', left: settings.show_ranking ? '22px' : '2px',
                transition: 'all 0.2s'
              }} />
            </button>
          </div>

          <div className="flex-between" style={{paddingBottom: '16px', borderBottom: '1px solid var(--border-color)', gap: '12px'}}>
            <div>
              <h3 style={{fontWeight: 600, marginBottom: '4px'}}>Exibir Metas</h3>
              <p className="text-muted text-sm">Mostra os cards de meta da semana e do mês.</p>
            </div>
            <button
              className="ios-hit"
              onClick={() => toggle('show_goals')}
              style={{
                width: '44px', height: '24px', borderRadius: '12px',
                backgroundColor: settings.show_goals ? 'var(--primary)' : 'var(--border-color)',
                position: 'relative', transition: 'all 0.2s', flexShrink: 0
              }}
              type="button"
            >
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                position: 'absolute', top: '2px', left: settings.show_goals ? '22px' : '2px',
                transition: 'all 0.2s'
              }} />
            </button>
          </div>

          <div className="flex-between" style={{paddingBottom: '16px', borderBottom: '1px solid var(--border-color)', gap: '12px'}}>
            <div>
              <h3 style={{fontWeight: 600, marginBottom: '4px'}}>Exibir Produtos</h3>
              <p className="text-muted text-sm">Mostra os produtos mais vendidos e estoque crítico.</p>
            </div>
            <button
              className="ios-hit"
              onClick={() => toggle('show_products')}
              style={{
                width: '44px', height: '24px', borderRadius: '12px',
                backgroundColor: settings.show_products ? 'var(--primary)' : 'var(--border-color)',
                position: 'relative', transition: 'all 0.2s', flexShrink: 0
              }}
              type="button"
            >
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                position: 'absolute', top: '2px', left: settings.show_products ? '22px' : '2px',
                transition: 'all 0.2s'
              }} />
            </button>
          </div>

          <div className="flex-between" style={{gap: '12px'}}>
            <div>
              <h3 style={{fontWeight: 600, marginBottom: '4px'}}>Exibir Painel TV</h3>
              <p className="text-muted text-sm">Habilita a visualização do botão para o modo apresentação.</p>
            </div>
            <button
              className="ios-hit"
              onClick={() => toggle('show_tv_panel')}
              style={{
                width: '44px', height: '24px', borderRadius: '12px',
                backgroundColor: settings.show_tv_panel ? 'var(--primary)' : 'var(--border-color)',
                position: 'relative', transition: 'all 0.2s', flexShrink: 0
              }}
              type="button"
            >
              <div style={{
                width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                position: 'absolute', top: '2px', left: settings.show_tv_panel ? '22px' : '2px',
                transition: 'all 0.2s'
              }} />
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{maxWidth: '600px', width: '100%'}}>
        <div style={{marginBottom: '16px'}}>
          <h3 style={{fontWeight: 600, marginBottom: '4px'}}>Vendedores e Fotos de Perfil</h3>
          <p className="text-muted text-sm">
            Gerencie as fotos, defina quais vendedores aparecem nos rankings (Dashboard, Vendedores, Painel TV e Previsão)
            e o login individual de cada vendedor no Painel do Vendedor. “Oculto” vale só para os rankings — não bloqueia o login.
          </p>
          {loginsError && <p className="text-sm" role="alert" style={{ color: 'var(--danger)', marginTop: '8px' }}>{loginsError}</p>}
        </div>

        <div className="flex-col gap-4">
          {sellers.length === 0 && (
            <span className="text-muted text-sm">Nenhum vendedor cadastrado ainda.</span>
          )}
          {sellers.map((seller) => (
            <div
              key={seller.id}
              className="flex-between"
              style={{paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', gap: '12px', flexWrap: 'wrap'}}
            >
              <div className="flex-center gap-3">
                <SellerAvatar
                  name={seller.name}
                  photoUrl={seller.photo_url}
                  size="sm"
                  editable
                  onEdit={() => setEditingPhotoSeller(seller)}
                />
                <div>
                  <div style={{fontWeight: 500}}>{seller.name}</div>
                  <button
                    type="button"
                    onClick={() => setEditingPhotoSeller(seller)}
                    className="text-muted ios-hit"
                    style={{
                      fontSize: '12px',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: 'var(--accent-text)',
                      marginTop: '2px',
                    }}
                  >
                    <Camera size={12} />
                    {seller.photo_url ? 'Alterar foto' : 'Adicionar foto'}
                  </button>
                  <div className="flex-center gap-2" style={{ flexWrap: 'wrap', marginTop: '6px', justifyContent: 'flex-start' }}>
                    <AccessBadge status={accessStatusOf(loginBySeller.get(seller.id))} />
                    <button type="button" className="access-manage-btn" onClick={() => setAccessSellerId(seller.id)} aria-label={`Gerenciar acesso de ${seller.name}`}>
                      <KeyRound size={13} /> Gerenciar acesso
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-center gap-3">
                <span className="text-muted text-xs">
                  {seller.show_in_ranking ? 'No ranking' : 'Oculto'}
                </span>
                <button
                  className="ios-hit"
                  onClick={() => toggleSellerRanking(seller)}
                  style={{
                    width: '44px', height: '24px', borderRadius: '12px',
                    backgroundColor: seller.show_in_ranking ? 'var(--primary)' : 'var(--border-color)',
                    position: 'relative', transition: 'all 0.2s', flexShrink: 0
                  }}
                  title={seller.show_in_ranking ? 'Ocultar do ranking' : 'Exibir no ranking'}
                  type="button"
                >
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%', backgroundColor: '#fff',
                    position: 'absolute', top: '2px', left: seller.show_in_ranking ? '22px' : '2px',
                    transition: 'all 0.2s'
                  }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{maxWidth: '600px', width: '100%'}}>
        <div style={{marginBottom: '16px'}}>
          <h3 style={{fontWeight: 600, marginBottom: '4px'}}>Integração Kommo</h3>
          <p className="text-muted text-sm">
            Vincule cada vendedor ao usuário correspondente no Kommo para que as conversas
            sincronizadas apareçam no relatório certo. A lista abaixo é preenchida pela
            sincronização automática de usuários do Kommo.
          </p>
        </div>

        <div className="flex-col gap-4">
          {sellers.length === 0 && (
            <span className="text-muted text-sm">Nenhum vendedor cadastrado ainda.</span>
          )}
          {kommoUsers.length === 0 && sellers.length > 0 && (
            <span className="text-muted text-sm">
              Nenhum usuário Kommo sincronizado ainda. Configure a integração e rode a sincronização primeiro.
            </span>
          )}
          {sellers.length > 0 && kommoUsers.length > 0 && sellers.map((seller) => (
            <div
              key={seller.id}
              className="flex-between"
              style={{paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', gap: '12px', flexWrap: 'wrap'}}
            >
              <span>{seller.name}</span>
              <select
                value={seller.kommo_user_id ?? ''}
                onChange={(e) => changeSellerKommoMapping(seller, e.target.value)}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-dark)',
                  maxWidth: '220px',
                  width: '100%'
                }}
              >
                <option value="">Não vinculado</option>
                {kommoUsers.map((ku) => (
                  <option key={ku.id} value={ku.id}>{ku.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {accessSellerId && sellers.some((s) => s.id === accessSellerId) && (
        <SellerAccessModal
          seller={sellers.find((s) => s.id === accessSellerId)!}
          login={loginBySeller.get(accessSellerId)}
          onClose={() => setAccessSellerId(null)}
          onChanged={loadLogins}
        />
      )}

      {editingPhotoSeller && (
        <SellerPhotoModal
          seller={editingPhotoSeller}
          onClose={() => setEditingPhotoSeller(null)}
          onSaved={(updatedSeller) => {
            setSellers((prev) =>
              prev.map((s) => (s.id === updatedSeller.id ? { ...s, photo_url: updatedSeller.photo_url } : s))
            );
          }}
        />
      )}
    </div>
  );
}
