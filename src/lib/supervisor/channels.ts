/**
 * Canal da conversa a partir do `origin` que o Kommo grava em cada mensagem (e que a integração
 * guarda em `conversations.raw_payload.origin`). Valores vistos em produção: `waba` (WhatsApp
 * Business), `com.amocrm.amocrmwa` (WhatsApp Lite), `instagram_business` e `facebook`.
 */

export type Channel = 'whatsapp' | 'instagram' | 'other';
export type ChannelFilter = Channel | 'all';

export const CHANNEL_ORIGINS: Record<Exclude<Channel, 'other'>, readonly string[]> = {
  whatsapp: ['waba', 'com.amocrm.amocrmwa', 'whatsapp'],
  instagram: ['instagram_business', 'instagram'],
};

/** Todas as origens com canal conhecido — "Outros" é tudo fora desta lista. */
export const KNOWN_ORIGINS: readonly string[] = [...CHANNEL_ORIGINS.whatsapp, ...CHANNEL_ORIGINS.instagram];

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  other: 'Outros',
};

export const CHANNEL_FILTER_LABEL: Record<ChannelFilter, string> = {
  all: 'Todos os canais',
  ...CHANNEL_LABEL,
};

export function channelOf(origin: string | null | undefined): Channel {
  const o = (origin ?? '').trim().toLowerCase();
  if (CHANNEL_ORIGINS.whatsapp.includes(o)) return 'whatsapp';
  if (CHANNEL_ORIGINS.instagram.includes(o)) return 'instagram';
  return 'other';
}

/** Rótulo detalhado: distingue WhatsApp Business de WhatsApp Lite. */
export function originLabel(origin: string | null | undefined): string {
  const o = (origin ?? '').trim().toLowerCase();
  if (o === 'waba') return 'WhatsApp Business';
  if (o === 'com.amocrm.amocrmwa') return 'WhatsApp Lite';
  if (o === 'facebook') return 'Facebook';
  if (!o) return 'Canal não informado';
  return CHANNEL_LABEL[channelOf(o)];
}

export function isChannelFilter(value: string | null): value is ChannelFilter {
  return value === 'all' || value === 'whatsapp' || value === 'instagram' || value === 'other';
}

/** Subdomínio da conta Kommo — só para montar o link "abrir no Kommo" (não é credencial). */
export const KOMMO_SUBDOMAIN = 'vocedeiphone';

export function kommoLeadUrl(leadId: string | null | undefined): string | null {
  return leadId ? `https://${KOMMO_SUBDOMAIN}.kommo.com/leads/detail/${encodeURIComponent(leadId)}` : null;
}
