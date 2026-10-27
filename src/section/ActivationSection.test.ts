import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import ActivationSection from './ActivationSection.vue';
import type { ActivationView } from '../api/domain';
import type { LicensePage } from '../api/http';
const identity = vi.hoisted(() => ({ generation: 1 }));
vi.mock('../auth/pkce', () => ({ getAccessToken: () => 'current-token', getAuthorizationGeneration: () => identity.generation }));
vi.mock('../api/domain', () => ({ createActivation: vi.fn(), getCredentialContent: vi.fn(), getGrant: vi.fn(), listActivations: vi.fn(), listCredentials: vi.fn(), patchActivationCallerBinding: vi.fn(), patchActivationState: vi.fn(), replaceActivation: vi.fn() }));
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true), canPage: vi.fn(() => true), permissionState: { ready: true } }));
import { createActivation, getCredentialContent, getGrant, listActivations, listCredentials, patchActivationCallerBinding, replaceActivation } from '../api/domain';
import { canApi, canPage } from '../auth/permissions';
enableAutoUnmount(afterEach);
const activation: ActivationView = { activationId: 'act-1', deploymentCode: 'deployment-a', grantId: 'grant-1', state: 'ACTIVE', activationGeneration: 1, requestedAllocations: [], rowVersion: 7, callerBinding: { sourceId: 'official-service-source', subjectId: 'service-1' }, deviceBindingMode: 'NONE' };
function pageOf<T>(data: T[]): LicensePage<T> { return { data, total: data.length, page: 1, size: Math.max(data.length, 1), totalPages: 1 }; }
async function click(wrapper: ReturnType<typeof mount>, label: string) { const button = wrapper.findAll('button').find(item => item.text() === label); expect(button, label).toBeDefined(); await button!.trigger('click'); await flushPromises(); }
async function chooseAllocationRetention(wrapper: ReturnType<typeof mount>, value: string) {
  const toggle = wrapper.find('button[aria-label="额度保留策略 1"]'); expect(toggle.exists()).toBe(true); await toggle.trigger('click');
  const option = wrapper.findAll('.form-select-option').find(item => item.text() === value); expect(option).toBeDefined(); await option!.trigger('click'); await flushPromises();
}
async function createDrawer(wrapper: ReturnType<typeof mount>) { await flushPromises(); await click(wrapper, '新建激活申请'); await wrapper.find('.license-activation-create input').setValue('deployment-b'); }
async function caller(wrapper: ReturnType<typeof mount>, prefix = '') { await wrapper.find(`[aria-label="${prefix}服务身份来源"]`).setValue('official-service-source'); await wrapper.find(`[aria-label="${prefix}服务主体编号"]`).setValue('service-2'); }
describe('部署激活及获准服务绑定', () => {
  beforeEach(() => {
    vi.resetAllMocks(); identity.generation = 1; vi.mocked(canApi).mockReturnValue(true); vi.mocked(canPage).mockReturnValue(true);
    vi.mocked(listActivations).mockResolvedValue(pageOf([activation])); vi.mocked(listCredentials).mockResolvedValue(pageOf([]));
    vi.mocked(getGrant).mockResolvedValue({ grantId: 'grant-1', mode: 'ONLINE' } as never);
    vi.mocked(createActivation).mockResolvedValue(activation); vi.mocked(replaceActivation).mockResolvedValue({ ...activation, activationId: 'act-2' }); vi.mocked(patchActivationCallerBinding).mockResolvedValue({ ...activation, rowVersion: 8 });
  });
  it.each(['ONLINE', 'HYBRID'])('%s 创建提交获准服务绑定，不提交设备摘要', async mode => {
    vi.mocked(getGrant).mockResolvedValue({ grantId: 'grant-1', mode } as never);
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper); await caller(wrapper);
    expect(wrapper.find('textarea').exists()).toBe(false); expect(wrapper.text()).toContain('填写编号不会赋予认证能力');
    await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises();
    expect(createActivation).toHaveBeenCalledWith('grant-1', { deploymentCode: 'deployment-b', callerBinding: { sourceId: 'official-service-source', subjectId: 'service-2' } }); expect(listActivations).toHaveBeenCalledTimes(2);
  });
  it('在线创建缺绑定时阻止请求，未默认使用登录管理员', async () => {
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper); await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises();
    expect(createActivation).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('在线或混合授权不能缺少绑定'); expect((wrapper.find('[aria-label="服务主体编号"]').element as HTMLInputElement).value).toBe('');
  });
  it('离线创建可以省略绑定，但不传 null', async () => {
    vi.mocked(getGrant).mockResolvedValue({ grantId: 'grant-1', mode: 'OFFLINE' } as never);
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper); await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises();
    expect(createActivation).toHaveBeenCalledWith('grant-1', { deploymentCode: 'deployment-b' });
  });
  it('创建离线激活透传本地额度分配，修订和编号由服务端生成', async () => {
    vi.mocked(getGrant).mockResolvedValue({ grantId: 'grant-1', mode: 'OFFLINE' } as never);
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper);
    await click(wrapper, '添加额度');
    await wrapper.find('[aria-label="额度指标 1"]').setValue('seat_limit');
    await wrapper.find('[aria-label="额度数量 1"]').setValue('12');
    await chooseAllocationRetention(wrapper, '固定截止');
    await wrapper.find('[aria-label="额度截止日期 1"]').setValue('2030-01-02');
    await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises();
    expect(createActivation).toHaveBeenCalledWith('grant-1', {
      deploymentCode: 'deployment-b',
      requestedAllocations: [{ metric: 'seat_limit', quantity: 12, retention: 'FIXED', retainUntil: 1893542400 }]
    });
  });
  it('本地额度拒绝非正整数且不发请求', async () => {
    vi.mocked(getGrant).mockResolvedValue({ grantId: 'grant-1', mode: 'OFFLINE' } as never);
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper);
    await click(wrapper, '添加额度'); await wrapper.find('[aria-label="额度指标 1"]').setValue('seat_limit'); await wrapper.find('[aria-label="额度数量 1"]').setValue('0');
    await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises();
    expect(createActivation).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('额度数量必须是正整数');
  });
  it('本地额度拒绝重复指标，避免生成互相覆盖的快照', async () => {
    vi.mocked(getGrant).mockResolvedValue({ grantId: 'grant-1', mode: 'OFFLINE' } as never);
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper);
    await click(wrapper, '添加额度'); await wrapper.find('[aria-label="额度指标 1"]').setValue('seat_limit'); await wrapper.find('[aria-label="额度数量 1"]').setValue('1');
    await click(wrapper, '添加额度'); await wrapper.find('[aria-label="额度指标 2"]').setValue('seat_limit'); await wrapper.find('[aria-label="额度数量 2"]').setValue('2');
    await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises();
    expect(createActivation).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('重复');
  });
  it('列表回显服务端固化的额度快照及固定截止日期', async () => {
    vi.mocked(listActivations).mockResolvedValue(pageOf([{ ...activation, requestedAllocations: [{ allocationId: 'alloc-1', metric: 'seat_limit', quantity: 10, grantRevision: 2, retention: 'FIXED', retainUntil: 1893542400 }] }]));
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises();
    expect(wrapper.text()).toContain('seat_limit 10'); expect(wrapper.text()).toContain('2030-01-02');
  });
  it('运行模式无法取得时不得当作离线跳过绑定', async () => {
    vi.mocked(getGrant).mockRejectedValue(new Error('不可读取授权'));
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper); await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises(); expect(createActivation).not.toHaveBeenCalled();
  });
  it.each([' service-2', '测'.repeat(43)])('绑定字段首尾空白或超128字节时拒绝提交：%s', async value => {
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper); await caller(wrapper); await wrapper.find('[aria-label="服务主体编号"]').setValue(value);
    await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises(); expect(createActivation).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('128 字节');
  });
  it('换机默认继承绑定，必须受控确认后按原行版本提交', async () => {
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); await click(wrapper, '换机');
    expect(replaceActivation).not.toHaveBeenCalled(); await wrapper.find('.license-activation-replace').trigger('submit'); await flushPromises(); expect(replaceActivation).not.toHaveBeenCalled();
    await wrapper.find('[aria-label="换机影响确认"]').setValue(true); vi.mocked(listActivations).mockResolvedValue(pageOf([{ ...activation, state: 'REPLACED' }, { ...activation, activationId: 'act-2', activationGeneration: 2 }]));
    await wrapper.find('.license-activation-replace').trigger('submit'); await flushPromises(); expect(replaceActivation).toHaveBeenCalledWith('act-1', { expectedRowVersion: 7, reasonCategory: 'NORMAL_REPLACEMENT' });
    expect(wrapper.text()).toContain('act-2'); const old = wrapper.findAll('tbody tr').find(item => item.text().includes('act-1'))!; expect(old.text()).toContain('已换机'); expect(old.text()).not.toContain('编辑服务绑定');
  });
  it('换机可明确更新服务绑定，在线旧激活缺绑定须补齐', async () => {
    vi.mocked(listActivations).mockResolvedValue(pageOf([{ ...activation, callerBinding: null }]));
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); expect(wrapper.text()).toContain('未绑定，禁止在线使用'); await click(wrapper, '换机');
    expect((wrapper.find('[aria-label="换机时更新服务绑定"]').element as HTMLInputElement).checked).toBe(true); await caller(wrapper, '换机'); await wrapper.find('[aria-label="换机影响确认"]').setValue(true);
    await wrapper.find('.license-activation-replace').trigger('submit'); await flushPromises(); expect(replaceActivation).toHaveBeenCalledWith('act-1', { expectedRowVersion: 7, reasonCategory: 'NORMAL_REPLACEMENT', callerBinding: { sourceId: 'official-service-source', subjectId: 'service-2' } });
  });
  it('编辑服务绑定需确认影响并带版本，不绕过认证链', async () => {
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); await click(wrapper, '编辑服务绑定'); await caller(wrapper, '绑定');
    await wrapper.find('.license-activation-binding').trigger('submit'); await flushPromises(); expect(patchActivationCallerBinding).not.toHaveBeenCalled(); await wrapper.find('[aria-label="服务绑定影响确认"]').setValue(true);
    await wrapper.find('.license-activation-binding').trigger('submit'); await flushPromises(); expect(patchActivationCallerBinding).toHaveBeenCalledWith('act-1', { expectedRowVersion: 7, callerBinding: { sourceId: 'official-service-source', subjectId: 'service-2' } }); expect(wrapper.text()).toContain('运行时仍须通过官方服务认证');
  });
  it('绑定并发冲突保留抽屉及输入，不显示更新成功', async () => {
    vi.mocked(patchActivationCallerBinding).mockRejectedValue(new Error('版本已变化，请回读后重试'));
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); await click(wrapper, '编辑服务绑定'); await caller(wrapper, '绑定'); await wrapper.find('[aria-label="服务绑定影响确认"]').setValue(true);
    await wrapper.find('.license-activation-binding').trigger('submit'); await flushPromises(); expect(wrapper.find('.license-activation-binding').exists()).toBe(true); expect(wrapper.text()).toContain('版本已变化'); expect(wrapper.text()).not.toContain('获准服务主体已更新');
  });
  it('下载按当前激活筛选，未就绪时不取其他凭据', async () => {
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); await click(wrapper, '下载凭据'); expect(listCredentials).toHaveBeenCalledWith(1, { grantId: 'grant-1', activationId: 'act-1' }); expect(getCredentialContent).not.toHaveBeenCalled(); expect(wrapper.find('[role="alert"]').text()).toContain('当前激活尚无已就绪凭据');
  });
  it('切换授权后旧请求不得覆盖新列表', async () => {
    let resolveOld!: (value: LicensePage<ActivationView>) => void; vi.mocked(listActivations).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); vi.mocked(listActivations).mockResolvedValue(pageOf([{ ...activation, activationId: 'act-current', grantId: 'grant-2' }])); await wrapper.setProps({ grantId: 'grant-2' }); await flushPromises();
    resolveOld(pageOf([{ ...activation, activationId: 'act-stale' }])); await flushPromises(); expect(wrapper.text()).not.toContain('act-stale'); expect(wrapper.text()).toContain('act-current');
  });
  it('没有管理权限仅保留下载和列表', async () => {
    vi.mocked(canApi).mockImplementation(code => code !== 'license.activation.manage'); const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); expect(wrapper.find('.page-header .button-primary').exists()).toBe(false); expect(wrapper.findAll('.license-table-actions button').map(button => button.text())).toEqual(['下载凭据']);
  });
  it.each(['license.grant.read', 'license.grant.deliver'])('下载缺少 %s 时不发下载请求', async denied => {
    vi.mocked(canApi).mockImplementation(code => code !== denied); const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); expect(wrapper.findAll('.license-table-actions button').some(button => button.text() === '下载凭据')).toBe(false); expect(listCredentials).not.toHaveBeenCalled();
  });
  it('打开表单后失去管理权限不得创建', async () => {
    const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await createDrawer(wrapper); await caller(wrapper); vi.mocked(canApi).mockImplementation(code => code !== 'license.activation.manage'); await wrapper.find('.license-activation-create').trigger('submit'); await flushPromises(); expect(createActivation).not.toHaveBeenCalled();
  });
  it('绑定迟到响应不能为新身份显示成功', async () => {
    let resolve!: (value: ActivationView) => void; vi.mocked(patchActivationCallerBinding).mockReturnValue(new Promise(done => { resolve = done; })); const wrapper = mount(ActivationSection, { props: { section: 'activations', grantId: 'grant-1' } }); await flushPromises(); await click(wrapper, '编辑服务绑定'); await caller(wrapper, '绑定'); await wrapper.find('[aria-label="服务绑定影响确认"]').setValue(true);
    await wrapper.find('.license-activation-binding').trigger('submit'); identity.generation += 1; resolve({ ...activation, rowVersion: 8 }); await flushPromises(); expect(wrapper.text()).not.toContain('获准服务主体已更新');
  });
});
