import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installMode, isIOS, type InstallEnv } from './installPrompt.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const INSTAGRAM = `${IPHONE} Instagram 300.0`;

const env = (p: Partial<InstallEnv>): InstallEnv => ({ userAgent: IPHONE, maxTouchPoints: 5, standalone: false, nativeAvailable: false, dismissed: false, ...p });

describe('installMode', () => {
  it('iPhone no navegador: instruções do iOS', () => {
    assert.equal(installMode(env({})), 'ios');
  });
  it('iPad (iPadOS se apresenta como Mac com toque): instruções do iOS; Mac de verdade não', () => {
    assert.equal(isIOS(IPAD_AS_MAC, 5), true);
    assert.equal(isIOS(IPAD_AS_MAC, 0), false);
  });
  it('já instalado ou fechado nesta sessão: não aparece', () => {
    assert.equal(installMode(env({ standalone: true })), null);
    assert.equal(installMode(env({ dismissed: true })), null);
  });
  it('Android com instalação nativa disponível: botão Instalar; sem ela, nada', () => {
    assert.equal(installMode(env({ userAgent: ANDROID, maxTouchPoints: 5, nativeAvailable: true })), 'native');
    assert.equal(installMode(env({ userAgent: ANDROID, maxTouchPoints: 5 })), null);
  });
  it('navegador embutido (Instagram) não instala: não aparece', () => {
    assert.equal(installMode(env({ userAgent: INSTAGRAM })), null);
  });
});
