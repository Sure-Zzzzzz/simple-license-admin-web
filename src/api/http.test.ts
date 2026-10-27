import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * 请求桥与授权围栏测试：401 不回调门户、首轮放行一回重授权、二轮熔断、成功解除围栏。
 * 围栏状态存于 sessionStorage（按标签页隔离），直接操纵 license.authorizationFailures 键。
 */

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('../licenseState', () => ({ licenseState: { apiBase: '', bridge: false, onUnauthorized: vi.fn() } }));
vi.mock('./domain', () => ({}));
vi.mock('../auth/pkce', () => ({
  beginAuthorization: vi.fn(),
  getAccessToken: vi.fn(() => 'token-1'),
  getAuthorizationGeneration: vi.fn(() => 0),
  noteAuthorizedRequest: vi.fn(),
  unauthorizedRetryExhausted: vi.fn(),
  beforeUnauthorizedRetry: vi.fn()
}));

import { licenseApiUrl, request } from './http';
import { licenseState } from '../licenseState';
import { beginAuthorization, getAccessToken, getAuthorizationGeneration, noteAuthorizedRequest, unauthorizedRetryExhausted } from '../auth/pkce';

const storage = () => sessionStorage;

describe('请求桥 401 围栏', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestMock.mockReset();
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(getAuthorizationGeneration).mockReturnValue(0);
    licenseState.apiBase = '';
    storage().clear();
    global.fetch = requestMock as unknown as typeof fetch;
  });
  afterEach(() => { vi.restoreAllMocks(); storage().clear(); });

  function unauthorizedResponse() {
    return new Response(JSON.stringify({ message: '未授权' }), { status: 401 });
  }

  it('无令牌时发起授权并抛 401 业务错误', async () => {
    const { getAccessToken } = await import('../auth/pkce');
    (getAccessToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    await expect(request('/api/license/v1/issuers')).rejects.toThrow('正在发起授权');
  });

  it('401 不回调门户 onUnauthorized（令牌域自治，不引发门户跳登录风暴）', async () => {
    const { licenseState } = await import('../licenseState');
    const { beginAuthorization, unauthorizedRetryExhausted } = await import('../auth/pkce');
    (unauthorizedRetryExhausted as ReturnType<typeof vi.fn>).mockReturnValue(true);
    requestMock.mockResolvedValueOnce(unauthorizedResponse());
    await expect(request('/api/license/v1/issuers')).rejects.toThrow('授权后仍被拒绝');
    expect(licenseState.onUnauthorized).not.toHaveBeenCalled();
    expect(beginAuthorization).not.toHaveBeenCalled();
  });

  it.each(['', '/', '/api/license/v1', '/api/license/v1/', `${location.origin}/api/license/v1`])('apiBase=%s 时业务前缀只出现一次', async apiBase => {
    licenseState.apiBase = apiBase;
    requestMock.mockResolvedValueOnce(new Response('{"ok":true}'));
    await expect(request('/api/license/v1/products?page=2')).resolves.toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledWith('/api/license/v1/products?page=2', expect.objectContaining({ credentials: 'omit' }));
  });

  it('网关根与业务根形态产生同一精确路径', () => {
    expect(licenseApiUrl('/api/license/v1/me', '/gateway')).toBe('/gateway/api/license/v1/me');
    expect(licenseApiUrl('/api/license/v1/me', '/gateway/api/license/v1')).toBe('/gateway/api/license/v1/me');
  });

  it('跨源 apiBase 与越界路径在发送令牌前拒绝', async () => {
    licenseState.apiBase = 'https://other.example.test/api/license/v1';
    await expect(request('/api/license/v1/me')).rejects.toThrow('同源');
    licenseState.apiBase = '';
    await expect(request('/api/license/v1/../other')).rejects.toThrow('路径无效');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('拒绝重复业务根，条件头与真实令牌分别透传', async () => {
    expect(() => licenseApiUrl('/api/license/v1/me', '/api/license/v1/api/license/v1')).toThrow('重复');
    requestMock.mockResolvedValueOnce(new Response('{}'));
    await request('/api/license/v1/products', { method: 'POST', body: '{}', headers: new Headers({ Authorization: 'bad' }), ifMatch: '"v7"', idempotencyKey: 'op-1' });
    const headers = requestMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(headers.get('If-Match')).toBe('"v7"');
    expect(headers.get('Idempotency-Key')).toBe('op-1');
  });

  it('旧身份401不能启动新身份重授权或改变围栏', async () => {
    let finish!: (response: Response) => void;
    requestMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = request('/api/license/v1/me');
    vi.mocked(getAccessToken).mockReturnValue('token-2');
    vi.mocked(getAuthorizationGeneration).mockReturnValue(1);
    finish(unauthorizedResponse());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(beginAuthorization).not.toHaveBeenCalled();
    expect(noteAuthorizedRequest).not.toHaveBeenCalled();
  });

  it('令牌 A→B→A 也按会话代数阻止旧响应', async () => {
    let finish!: (response: Response) => void;
    requestMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = request('/api/license/v1/me');
    vi.mocked(getAuthorizationGeneration).mockReturnValue(2);
    finish(new Response('{"old":true}'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(noteAuthorizedRequest).not.toHaveBeenCalled();
  });

  it('响应解析期间取消也不提交成功结果', async () => {
    const controller = new AbortController();
    const response = { ok: true, text: vi.fn(async () => { controller.abort(); return '{"old":true}'; }) };
    requestMock.mockResolvedValueOnce(response);
    await expect(request('/api/license/v1/me', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(noteAuthorizedRequest).not.toHaveBeenCalled();
  });
});
