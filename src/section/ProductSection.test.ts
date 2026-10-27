import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ProductSection from './ProductSection.vue';
import { LicenseApiError, type LicensePage } from '../api/http';

vi.mock('../api/domain', () => ({
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  getApplicationBindings: vi.fn(),
  putApplicationBindings: vi.fn()
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}));
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true), canPage: vi.fn(() => true) }));

import { createProduct, getApplicationBindings, getProduct, listProducts, putApplicationBindings } from '../api/domain';
import { canApi, canPage } from '../auth/permissions';

function pageOf<T>(data: T[]): LicensePage<T> {
  return { data, total: data.length, page: 1, size: 20, totalPages: data.length ? 1 : 0 };
}

const products = [
  { productId: 'p-1', issuerId: 'i-1', code: 'falcon-scan', displayName: '渠道管理系统', supportedCapabilities: [], declaredActions: ['product.enter', 'scan.run'], status: 'ACTIVE', rowVersion: 1 }
];

const bindings = {
  items: [{ applicationId: 9, applicationCode: 'falcon-web', basePermissionSnapshotVersion: 3, status: 'ACTIVE' }],
  rowVersion: 1
};

describe('ProductSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canApi).mockReturnValue(true);
    vi.mocked(canPage).mockReturnValue(true);
    vi.mocked(listProducts).mockResolvedValue(pageOf(products));
    vi.mocked(getApplicationBindings).mockResolvedValue(bindings);
    vi.mocked(getProduct).mockResolvedValue(products[0]);
    vi.mocked(putApplicationBindings).mockResolvedValue({ ...bindings, rowVersion: 2 });
    vi.mocked(createProduct).mockResolvedValue(products[0]);
  });

  it('产品列表加载渲染声明动作', async () => {
    const wrapper = mount(ProductSection, { props: { section: 'products' } });
    await flushPromises();
    expect(wrapper.text()).toContain('falcon-scan');
    expect(wrapper.text()).toContain('product.enter, scan.run');
  });

  it('新建产品提交完整输入', async () => {
    const wrapper = mount(ProductSection, { props: { section: 'products' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    const inputs = wrapper.findAll('.confirm-dialog input');
    await inputs[0].setValue('i-1');
    await inputs[1].setValue('new-product');
    await inputs[2].setValue('渠道系统');
    await inputs[3].setValue('product.enter');
    await wrapper.find('.confirm-dialog button.button-primary').trigger('click');
    await flushPromises();
    expect(vi.mocked(createProduct)).toHaveBeenCalledWith(expect.objectContaining({
      issuerId: 'i-1', displayName: '渠道系统'
    }));
    expect(wrapper.text()).toContain('产品已创建');
  });

  it('绑定保存 409 冲突提示不自动覆盖', async () => {
    vi.mocked(putApplicationBindings).mockRejectedValueOnce(new LicenseApiError(409, ''));
    const wrapper = mount(ProductSection, { props: { section: 'application-bindings', productId: 'p-1' } });
    await flushPromises();
    await wrapper.findAll('input')[0].setValue('11');
    await wrapper.find('.panel .button-primary').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').text()).toContain('版本已变化');
  });

  it('详情使用绑定回读版本，保存后重读版本供下一次添加', async () => {
    vi.mocked(listProducts).mockResolvedValue(pageOf([]));
    vi.mocked(getProduct).mockResolvedValue({ ...products[0]!, rowVersion: 7 });
    vi.mocked(getApplicationBindings)
      .mockResolvedValueOnce({ ...bindings, rowVersion: 7 })
      .mockResolvedValue({ ...bindings, rowVersion: 8 });
    const wrapper = mount(ProductSection, { props: { section: 'application-bindings', productId: 'p-1' } });
    await flushPromises();
    expect(getProduct).toHaveBeenCalledWith('p-1');
    expect(listProducts).not.toHaveBeenCalled();
    await wrapper.findAll('.panel input')[0]!.setValue('11');
    await wrapper.find('.panel .button-primary').trigger('click');
    await flushPromises();
    expect(putApplicationBindings).toHaveBeenLastCalledWith('p-1', expect.any(Object), 7);
    expect(getApplicationBindings).toHaveBeenCalledTimes(2);
    await wrapper.findAll('.panel input')[0]!.setValue('12');
    await wrapper.find('.panel .button-primary').trigger('click');
    await flushPromises();
    expect(putApplicationBindings).toHaveBeenLastCalledWith('p-1', expect.any(Object), 8);
    wrapper.unmount();
  });

  it('回读失败时禁止用默认版本保存', async () => {
    vi.mocked(getProduct).mockRejectedValueOnce(new Error('产品读取失败'));
    const wrapper = mount(ProductSection, { props: { section: 'application-bindings', productId: 'p-1' } });
    await flushPromises();
    expect(wrapper.find('.panel .button-primary').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[role="alert"]').text()).toContain('产品读取失败');
    expect(putApplicationBindings).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('增加应用绑定保留其他应用已批准的三权快照', async () => {
    const snapshot = { pagePermissions: ['app.page'], apiPermissions: ['app.read'], dataGrantTemplate: null };
    vi.mocked(getApplicationBindings).mockResolvedValue({ items: [{ applicationId: 9, basePermissionSnapshotVersion: 3, basePermissionSnapshot: snapshot }], rowVersion: 7 });
    const wrapper = mount(ProductSection, { props: { section: 'application-bindings', productId: 'p-1' } });
    await flushPromises(); await wrapper.findAll('.panel input')[0]!.setValue('11'); await wrapper.find('.panel .button-primary').trigger('click'); await flushPromises();
    expect(putApplicationBindings).toHaveBeenCalledWith('p-1', { items: [
      { applicationId: 9, basePermissionSnapshotVersion: 3, basePermissionSnapshot: snapshot },
      { applicationId: 11, basePermissionSnapshotVersion: 1 }
    ] }, 7);
    wrapper.unmount();
  });

  it('没有产品管理权限隐藏新建和保存绑定入口，保留读取', async () => {
    vi.mocked(canApi).mockImplementation(code => code !== 'license.product.manage');
    const wrapper = mount(ProductSection, { props: { section: 'products' } });
    await flushPromises();
    expect(wrapper.find('.page-header button.button-primary').exists()).toBe(false);
    expect(wrapper.text()).toContain('应用绑定');
    await wrapper.setProps({ section: 'application-bindings', productId: 'p-1' });
    await flushPromises();
    expect(getApplicationBindings).toHaveBeenCalledWith('p-1');
    expect(wrapper.find('.panel button.button-primary').exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([
    ['应用绑定', 'page', 'license.page.products'],
    ['应用绑定', 'api', 'license.product.read'],
    ['条件模型', 'page', 'license.page.models'],
    ['条件模型', 'api', 'license.model.read']
  ])('%s 跳转缺少 %s 权限时隐藏按钮', async (label, kind, code) => {
    if (kind === 'page') vi.mocked(canPage).mockImplementation(value => value !== code);
    else vi.mocked(canApi).mockImplementation(value => value !== code);
    const wrapper = mount(ProductSection, { props: { section: 'products' } });
    await flushPromises();
    expect(wrapper.findAll('tbody button').some(button => button.text() === label)).toBe(false);
    expect(listProducts).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('权限失效后的旧保存按钮事件也不能调用绑定写入 API', async () => {
    const wrapper = mount(ProductSection, { props: { section: 'application-bindings', productId: 'p-1' } });
    await flushPromises();
    await wrapper.findAll('.panel input')[0]!.setValue('11');
    const save = wrapper.find('.panel button.button-primary');
    vi.mocked(canApi).mockImplementation(code => code !== 'license.product.manage');
    await save.trigger('click');
    await flushPromises();
    expect(putApplicationBindings).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
