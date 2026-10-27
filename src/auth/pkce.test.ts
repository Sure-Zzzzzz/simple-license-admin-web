import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginAuthorization, beforeUnauthorizedRetry, finishAuthorization, noteAuthorizedRequest, unauthorizedRetryExhausted } from './pkce';

const originalLocation = window.location;

describe('License PKCE', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { value: originalLocation, configurable: true });
  });

  it('授权请求使用 S256 并把回跳目标限制在子应用内', async () => {
    vi.stubEnv('VITE_LICENSE_PKCE_CLIENT_ID', 'license-web-example');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, configurable: true });
    await beginAuthorization('/products');
    expect(assign).toHaveBeenCalledWith(expect.stringContaining('code_challenge_method=S256'));
    expect(sessionStorage.length).toBe(1);
  });

  it('重新换币不解除持续 401 围栏，只有业务 API 成功才能解除', async () => {
    vi.stubEnv('VITE_LICENSE_PKCE_CLIENT_ID', 'license-web-example');
    beforeUnauthorizedRetry();
    sessionStorage.setItem('license.pkce.retry-state', JSON.stringify({ verifier: 'test-verifier', target: '/grants' }));
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, origin: originalLocation.origin,
        pathname: '/app/license/oauth-callback', search: '?state=retry-state&code=test-code' },
      configurable: true
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ access_token: 'test-token', expires_in: 3600 }) }));
    expect(await finishAuthorization()).toBe('/grants');
    expect(unauthorizedRetryExhausted()).toBe(true);
    noteAuthorizedRequest();
    expect(unauthorizedRetryExhausted()).toBe(false);
  });
});
