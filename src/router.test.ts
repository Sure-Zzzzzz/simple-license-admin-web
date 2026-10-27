import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
vi.mock('./App.vue', () => ({ default: { template: '<div />' } }));
vi.mock('./auth/permissions', () => ({
  loadPermissions: vi.fn(), canPage: vi.fn(() => true), firstAccessibleRoute: vi.fn(() => '/grants'), resetPermissions: vi.fn(),
  permissionState: { loading: false },
  sectionPages: { issuers: 'license.page.issuers', customers: 'license.page.customers', 'organization-binding': 'license.page.customers',
    products: 'license.page.products', 'application-bindings': 'license.page.products', models: 'license.page.models', plans: 'license.page.plans',
    grants: 'license.page.grants', 'subject-assignments': 'license.page.subject-assignments', activations: 'license.page.activations',
    credentials: 'license.page.credentials', operations: 'license.page.operations', revocations: 'license.page.revocations',
    'signing-profiles': 'license.page.signing-profiles', 'integration-commands': 'license.page.integrations' }
}));
vi.mock('./auth/pkce', () => ({ cancelPendingAuthorization: vi.fn() }));
import { canPage, firstAccessibleRoute, loadPermissions, resetPermissions } from './auth/permissions';
import { cancelPendingAuthorization } from './auth/pkce';
import { createLicenseRouter } from './router';

describe('License PAGE 路由门禁', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(loadPermissions).mockResolvedValue(); vi.mocked(canPage).mockReturnValue(true); vi.mocked(firstAccessibleRoute).mockReturnValue('/grants'); });
  it.each([
    ['/issuers', 'license.page.issuers'], ['/customers', 'license.page.customers'], ['/customers/c/organization-binding', 'license.page.customers'],
    ['/products', 'license.page.products'], ['/products/p/application-bindings', 'license.page.products'], ['/products/p/models', 'license.page.models'],
    ['/plans', 'license.page.plans'], ['/grants', 'license.page.grants'], ['/grants/g/subject-assignments', 'license.page.subject-assignments'],
    ['/grants/g/activations', 'license.page.activations'], ['/credentials', 'license.page.credentials'], ['/operations', 'license.page.operations'],
    ['/revocations', 'license.page.revocations'], ['/signing-profiles', 'license.page.signing-profiles'], ['/integration-commands', 'license.page.integrations']
  ])('直接打开 %s 先消费 %s', async (path, code) => {
    const { router, dispose } = createLicenseRouter(createMemoryHistory('/app/license/'));
    await router.push(path);
    expect(loadPermissions).toHaveBeenCalledOnce();
    expect(canPage).toHaveBeenCalledWith(code);
    expect(router.currentRoute.value.path).toBe(path);
    dispose();
  });
  it('缺PAGE跳403，权限获取失败跳可读错误页', async () => {
    const { router, dispose } = createLicenseRouter(createMemoryHistory());
    vi.mocked(canPage).mockReturnValue(false);
    await router.push('/grants');
    expect(router.currentRoute.value.path).toBe('/403');
    vi.mocked(loadPermissions).mockRejectedValueOnce(new Error('服务不可用'));
    await router.push('/plans');
    expect(router.currentRoute.value.path).toBe('/access-error');
    dispose();
  });
  it('默认入口选择授权列表，不强制签发方页面', async () => {
    const { router, dispose } = createLicenseRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.path).toBe('/grants');
    dispose();
  });
  it('oauth回调不读取业务权限，离开时取消旧授权等待', async () => {
    const { router, dispose } = createLicenseRouter(createMemoryHistory());
    await router.push('/oauth-callback');
    expect(loadPermissions).not.toHaveBeenCalled();
    await router.push('/grants');
    expect(cancelPendingAuthorization).toHaveBeenCalledOnce();
    dispose();
  });
  it('卸载后迟到/me不能完成导航，清除快照', async () => {
    const { router, dispose } = createLicenseRouter(createMemoryHistory());
    let finish!: () => void;
    let started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(loadPermissions).mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const pending = router.push('/grants');
    await start;
    dispose();
    finish();
    await pending;
    expect(router.currentRoute.value.path).not.toBe('/grants');
    expect(resetPermissions).toHaveBeenCalled();
  });
});
