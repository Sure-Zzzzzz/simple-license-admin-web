import { describe, expect, it, vi, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { licenseState } from './licenseState';
import { canSection } from './auth/permissions';
import { listIssuers } from './api/domain';
import { finishAuthorization } from './auth/pkce';
vi.mock('./auth/pkce', async importOriginal => ({ ...await importOriginal<typeof import('./auth/pkce')>(), finishAuthorization: vi.fn() }));
vi.mock('./auth/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('./auth/permissions')>(),
  canSection: vi.fn(() => true), firstAccessibleRoute: vi.fn(() => '/issuers')
}));

vi.mock('./api/domain', async importOriginal => ({
  ...await importOriginal<typeof import('./api/domain')>(),
  listIssuers: vi.fn(async () => ({ data: [], total: 0, page: 1, size: 20, totalPages: 0 })),
  getOrganizationBinding: vi.fn(async () => ({ customerId: 'cu-9', organizationInstanceId: null, rootDepartmentId: null, bindingGeneration: null, rowVersion: 1 }))
}));

async function mountWith(props: { section: string; customerId?: string; grantId?: string }) {
  const router = createRouter({
    history: createWebHistory('/app/license/'),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }]
  });
  await router.push('/');
  const wrapper = mount(App, { props, global: { plugins: [router] } });
  await nextTick();
  return wrapper;
}

describe('License Admin 壳', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canSection).mockReturnValue(true);
    sessionStorage.clear();
    licenseState.bridge = false;
  });

  it('门户形态由宿主导航，不渲染独立标题栏', async () => {
    licenseState.bridge = true;
    const wrapper = await mountWith({ section: 'issuers' });
    expect(wrapper.find('.license-standalone-header').exists()).toBe(false);
    expect(wrapper.find('.license-page .page-header h1').text()).toBe('签发方');
    wrapper.unmount();
    licenseState.bridge = false;
  });

  it('列表节面渲染独立调试标题栏与页面标题', async () => {
    const wrapper = await mountWith({ section: 'issuers' });
    expect(wrapper.find('.license-page .page-header h1').text()).toBe('签发方'); // 节面 PageHeader 标题（CRM 同构）
    expect(wrapper.find('.license-standalone-header h1').text()).toBe('License 管理台');
    expect(wrapper.find('.license-standalone-header button').text()).toBe('返回门户');
    wrapper.unmount();
  });

  it('详情节面显示父上下文与返回链', async () => {
    const wrapper = await mountWith({ section: 'organization-binding', customerId: 'cu-9' });
    expect(wrapper.text()).toContain('返回客户列表');
    expect(wrapper.text()).toContain('组织实例标识'); // 真绑定表单在渲染
    wrapper.unmount();
  });

  it('未知节面给出明确提示', async () => {
    const wrapper = await mountWith({ section: 'nonexistent' });
    expect(wrapper.text()).toContain('页面不存在');
    wrapper.unmount();
  });

  it('缺 PAGE 时不挂载业务页，也不请求其数据', async () => {
    vi.mocked(canSection).mockReturnValue(false);
    const wrapper = await mountWith({ section: 'issuers' });
    expect(wrapper.text()).toContain('暂无此页面权限');
    expect(wrapper.find('.license-page').exists()).toBe(false);
    expect(listIssuers).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('离开回调后旧换币失败不能覆盖当前业务页', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(finishAuthorization).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const wrapper = await mountWith({ section: 'oauth-callback' });
    await wrapper.setProps({ section: 'issuers' });
    fail(new Error('旧授权流程已取消'));
    await nextTick();
    await nextTick();
    expect(wrapper.text()).not.toContain('旧授权流程已取消');
    expect(wrapper.find('.license-page .page-header h1').text()).toBe('签发方');
    wrapper.unmount();
  });

});
