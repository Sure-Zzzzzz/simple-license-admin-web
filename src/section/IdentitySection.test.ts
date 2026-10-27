import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import IdentitySection from './IdentitySection.vue';
import type { LicensePage } from '../api/http';

vi.mock('../api/domain', () => ({
  listIssuers: vi.fn(),
  listCustomers: vi.fn(),
  createIssuer: vi.fn(),
  createCustomer: vi.fn()
}));
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true), canPage: vi.fn(() => true) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { listIssuers, listCustomers, createIssuer } from '../api/domain';
import { canApi, canPage } from '../auth/permissions';

function pageOf<T>(data: T[]): LicensePage<T> {
  return { data, total: data.length, page: 1, size: 20, totalPages: data.length ? 1 : 0 };
}

const issuers = [
  { issuerId: 'i-1', code: 'vendor-a', displayName: '厂商A', status: 'ACTIVE', rowVersion: 1 },
  { issuerId: 'i-2', code: 'vendor-b', displayName: '厂商B', status: 'ACTIVE', rowVersion: 1 }
];

const customers = [
  { customerId: 'c-1', code: 'cust-a', displayName: '客户A', status: 'ACTIVE', rowVersion: 1 }
];

describe('IdentitySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canApi).mockReturnValue(true);
    vi.mocked(canPage).mockReturnValue(true);
    vi.mocked(listIssuers).mockResolvedValue(pageOf(issuers));
    vi.mocked(listCustomers).mockResolvedValue(pageOf(customers));
    vi.mocked(createIssuer).mockResolvedValue(issuers[0]);
  });

  it('签发方节面加载并渲染行', async () => {
    const wrapper = mount(IdentitySection, { props: { section: 'issuers' } });
    await flushPromises();
    expect(wrapper.text()).toContain('vendor-a');
    expect(wrapper.text()).toContain('厂商B');
    expect(wrapper.find('table .table-action').exists()).toBe(false);
  });

  it('客户节面显示组织绑定操作', async () => {
    const wrapper = mount(IdentitySection, { props: { section: 'customers' } });
    await flushPromises();
    expect(vi.mocked(listCustomers)).toHaveBeenCalled();
    expect(wrapper.text()).toContain('cust-a');
    expect(wrapper.text()).toContain('绑定组织');
  });

  it('新建签发方提交并刷新', async () => {
    const wrapper = mount(IdentitySection, { props: { section: 'issuers' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    await wrapper.find('input').setValue('vendor-c');
    await wrapper.findAll('input')[1].setValue('厂商C');
    await wrapper.find('.confirm-dialog form').trigger('submit');
    await flushPromises();
    expect(vi.mocked(createIssuer)).toHaveBeenCalledWith({ code: 'vendor-c', displayName: '厂商C' });
    expect(wrapper.text()).toContain('签发方已创建');
  });

  it('加载失败显示安全错误', async () => {
    vi.mocked(listIssuers).mockRejectedValueOnce(new Error('请求失败（HTTP 503）'));
    const wrapper = mount(IdentitySection, { props: { section: 'issuers' } });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('503');
  });

  it.each([
    ['issuers', 'license.issuer.manage'],
    ['customers', 'license.customer.manage']
  ])('没有 %s 的管理权限时隐藏新建入口，仍加载可读列表', async (section, deniedCode) => {
    vi.mocked(canApi).mockImplementation(code => code !== deniedCode);
    const wrapper = mount(IdentitySection, { props: { section } });
    await flushPromises();
    expect(wrapper.find('.page-header button.button-primary').exists()).toBe(false);
    expect(section === 'issuers' ? listIssuers : listCustomers).toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each(['page', 'api'])('组织绑定跳转缺少 %s 权限时隐藏入口', async permissionKind => {
    if (permissionKind === 'page') vi.mocked(canPage).mockImplementation(code => code !== 'license.page.customers');
    else vi.mocked(canApi).mockImplementation(code => code !== 'license.customer.read');
    const wrapper = mount(IdentitySection, { props: { section: 'customers' } });
    await flushPromises();
    expect(wrapper.findAll('tbody button').some(button => button.text() === '绑定组织')).toBe(false);
    expect(wrapper.text()).toContain('cust-a');
    wrapper.unmount();
  });

  it('已打开新建表单后失去管理权限，程序提交也不能调用创建 API', async () => {
    const wrapper = mount(IdentitySection, { props: { section: 'issuers' } });
    await flushPromises();
    await wrapper.find('.page-header button.button-primary').trigger('click');
    await wrapper.find('input').setValue('vendor-c');
    await wrapper.findAll('input')[1]!.setValue('厂商C');
    vi.mocked(canApi).mockImplementation(code => code !== 'license.issuer.manage');
    await wrapper.find('.confirm-dialog form').trigger('submit');
    await flushPromises();
    expect(createIssuer).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
