import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import IntegrationSection from './IntegrationSection.vue';
import type { IntegrationPlanView } from '../api/domain';
const identity = vi.hoisted(() => ({ generation: 1 }));
vi.mock('../auth/pkce', () => ({ getAccessToken: () => 'current-token', getAuthorizationGeneration: () => identity.generation }));
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true), permissionState: { ready: true } }));
vi.mock('../api/domain', () => ({
  confirmIntegrationPlan: vi.fn(), createIntegrationAttempt: vi.fn(), createIntegrationPlan: vi.fn(),
  getApplicationBindings: vi.fn(), getIntegrationCommand: vi.fn(), getOrganizationBinding: vi.fn(),
  listCustomers: vi.fn(), listIntegrationCommands: vi.fn(), listProducts: vi.fn(),
  reconcileIntegrationCommand: vi.fn(), reconfirmIntegrationEnvironment: vi.fn()
}));
import { canApi } from '../auth/permissions';
import {
  confirmIntegrationPlan, createIntegrationAttempt, createIntegrationPlan, getApplicationBindings,
  getIntegrationCommand, getOrganizationBinding, listCustomers, listIntegrationCommands, listProducts,
  reconcileIntegrationCommand, reconfirmIntegrationEnvironment
} from '../api/domain';
enableAutoUnmount(afterEach);
const rules = { pagePermissions: ['app.page'], apiPermissions: ['app.read'], dataGrantTemplate: null };
function plan(override: Partial<IntegrationPlanView> = {}): IntegrationPlanView {
  return { planId: 'plan-1', commandId: 'cmd-1', productId: 'prod-1', customerId: 'customer-1', applicationId: '9',
    desiredRevision: 4, state: 'PENDING_EXECUTION', executionMode: 'MANUAL', validUntil: Date.now() / 1000 + 3600, planValidUntil: Date.now() / 1000 + 3600,
    confirmedRevision: null, failureReason: null, rowVersion: 2, projectionId: 'projection-1', externalId: 'external-1', organizationInstanceId: 'iam-current', bindingGeneration: 3,
    rootDepartmentId: 10, manifestVersion: 2, manifestDigest: 'digest', contributionPresent: true,
    contributions: [{ grantId: 'grant-1', grantRevision: 2, grantStateVersion: 1 }], approvedRules: rules, desiredRules: rules,
    targetDepartmentIds: [10, 11], departmentDiff: { toMount: [11], toUnmount: [12] }, ...override };
}
function pageOf<T>(data: T[]) { return { data, total: data.length, page: 1, size: 20, totalPages: 1 }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
async function click(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find(item => item.text() === text); expect(button, text).toBeDefined(); await button!.trigger('click'); await flushPromises();
}
async function option(wrapper: ReturnType<typeof mount>, label: string, text: string) {
  await wrapper.find(`button[aria-label="${label}"]`).trigger('click');
  const choice = wrapper.findAll('.form-select-option').find(item => item.text().includes(text)); expect(choice, text).toBeDefined(); await choice!.trigger('click'); await flushPromises();
}
async function detail(wrapper: ReturnType<typeof mount>) { await flushPromises(); await click(wrapper, '查看详情'); }
async function newPlan(wrapper: ReturnType<typeof mount>) {
  await flushPromises(); await click(wrapper, '新建清单'); await option(wrapper, '客户', '客户甲'); await option(wrapper, '产品', '产品甲'); await option(wrapper, '已绑定应用', '应用 9');
}
describe('角色联动完整治理流程', () => {
  beforeEach(() => {
    vi.resetAllMocks(); identity.generation = 1; vi.mocked(canApi).mockReturnValue(true);
    vi.mocked(listIntegrationCommands).mockResolvedValue(pageOf([plan()])); vi.mocked(getIntegrationCommand).mockResolvedValue(plan());
    vi.mocked(listProducts).mockResolvedValue(pageOf([{ productId: 'prod-1', displayName: '产品甲', code: 'product' }]) as never);
    vi.mocked(listCustomers).mockResolvedValue(pageOf([{ customerId: 'customer-1', displayName: '客户甲', code: 'customer' }]) as never);
    vi.mocked(getApplicationBindings).mockResolvedValue({ items: [{ applicationId: 9, basePermissionSnapshotVersion: 2, basePermissionSnapshot: rules }], rowVersion: 3 });
    vi.mocked(createIntegrationPlan).mockResolvedValue(plan()); vi.mocked(createIntegrationAttempt).mockResolvedValue(plan({ state: 'VERIFIED', executionMode: 'AUTO' }));
    vi.mocked(confirmIntegrationPlan).mockResolvedValue(plan({ state: 'MANUALLY_CONFIRMED', confirmedRevision: 4, openRoleId: 'role-9' }));
    vi.mocked(reconcileIntegrationCommand).mockResolvedValue(plan({ desiredRevision: 5, state: 'MANUALLY_CONFIRMED' }));
    vi.mocked(getOrganizationBinding).mockResolvedValue({ customerId: 'customer-1', organizationInstanceId: 'iam-new', bindingGeneration: 4, rootDepartmentId: 20, rowVersion: 8 });
    vi.mocked(reconfirmIntegrationEnvironment).mockResolvedValue(plan({ organizationInstanceId: 'iam-new', bindingGeneration: 4, externalId: 'external-new' }));
  });
  it('生成清单提交精确页面与接口权限，不猜测产品商业动作', async () => {
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await newPlan(wrapper);
    await wrapper.find('[aria-label="页面权限"]').setValue('app.page'); await wrapper.find('[aria-label="接口权限"]').setValue('app.read');
    await wrapper.find('[aria-label="批准权限确认"]').setValue(true); await wrapper.find('.license-integration-create').trigger('submit'); await flushPromises();
    expect(createIntegrationPlan).toHaveBeenCalledWith('prod-1', { customerId: 'customer-1', applicationId: '9', desiredRules: rules }, expect.any(String));
    expect(wrapper.text()).toContain('批准权限'); expect(wrapper.text()).toContain('新增挂载'); expect(createIntegrationAttempt).not.toHaveBeenCalled();
  });
  it('可使用已批准绑定快照；不额外发空规则覆盖', async () => {
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await newPlan(wrapper);
    await option(wrapper, '权限批准依据', '使用应用绑定'); await wrapper.find('[aria-label="批准权限确认"]').setValue(true);
    await wrapper.find('.license-integration-create').trigger('submit'); await flushPromises();
    expect(createIntegrationPlan).toHaveBeenCalledWith('prod-1', { customerId: 'customer-1', applicationId: '9' }, expect.any(String));
  });
  it('没有批准确认或重复权限时阻止生成', async () => {
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await newPlan(wrapper);
    await wrapper.find('.license-integration-create').trigger('submit'); await flushPromises(); expect(createIntegrationPlan).not.toHaveBeenCalled();
    await wrapper.find('[aria-label="批准权限确认"]').setValue(true); await wrapper.find('[aria-label="页面权限"]').setValue('app.page\napp.page');
    await wrapper.find('.license-integration-create').trigger('submit'); await flushPromises(); expect(createIntegrationPlan).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('重复值');
  });
  it('同输入失败重试复用请求键，编辑输入后更换请求键', async () => {
    vi.mocked(createIntegrationPlan).mockRejectedValue(new Error('暂不可用'));
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await newPlan(wrapper);
    await wrapper.find('[aria-label="批准权限确认"]').setValue(true);
    await wrapper.find('.license-integration-create').trigger('submit'); await flushPromises();
    await wrapper.find('.license-integration-create').trigger('submit'); await flushPromises();
    const firstKey = vi.mocked(createIntegrationPlan).mock.calls[0]![2]; expect(vi.mocked(createIntegrationPlan).mock.calls[1]![2]).toBe(firstKey);
    await wrapper.find('[aria-label="页面权限"]').setValue('app.changed'); await wrapper.find('.license-integration-create').trigger('submit'); await flushPromises();
    expect(vi.mocked(createIntegrationPlan).mock.calls[2]![2]).not.toBe(firstKey);
  });
  it('首次人工确认收集角色编号和环境版本，结果保留人工语义', async () => {
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '确认人工执行结果');
    await wrapper.find('[aria-label="操作范围确认"]').setValue(true); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises(); expect(confirmIntegrationPlan).not.toHaveBeenCalled();
    await wrapper.find('[aria-label="实际专用角色编号"]').setValue('role-9'); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises();
    expect(confirmIntegrationPlan).toHaveBeenCalledWith('plan-1', { expectedRevision: 4, organizationInstanceId: 'iam-current', bindingGeneration: 3, openRoleId: 'role-9' });
    expect(wrapper.text()).toContain('已人工确认'); expect(wrapper.text()).not.toContain('执行结果：已核验');
  });
  it('刷新明确走 MANUAL，不直接触发远端自动写入', async () => {
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '刷新最新清单');
    expect(createIntegrationAttempt).not.toHaveBeenCalled(); await wrapper.find('[aria-label="操作范围确认"]').setValue(true); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises();
    expect(createIntegrationAttempt).toHaveBeenCalledWith('cmd-1', 'MANUAL', expect.any(String));
  });
  it('自动执行必须显式确认且依真实未知状态呈现', async () => {
    vi.mocked(createIntegrationAttempt).mockResolvedValue(plan({ state: 'UNCERTAIN', failureReason: 'EXECUTION_RESULT_UNKNOWN' }));
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '自动执行');
    await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises(); expect(createIntegrationAttempt).not.toHaveBeenCalled();
    await wrapper.find('[aria-label="操作范围确认"]').setValue(true); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises();
    expect(createIntegrationAttempt).toHaveBeenCalledWith('cmd-1', 'AUTO', expect.any(String)); expect(wrapper.text()).toContain('执行结果：执行结果未知'); expect(wrapper.text()).not.toContain('执行结果：已核验');
  });
  it.each(['UNCERTAIN', 'DRIFTED'])('异常 %s 只开放核对，须声明旧调用终止', async state => {
    vi.mocked(getIntegrationCommand).mockResolvedValue(plan({ state, openRoleId: 'role-9' }));
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper);
    expect(wrapper.findAll('.entity-drawer button').some(button => button.text() === '自动执行')).toBe(false); await click(wrapper, '核对异常结果');
    await wrapper.find('[aria-label="操作范围确认"]').setValue(true); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises(); expect(reconcileIntegrationCommand).not.toHaveBeenCalled();
    await wrapper.find('[aria-label="此前调用已终止"]').setValue(true); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises();
    expect(reconcileIntegrationCommand).toHaveBeenCalledWith('cmd-1', { expectedRevision: 4, organizationInstanceId: 'iam-current', bindingGeneration: 3, openRoleId: 'role-9', priorCallTerminated: true });
  });
  it('环境重确认先读取当前绑定并提交新环境，旧角色编号不传入', async () => {
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '重新确认身份环境');
    expect(getOrganizationBinding).toHaveBeenCalledWith('customer-1'); await wrapper.find('[aria-label="此前调用已终止"]').setValue(true); await wrapper.find('[aria-label="操作范围确认"]').setValue(true);
    await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises();
    expect(reconfirmIntegrationEnvironment).toHaveBeenCalledWith('prod-1', { customerId: 'customer-1', applicationId: '9', organizationInstanceId: 'iam-new', bindingGeneration: 4, desiredRules: rules, priorCallTerminated: true });
    expect(wrapper.text()).toContain('external-new');
  });
  it('未改变环境拒绝重确认', async () => {
    vi.mocked(getOrganizationBinding).mockResolvedValue({ customerId: 'customer-1', organizationInstanceId: 'iam-current', bindingGeneration: 3, rootDepartmentId: 10, rowVersion: 8 });
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '重新确认身份环境');
    await wrapper.find('[aria-label="此前调用已终止"]').setValue(true); await wrapper.find('[aria-label="操作范围确认"]').setValue(true); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises();
    expect(reconfirmIntegrationEnvironment).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('没有变化');
  });
  it('自动请求失败回读结果未知，不能从原确认表单再次执行', async () => {
    vi.mocked(createIntegrationAttempt).mockRejectedValue(new Error('连接中断'));
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '自动执行');
    vi.mocked(getIntegrationCommand).mockResolvedValue(plan({ state: 'UNCERTAIN' })); await wrapper.find('[aria-label="操作范围确认"]').setValue(true); await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises();
    expect(wrapper.find('.license-integration-action').exists()).toBe(false); expect(wrapper.text()).toContain('执行结果未知'); expect(wrapper.findAll('.entity-drawer button').some(button => button.text() === '自动执行')).toBe(false);
  });
  it('权限不足时保留详情，隐藏写操作；表单打开后撤销权限也拒提交', async () => {
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '自动执行');
    await wrapper.find('[aria-label="操作范围确认"]').setValue(true); vi.mocked(canApi).mockImplementation(code => code !== 'license.integration.manage');
    await wrapper.find('.license-integration-action').trigger('submit'); await flushPromises(); expect(createIntegrationAttempt).not.toHaveBeenCalled();
  });
  it('详情请求迟到且授权实例变化时，不展示旧身份客户资料', async () => {
    const pending = deferred<IntegrationPlanView>(); vi.mocked(getIntegrationCommand).mockReturnValue(pending.promise);
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await flushPromises(); await click(wrapper, '查看详情');
    identity.generation += 1; pending.resolve(plan({ customerId: 'old-private-customer' })); await flushPromises(); expect(wrapper.text()).not.toContain('old-private-customer');
  });
  it('自动执行的迟到响应不能对新身份显示成功', async () => {
    const pending = deferred<IntegrationPlanView>(); vi.mocked(createIntegrationAttempt).mockReturnValue(pending.promise);
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); await click(wrapper, '自动执行'); await wrapper.find('[aria-label="操作范围确认"]').setValue(true);
    await wrapper.find('.license-integration-action').trigger('submit'); identity.generation += 1; pending.resolve(plan({ state: 'VERIFIED' })); await flushPromises(); expect(wrapper.text()).not.toContain('执行结果：已核验');
  });
  it('没有有效贡献时明确清除权限和部门范围，不表示授权成功', async () => {
    vi.mocked(getIntegrationCommand).mockResolvedValue(plan({ contributionPresent: false, contributions: [], desiredRules: { pagePermissions: [], apiPermissions: [], dataGrantTemplate: null }, targetDepartmentIds: [] }));
    const wrapper = mount(IntegrationSection, { props: { section: 'integration-commands' } }); await detail(wrapper); expect(wrapper.text()).toContain('清除专用角色的应用权限与部门挂载');
  });
});
