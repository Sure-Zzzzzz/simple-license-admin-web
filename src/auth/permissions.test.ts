import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api/http', () => ({ request: vi.fn() }));
vi.mock('./pkce', () => ({ getAccessToken: vi.fn(() => 'token-1'), getAuthorizationGeneration: vi.fn(() => 0) }));
import { request } from '../api/http';
import { licenseState } from '../licenseState';
import { getAccessToken, getAuthorizationGeneration } from './pkce';
import { canApi, canPage, canSection, firstAccessibleRoute, loadPermissions, permissionState, resetPermissions, sectionPages, type LicenseMe } from './permissions';

const me: LicenseMe = { principalId: 'user-1', pagePermissions: ['license.page.grants'], apiPermissions: ['license.grant.read'] };

describe('License 权限快照', () => {
  beforeEach(() => {
    resetPermissions();
    vi.clearAllMocks();
    licenseState.apiBase = '/api/license/v1';
    vi.mocked(getAccessToken).mockReturnValue('token-1');
    vi.mocked(getAuthorizationGeneration).mockReturnValue(0);
    vi.mocked(request).mockResolvedValue(me);
  });
  it('默认缺码拒绝，不用身份名字推导权限', () => {
    expect(canApi('license.grant.manage')).toBe(false);
    expect(canPage('license.page.grants')).toBe(false);
  });
  it('PAGE与API独立且首页选已获授权的列表', async () => {
    await loadPermissions();
    expect(canSection('grants')).toBe(true);
    expect(canApi('license.grant.read')).toBe(true);
    expect(canApi('license.grant.manage')).toBe(false);
    expect(canPage('license.page.issuers')).toBe(false);
    expect(firstAccessibleRoute()).toBe('/grants');
  });
  it('13个真实页面码不登记无路由 quotas', () => {
    expect(new Set(Object.values(sectionPages)).size).toBe(13);
    expect(sectionPages.operations).toBe('license.page.operations');
    expect(sectionPages).not.toHaveProperty('quotas');
  });
  it('缺失PAGE数组的旧/me契约失败关闭', async () => {
    vi.mocked(request).mockResolvedValue({ apiPermissions: ['license.grant.manage'] });
    await expect(loadPermissions()).rejects.toThrow('权限快照不完整');
    expect(permissionState.ready).toBe(false);
    expect(canApi('license.grant.manage')).toBe(false);
  });
  it('重新读取立即清旧权限，旧请求不能覆盖较新快照', async () => {
    await loadPermissions();
    let finish!: (value: LicenseMe) => void;
    vi.mocked(request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const old = loadPermissions();
    expect(canSection('grants')).toBe(false);
    vi.mocked(request).mockResolvedValueOnce({ ...me, pagePermissions: ['license.page.plans'] });
    await loadPermissions();
    finish(me);
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    expect(canSection('plans')).toBe(true);
    expect(canSection('grants')).toBe(false);
    expect(permissionState.loading).toBe(false);
  });
  it('相同令牌在新授权代数中失效，读取中的旧结果也不能落位', async () => {
    await loadPermissions();
    vi.mocked(getAuthorizationGeneration).mockReturnValue(2);
    expect(canSection('grants')).toBe(false);
    let finish!: (value: LicenseMe) => void;
    vi.mocked(request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = loadPermissions();
    vi.mocked(getAuthorizationGeneration).mockReturnValue(4);
    finish(me);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(permissionState.ready).toBe(false);
  });
  it('卸载清权限并取消请求，不让迟到响应恢复授权', async () => {
    let finish!: (value: LicenseMe) => void;
    vi.mocked(request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = loadPermissions();
    const signal = vi.mocked(request).mock.calls[0]![1]!.signal!;
    resetPermissions();
    expect(signal.aborted).toBe(true);
    finish(me);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(permissionState.ready).toBe(false);
  });
});
