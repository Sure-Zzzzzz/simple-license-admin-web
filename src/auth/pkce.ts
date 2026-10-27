const PREFIX = 'license.pkce.';
const TOKEN_KEY = 'license.accessToken';
const EXPIRY_KEY = 'license.accessTokenExpiresAt';
const FAILURES_KEY = 'license.authorizationFailures';
let authorizationGeneration = 0;

/** 授权实例代数区分 A→B→A 的令牌生命周期，供请求与权限快照拒绝迟到响应。 */
export function getAuthorizationGeneration(): number { return authorizationGeneration; }

/** 卸载或离开授权页面时取消仍在等待中的换币，不清除已正常获得的令牌。 */
export function cancelPendingAuthorization(): void { authorizationGeneration += 1; }

/** 显式退出本应用的令牌生命周期，旧请求不得再更新界面或发起重授权。 */
export function clearAccessToken(): void {
  authorizationGeneration += 1;
  const storage = topLevelStorage();
  storage?.removeItem(TOKEN_KEY);
  storage?.removeItem(EXPIRY_KEY);
  storage?.removeItem(FAILURES_KEY);
}

function getClientId(): string {
  const value = import.meta.env.VITE_LICENSE_PKCE_CLIENT_ID as string | undefined;
  if (!value) throw new Error('未配置 VITE_LICENSE_PKCE_CLIENT_ID');
  return value;
}
function base64Url(bytes: Uint8Array): string {
  let text = ''; bytes.forEach(byte => { text += String.fromCharCode(byte); });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
/** qiankun 每次挂载重建 Window Proxy，必须用顶层窗口的真实 sessionStorage（aksk 先例）。 */
function topLevelStorage(): Storage | null {
  try { return (window.top ?? window).sessionStorage; } catch { return null; }
}
function read(key: string): string | null {
  const storage = topLevelStorage();
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}
function write(key: string, value: string) {
  const storage = topLevelStorage();
  try {
    if (!storage) throw new Error('storage unavailable');
    storage.setItem(key, value);
  } catch { throw new Error('当前浏览器无法保存应用会话，请允许会话存储后重新进入'); }
}
export function getAccessToken(): string | null {
  const expiry = Number(read(EXPIRY_KEY));
  return Number.isFinite(expiry) && Date.now() < expiry - 60_000 ? read(TOKEN_KEY) : null;
}

/**
 * API 401 时的重授权围栏：首轮 401 允许再发起一次授权；带上新令牌仍 401 则停在上报错误，
 * 不整页往返死循环。任何一次 API 成功即解除围栏。
 */
export function beforeUnauthorizedRetry(): void {
  write(FAILURES_KEY, '1');
}
export function noteAuthorizedRequest(): void {
  try { topLevelStorage()?.removeItem(FAILURES_KEY); } catch { /* 计数清理失败不影响本次请求 */ }
}
export function unauthorizedRetryExhausted(): boolean {
  return read(FAILURES_KEY) !== null;
}
export async function beginAuthorization(target: string): Promise<void> {
  const generation = ++authorizationGeneration;
  const random = new Uint8Array(32); crypto.getRandomValues(random);
  const state = base64Url(random); crypto.getRandomValues(random);
  const verifier = base64Url(random);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  if (generation !== authorizationGeneration) return;
  write(`${PREFIX}${state}`, JSON.stringify({ verifier, target }));
  const redirectUri = `${location.origin.replace('//localhost:', '//127.0.0.1:')}${import.meta.env.BASE_URL}oauth-callback`;
  const query = new URLSearchParams({ response_type: 'code', client_id: getClientId(), redirect_uri: redirectUri, state, code_challenge: base64Url(new Uint8Array(digest)), code_challenge_method: 'S256' });
  location.assign(`/oauth2/authorize?${query.toString()}`);
}
export async function finishAuthorization(): Promise<string | null> {
  const generation = ++authorizationGeneration;
  const query = new URLSearchParams(location.search); const state = query.get('state'); const code = query.get('code');
  const oauthError = query.get('error');
  if (oauthError) {
    throw new Error(`授权未完成（${oauthError}${query.get('error_description') ? '：' + query.get('error_description') : ''}）`);
  }
  const saved = state ? read(`${PREFIX}${state}`) : null;
  if (!code || !state || !saved) return null;
  topLevelStorage()?.removeItem(`${PREFIX}${state}`);
  const { verifier, target } = JSON.parse(saved) as { verifier: string; target: string };
  const redirectUri = `${location.origin.replace('//localhost:', '//127.0.0.1:')}${import.meta.env.BASE_URL}oauth-callback`;
  const response = await fetch('/oauth2/token', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: getClientId(), redirect_uri: redirectUri, code, code_verifier: verifier }).toString() });
  if (generation !== authorizationGeneration) throw new Error('授权流程已取消');
  if (!response.ok) throw new Error(`令牌交换失败（HTTP ${response.status}）`);
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (generation !== authorizationGeneration) throw new Error('授权流程已取消');
  if (!body.access_token) throw new Error('令牌交换响应缺少 access_token');
  write(TOKEN_KEY, body.access_token); write(EXPIRY_KEY, String(Date.now() + (body.expires_in ?? 3600) * 1000));
  authorizationGeneration += 1;
  // 换到令牌不等于业务服务器接受令牌；仅真实 API 成功解除围栏，防止持续 401 循环换币。
  history.replaceState(history.state, '', location.pathname);
  return typeof target === 'string' && target.startsWith('/') ? target : '/issuers';
}
