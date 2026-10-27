import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import OperationsSection from './OperationsSection.vue';
import type { OperationRow } from '../api/domain';
const identity = vi.hoisted(() => ({ generation: 1 }));
vi.mock('../auth/pkce', () => ({ getAccessToken: () => 'current-token', getAuthorizationGeneration: () => identity.generation }));
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true), permissionState: { ready: true } }));
vi.mock('../api/domain', () => ({ abandonOperation: vi.fn(), getOperation: vi.fn(), listOperations: vi.fn(), recoverOperation: vi.fn() }));
import { abandonOperation, getOperation, listOperations, recoverOperation } from '../api/domain';
import { canApi } from '../auth/permissions';
enableAutoUnmount(afterEach);
function row(override: Partial<OperationRow> = {}): OperationRow { return { operationId: 'operation-1', grantId: 'grant-1', credentialId: 'credential-1', state: 'UNCERTAIN', executionGeneration: 2, rowVersion: 7, lastKmsCallAt: null, reasonCategory: null, resultResource: null, ...override }; }
function pageOf(data: OperationRow[]) { return { data, total: data.length, page: 1, size: 20, totalPages: 1 }; }
async function click(wrapper: ReturnType<typeof mount>, text: string) { const button = wrapper.findAll('button').find(item => item.text() === text); expect(button, text).toBeDefined(); await button!.trigger('click'); await flushPromises(); }
async function detail(wrapper: ReturnType<typeof mount>) { await flushPromises(); await click(wrapper, '查看详情'); }
describe('签发任务受控治理', () => {
  beforeEach(() => { vi.resetAllMocks(); identity.generation = 1; vi.mocked(canApi).mockReturnValue(true); vi.mocked(listOperations).mockResolvedValue(pageOf([row()])); vi.mocked(getOperation).mockResolvedValue(row()); vi.mocked(recoverOperation).mockResolvedValue(row({ state: 'READY', executionGeneration: 3, rowVersion: 9 })); vi.mocked(abandonOperation).mockResolvedValue(row({ state: 'ABANDONED', rowVersion: 8 })); });
  it('列表只提供详情，恢复前回读且必须显式确认', async () => {
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); await click(wrapper, '恢复任务');
    expect(getOperation).toHaveBeenCalledTimes(2); expect(recoverOperation).not.toHaveBeenCalled();
    await wrapper.find('.license-operation-action').trigger('submit'); await flushPromises(); expect(recoverOperation).not.toHaveBeenCalled();
    await wrapper.find('[aria-label="任务处理确认"]').setValue(true); await wrapper.find('.license-operation-action').trigger('submit'); await flushPromises();
    expect(recoverOperation).toHaveBeenCalledWith('operation-1', { expectedRowVersion: 7, expectedExecutionGeneration: 2, reasonCategory: 'MANUAL_RECOVERY' });
    expect(wrapper.text()).toContain('恢复结果：已就绪'); expect(wrapper.text()).not.toContain('等待任务重新执行');
  });
  it('正常签名接管显示窗口说明，携带版本与原因', async () => {
    vi.mocked(getOperation).mockResolvedValue(row({ state: 'SIGNING', lastKmsCallAt: '2026-10-12T00:00:00Z' }));
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); await click(wrapper, '接管失联签名');
    expect(wrapper.text()).toContain('服务端会检查宿主允许的接管窗口'); await wrapper.find('[aria-label="任务处理确认"]').setValue(true); await wrapper.find('.license-operation-action').trigger('submit'); await flushPromises();
    expect(recoverOperation).toHaveBeenCalledWith('operation-1', { expectedRowVersion: 7, expectedExecutionGeneration: 2, reasonCategory: 'STALE_SIGNING_TAKEOVER' });
  });
  it('放弃只针对结果不明任务，需说明历史文件不撤回', async () => {
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); await click(wrapper, '安全放弃');
    expect(abandonOperation).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('不能通过恢复重新执行');
    await wrapper.find('[aria-label="任务处理确认"]').setValue(true); await wrapper.find('.license-operation-action').trigger('submit'); await flushPromises();
    expect(abandonOperation).toHaveBeenCalledWith('operation-1', { expectedRowVersion: 7, reasonCategory: 'MANUAL_ABANDON' }); expect(wrapper.text()).toContain('已放弃');
  });
  it.each(['PENDING_SIGN', 'SIGNING', 'READY', 'ABANDONED', 'REJECTED'])('%s 没有安全放弃入口', async state => {
    vi.mocked(getOperation).mockResolvedValue(row({ state })); const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper);
    expect(wrapper.findAll('.entity-drawer button').some(button => button.text() === '安全放弃')).toBe(false);
  });
  it('回读时已经就绪，撤销恢复表单', async () => {
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); vi.mocked(getOperation).mockResolvedValue(row({ state: 'READY' })); await click(wrapper, '恢复任务');
    expect(wrapper.find('.license-operation-action').exists()).toBe(false); expect(recoverOperation).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('当前任务不能恢复');
  });
  it('恢复失败回读状态，不能用旧确认直接重发', async () => {
    vi.mocked(recoverOperation).mockRejectedValue(new Error('尚未达到接管窗口'));
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); await click(wrapper, '恢复任务'); await wrapper.find('[aria-label="任务处理确认"]').setValue(true);
    vi.mocked(getOperation).mockResolvedValue(row({ state: 'SIGNING', rowVersion: 8 })); await wrapper.find('.license-operation-action').trigger('submit'); await flushPromises();
    expect(wrapper.find('.license-operation-action').exists()).toBe(false); expect(wrapper.text()).toContain('尚未达到接管窗口'); expect(wrapper.text()).toContain('签名中');
  });
  it('缺管理权限保持只读详情，表单打开后撤销权限拒绝提交', async () => {
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); await click(wrapper, '恢复任务'); await wrapper.find('[aria-label="任务处理确认"]').setValue(true);
    vi.mocked(canApi).mockImplementation(code => code !== 'license.operation.recover'); await wrapper.find('.license-operation-action').trigger('submit'); await flushPromises(); expect(recoverOperation).not.toHaveBeenCalled();
  });
  it('详情迟到且身份切换时拒绝展示旧凭据编号', async () => {
    let resolve!: (value: OperationRow) => void; vi.mocked(getOperation).mockReturnValue(new Promise(done => { resolve = done; }));
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); identity.generation += 1; resolve(row({ credentialId: 'old-private-credential' })); await flushPromises(); expect(wrapper.text()).not.toContain('old-private-credential');
  });
  it('恢复返回迟到且身份变化时不得显示就绪成功', async () => {
    let resolve!: (value: OperationRow) => void; vi.mocked(recoverOperation).mockReturnValue(new Promise(done => { resolve = done; }));
    const wrapper = mount(OperationsSection, { props: { section: 'operations' } }); await detail(wrapper); await click(wrapper, '恢复任务'); await wrapper.find('[aria-label="任务处理确认"]').setValue(true);
    await wrapper.find('.license-operation-action').trigger('submit'); identity.generation += 1; resolve(row({ state: 'READY' })); await flushPromises(); expect(wrapper.text()).not.toContain('恢复结果：已就绪');
  });
});
