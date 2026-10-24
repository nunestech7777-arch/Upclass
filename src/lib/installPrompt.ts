/**
 * Quando mostrar o aviso "Instalar o Upclass" (regras puras — testadas em installPrompt.test.ts).
 *
 * - iPhone/iPad: o Safari não tem aviso automático de instalação, então o site explica o caminho
 *   (Compartilhar → Adicionar à Tela de Início).
 * - Android/desktop com suporte: o navegador dispara `beforeinstallprompt` e o aviso vira um botão
 *   "Instalar" de verdade.
 * - Já instalado (aberto pela tela inicial, `display-mode: standalone`): nunca aparece.
 * - "Entendi" esconde até a próxima vez que o site for aberto (sessão do navegador).
 */

export type InstallMode = 'ios' | 'native' | null;

export interface InstallEnv {
  userAgent: string;
  /** navigator.maxTouchPoints — iPad com iPadOS se apresenta como Mac. */
  maxTouchPoints: number;
  /** Aberto como app instalado. */
  standalone: boolean;
  /** O navegador já ofereceu a instalação nativa (beforeinstallprompt). */
  nativeAvailable: boolean;
  /** Fechado nesta sessão. */
  dismissed: boolean;
}

export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ se identifica como Macintosh; só ele tem toque nessa "plataforma".
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** Navegadores embutidos (Instagram, Facebook, WhatsApp…) não instalam apps: o aviso não ajudaria. */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|Twitter|TikTok|Snapchat/i.test(userAgent);
}

export function installMode(env: InstallEnv): InstallMode {
  if (env.standalone || env.dismissed) return null;
  if (env.nativeAvailable) return 'native';
  if (isIOS(env.userAgent, env.maxTouchPoints) && !isInAppBrowser(env.userAgent)) return 'ios';
  return null;
}
