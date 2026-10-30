import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchLeadResponsibles } from '../_shared/kommo.ts';
import { planSellerBackfill, type UnassignedConversation } from '../_shared/sellerBackfill.ts';

/**
 * Preenche o vendedor das conversas sem vendedor pelo responsável ATUAL do lead no Kommo
 * (ver sellerBackfill.ts). Só service role. Padrão = simulação: nada é gravado.
 *
 *   POST {}               → simulação: quantas conversas iriam para cada vendedor
 *   POST { "apply": true } → grava, e só em conversas que continuam com seller_id nulo
 *   "only_kommo_user_id": "123" (opcional) → limita aos leads cujo responsável é esse usuário Kommo
 *   "since": "2026-10-26T03:00:00Z" (opcional) → só conversas com última mensagem a partir daí
 *
 * Não mexe em vendas, metas, logins nem em conversas que já têm vendedor.
 */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });

function jwtRole(req: Request): string | null {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  // verify_jwt = true no gateway valida a assinatura; aqui só a service role passa.
  if (jwtRole(req) !== 'service_role') return json({ ok: false, error: 'apenas service role' }, 403);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const apply = body.apply === true;
  const since = typeof body.since === 'string' && !Number.isNaN(Date.parse(body.since)) ? new Date(body.since).toISOString() : null;
  const onlyKommoUser = typeof body.only_kommo_user_id === 'string' && body.only_kommo_user_id ? body.only_kommo_user_id : null;
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const conversations: UnassignedConversation[] = [];
    for (let from = 0; ; from += 1000) {
      let q = supabase.from('conversations').select('id, kommo_lead_id').is('seller_id', null);
      if (since) q = q.gte('occurred_at', since);
      const { data, error } = await q.order('id').range(from, from + 999);
      if (error) throw new Error(`listar conversas: ${error.message}`);
      conversations.push(...((data ?? []) as UnassignedConversation[]));
      if (!data || data.length < 1000) break;
    }

    const { data: sellers, error: sellersError } = await supabase.from('sellers').select('id, name, kommo_user_id').not('kommo_user_id', 'is', null);
    if (sellersError) throw new Error(`listar vendedores: ${sellersError.message}`);
    const sellerByKommoUser = new Map(
      (sellers ?? []).filter((s) => !onlyKommoUser || String(s.kommo_user_id) === onlyKommoUser).map((s) => [String(s.kommo_user_id), String(s.id)])
    );
    const sellerName = new Map((sellers ?? []).map((s) => [String(s.id), String(s.name)]));

    const leadIds = [...new Set(conversations.map((c) => c.kommo_lead_id).filter((x): x is string => !!x))];
    const responsibles = await fetchLeadResponsibles(leadIds);
    const plan = planSellerBackfill(conversations, responsibles, sellerByKommoUser);

    const { data: users } = await supabase.from('kommo_users').select('id, name');
    const userName = new Map((users ?? []).map((u) => [String(u.id), String(u.name)]));

    let updated = 0;
    if (apply) {
      const bySeller = new Map<string, string[]>();
      for (const a of plan.assignments) bySeller.set(a.seller_id, [...(bySeller.get(a.seller_id) ?? []), a.id]);
      for (const [sellerId, ids] of bySeller) {
        for (let i = 0; i < ids.length; i += 200) {
          const { data, error } = await supabase
            .from('conversations')
            .update({ seller_id: sellerId })
            .in('id', ids.slice(i, i + 200))
            .is('seller_id', null)
            .select('id');
          if (error) throw new Error(`gravar vendedor: ${error.message}`);
          updated += data?.length ?? 0;
        }
      }
    }

    return json({
      ok: true,
      mode: apply ? 'apply' : 'dry_run',
      only_kommo_user_id: onlyKommoUser,
      since,
      unassigned: conversations.length,
      leads_checked: leadIds.length,
      leads_found_in_kommo: responsibles.size,
      would_assign: plan.assignments.length,
      by_seller: Object.fromEntries(Object.entries(plan.bySeller).map(([id, n]) => [sellerName.get(id) ?? id, n])),
      responsible_not_linked: Object.fromEntries(Object.entries(plan.unlinkedResponsible).map(([id, n]) => [`${userName.get(id) ?? 'desconhecido'} (${id})`, n])),
      lead_not_found: plan.leadNotFound,
      updated,
    });
  } catch (err) {
    console.error('kommo-seller-backfill', String(err).slice(0, 300));
    return json({ ok: false, error: String(err).slice(0, 300) }, 500);
  }
});
