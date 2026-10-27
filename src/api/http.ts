import { beginAuthorization, getAccessToken, getAuthorizationGeneration, noteAuthorizedRequest, unauthorizedRetryExhausted, beforeUnauthorizedRetry } from '../auth/pkce';
import { licenseState } from '../licenseState';

/** 服务端分页统一形态。 */
export interface LicensePage<T> { data: T[]; total: number; page: number; size: number; totalPages: number; }

/** 统一 API 错误：保留状态码与安全消息（服务端已脱敏）。 */
export class LicenseApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  return params.toString() ? `?${params.toString()}` : '';
}

/**
 * 发起授权时回跳目标：仅接受已知节面路由，避免在回调页或未识别路径上发起授权后形成回环。
 */
function authorizationTarget(): string {
  const path = location.pathname.startsWith(`${licenseState.routePrefix}/`) ? location.pathname.slice(licenseState.routePrefix.length) : location.pathname;
  return /^\/(issuers|customers|products|plans|grants|credentials|operations|revocations|signing-profiles|integration-commands)(\/|$)/.test(path) ? path : '/issuers';
}

/** domain 使用完整业务路径；apiBase 可是网关根或业务根，但业务前缀只保留一次。 */
export function licenseApiUrl(path: string, apiBase = licenseState.apiBase): string {
  const prefix = '/api/license/v1';
  const origin = location.origin;
  if (!path.startsWith(`${prefix}/`) || path.includes('\\')) throw new LicenseApiError(400, 'License API 路径无效');
  const target = new URL(path, origin);
  const base = new URL(apiBase || '/', `${origin}/`);
  if (base.origin !== origin || base.username || base.password || base.search || base.hash) {
    throw new LicenseApiError(400, 'License API 必须使用当前门户同源地址');
  }
  if (target.origin !== origin || !target.pathname.startsWith(`${prefix}/`)) throw new LicenseApiError(400, 'License API 路径无效');
  let root = base.pathname.replace(/\/+$/, '');
  if (root.endsWith(prefix)) root = root.slice(0, -prefix.length);
  if (root.includes(prefix)) throw new LicenseApiError(400, 'License API 基础地址包含重复或不完整的业务前缀');
  return `${root}${target.pathname}${target.search}`;
}

/**
 * 请求桥：/api/license/v1 公开契约。
 * 身份（人员 PKCE 令牌）与条件头（If-Match 原值）分离；412/428 不自动重放，
 * 由页面回读最新内容后让用户重新确认。
 */
async function request<T>(path: string, init: RequestInit & { ifMatch?: string; idempotencyKey?: string } = {}) {
  const token = getAccessToken();
  const authorizationGeneration = getAuthorizationGeneration();
  const apiBase = licenseState.apiBase;
  function requireCurrentRequest() {
    if (init.signal?.aborted || token !== getAccessToken() || authorizationGeneration !== getAuthorizationGeneration() || apiBase !== licenseState.apiBase) {
      throw new DOMException('请求所属身份已变化', 'AbortError');
    }
  }
  if (init.signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  if (!token) {
    await beginAuthorization(authorizationTarget());
    throw new LicenseApiError(401, '正在发起授权');
  }
  requireCurrentRequest();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.ifMatch) headers.set('If-Match', init.ifMatch);
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
  const response = await fetch(licenseApiUrl(path, apiBase), {
    ...init, credentials: 'omit', headers
  });
  requireCurrentRequest();
  if (!response.ok) {
    let message = '';
    try { message = (await response.json() as { message?: string }).message || ''; } catch { /* 空安全响应允许 */ }
    requireCurrentRequest();
    if (response.status === 401) {
      // 401 属于本应用令牌域：自己走 PKCE 重授权与熔断围栏，不回调门户 onUnauthorized，
      // 避免服务端持续拒绝时门户反复跳登录页（对齐 AKSK 前端 3.2.0 的熔断语义）。
      if (unauthorizedRetryExhausted()) {
        // 熔断文案固定：透传服务端 message 会让用户误以为会话问题而反复重试
        throw new LicenseApiError(401, '授权后仍被拒绝，请确认服务端访问策略或重新从统一应用门户进入');
      }
      beforeUnauthorizedRetry();
      await beginAuthorization(authorizationTarget());
    }
    throw new LicenseApiError(response.status, message || `请求失败（HTTP ${response.status}）`);
  }
  const text = await response.text();
  requireCurrentRequest();
  const body = text ? JSON.parse(text) as T : undefined as T;
  requireCurrentRequest();
  noteAuthorizedRequest();
  return body;
}

export { query, request };
