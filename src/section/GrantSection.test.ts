import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import GrantSection from './GrantSection.vue';
import { canApi, canPage } from '../auth/permissions';
import { captureLicenseSession } from '../ui/sessionFence';
import type { ActivationView, GrantView, SubjectAssignmentView } from '../api/domain';
import type { LicensePage } from '../api/http';
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true), canPage: vi.fn(() => true) }));
vi.mock('../ui/sessionFence', () => ({ captureLicenseSession: vi.fn(() => () => true) }));

vi.mock('../api/domain', async () => ({
  ...await vi.importActual<typeof import('../api/domain')>('../api/domain'),
  listGrants: vi.fn(),
  createGrant: vi.fn(),
  listCustomers: vi.fn(),
  listProducts: vi.fn(),
  patchGrantState: vi.fn(),
  listModels: vi.fn(),
  listPlans: vi.fn(),
  getModelVersion: vi.fn(),
  getPlanVersion: vi.fn(),
  listSigningProfiles: vi.fn(),
  listSubjectAssignments: vi.fn(),
  listActivations: vi.fn(),
  requestCredentialIssuance: vi.fn()
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}));

import { createGrant, getModelVersion, getPlanVersion, listActivations, listCustomers, listGrants, listModels, listPlans, listProducts, listSigningProfiles, listSubjectAssignments, patchGrantState, requestCredentialIssuance } from '../api/domain';

// 契约 FormSelect 交互：按 aria-label 定位开关，点开菜单后按选项文本点击
async function chooseOption(wrapper: ReturnType<typeof mount>, selectLabel: string, optionLabel: string, scope = '.license-grant-editor') {
  const toggle = wrapper.find(`${scope} button[aria-label="${selectLabel}"]`);
  expect(toggle.exists(), `下拉「${selectLabel}」应存在`).toBe(true);
  await toggle.trigger('click');
  const options = wrapper.findAll(`${scope} .form-select-option`);
  const target = options.filter(option => option.text() === optionLabel)[0];
  expect(target, `选项「${optionLabel}」应存在`).toBeDefined();
  await target.trigger('click');
  await flushPromises();
}

function pageOf<T>(data: T[]): LicensePage<T> {
  return { data, total: data.length, page: 1, size: 20, totalPages: data.length ? 1 : 0 };
}

const grants = [
  { grantId: 'g-1', customerId: 'cu-1', productId: 'p-1', subjectKind: 'PERSON', eligibilityKind: 'CUSTOMER_MEMBERS', mode: 'ONLINE', state: 'ENABLED', grantRevision: 2, grantStateVersion: 1, businessOrderRef: 'order-9', rowVersion: 1 },
  { grantId: 'g-2', customerId: 'cu-1', productId: 'p-1', subjectKind: 'DEPLOYMENT', eligibilityKind: 'ALLOCATED_DEPLOYMENTS', mode: 'OFFLINE', state: 'ENABLED', grantRevision: 1, grantStateVersion: 1, businessOrderRef: null, rowVersion: 1 }
];
const activation: ActivationView = { activationId: 'act-current', grantId: 'g-2', deploymentCode: 'deployment-a', activationGeneration: 4,
  state: 'ACTIVE', deviceBindingMode: 'NONE', callerBinding: null, requestedAllocations: [], rowVersion: 3 };
const serviceGrant: GrantView = { ...grants[0]!, grantId: 'g-service', subjectKind: 'SERVICE', eligibilityKind: 'ASSIGNED_SUBJECTS', mode: 'OFFLINE' };
const assignment: SubjectAssignmentView = { assignmentId: 'assignment-current', grantId: 'g-service',
  subjectRef: { kind: 'SERVICE', sourceId: 'official-source', subjectId: 'service-a' }, assignmentGeneration: 7,
  state: 'ACTIVE', metrics: [], retention: 'NAMED', rowVersion: 6 };

describe('GrantSection', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canApi).mockReturnValue(true);
    vi.mocked(canPage).mockReturnValue(true);
    vi.mocked(captureLicenseSession).mockImplementation(() => () => true);
    vi.mocked(listGrants).mockResolvedValue(pageOf(grants));
    vi.mocked(createGrant).mockResolvedValue(grants[0]);
    vi.mocked(patchGrantState).mockResolvedValue(grants[0]);
    vi.mocked(listCustomers).mockResolvedValue(pageOf([
      { customerId: 'cu-1', code: 'bank', displayName: '某银行', status: 'ACTIVE', rowVersion: 1 }
    ]) as never);
    vi.mocked(listProducts).mockResolvedValue(pageOf([
      { productId: 'p-1', issuerId: 'iss-1', code: 'ch', displayName: '渠道管理系统', supportedCapabilities: [], declaredActions: ['channel.create'], status: 'ACTIVE', rowVersion: 1 }
    ]) as never);
    vi.mocked(listModels).mockResolvedValue(pageOf([]));
    vi.mocked(listPlans).mockResolvedValue(pageOf([]));
    vi.mocked(listSigningProfiles).mockResolvedValue(pageOf([
      { profileId: 'profile-1', productId: 'p-1', purpose: 'CREDENTIAL', kid: 'kid-current', status: 'ACTIVE', rowVersion: 1, publicKeyFingerprint: 'mock-fingerprint', createdAt: null, retiredAt: null }
    ]));
    vi.mocked(listActivations).mockResolvedValue(pageOf([activation]));
    vi.mocked(listSubjectAssignments).mockResolvedValue(pageOf([assignment]));
    vi.mocked(requestCredentialIssuance).mockResolvedValue({ operationId: 'op-1', credentialId: 'cred-1', grantId: 'g-2',
      state: 'READY', executionGeneration: 1, rowVersion: 2, reasonCategory: null, resultResource: '/api/license/v1/credentials/cred-1/content' });
  });

  it('授权列表加载并渲染对象/资格/模式组合', async () => {
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    expect(wrapper.text()).toContain('g-1');
    expect(wrapper.text()).toContain('人员 · 客户成员 · 在线');
    expect(wrapper.text()).toContain('r2 · v1');
  });

  it('部署授权入口显示部署激活，人员授权显示资格名单', async () => {
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    const buttons = wrapper.findAll('tbody button').map(button => button.text());
    expect(buttons).toContain('资格名单');
    expect(buttons).toContain('部署激活');
    expect(buttons).toContain('暂停'); // 管理动作入口（启用/暂停）
  });

  it('对象切换联动资格政策选项，新建服务离线授权', async () => {
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    vi.mocked(getModelVersion).mockResolvedValue(model);
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    await flushPromises();
    await chooseOption(wrapper, '客户', '某银行');
    await chooseOption(wrapper, '产品', '渠道管理系统');
    await chooseOption(wrapper, '条件模型', 'mv-four… (v1)');
    await chooseOption(wrapper, '校验模式', '离线');
    await chooseOption(wrapper, '授权对象', '服务');
    const inputs = wrapper.findAll('.license-grant-editor input');
    if (inputs.length > 0) await inputs[0].setValue('local-v1');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(vi.mocked(createGrant)).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cu-1',
      productId: 'p-1',
      subjectKind: 'SERVICE',
      mode: 'OFFLINE',
      eligibilityKind: 'ASSIGNED_SUBJECTS'
    }));
  });

  it('未关联模型时禁止提交，保留表单供选择已发布模型', async () => {
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    await flushPromises();
    await chooseOption(wrapper, '客户', '某银行');
    await chooseOption(wrapper, '产品', '渠道管理系统');
    await chooseOption(wrapper, '校验模式', '离线');
    await chooseOption(wrapper, '授权对象', '人员');
    await chooseOption(wrapper, '资格政策', '客户当前成员');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('请先选择当前产品的已发布模型');
    expect(wrapper.find('.license-grant-editor').exists()).toBe(true);
  });

  async function openForProduct() {
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    await flushPromises();
    await chooseOption(wrapper, '客户', '某银行');
    await chooseOption(wrapper, '产品', '渠道管理系统');
    return wrapper;
  }

  const model = {
    modelVersionId: 'mv-four', modelId: 'm-1', productId: 'p-1', version: 1, status: 'PUBLISHED', rowVersion: 1,
    fieldsSummary: '', actionsSummary: '', snapshot: {
      fields: { rights: {
        seats: { type: 'INTEGER' as const, minimum: 1, maximum: 9, required: true },
        enabled: { type: 'BOOLEAN' as const }, text: { type: 'STRING' as const }, areas: { type: 'STRING_SET' as const }
      }, facts: {} }, actions: {}
    }
  };
  const plan = { planVersionId: 'pv-four', planId: 'pl-1', productId: 'p-1', modelVersionId: 'mv-four', version: 1, status: 'PUBLISHED', rowVersion: 2 };

  it('已发布方案自动关联模型，四类预填经人工修改按真实类型提交', async () => {
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    vi.mocked(listPlans).mockResolvedValue(pageOf([plan]));
    vi.mocked(getModelVersion).mockResolvedValue(model);
    vi.mocked(getPlanVersion).mockResolvedValue({ ...plan, prefillRights: { seats: 4, enabled: false, text: '', areas: ['北区,东区', '多行\n文本', ''] } });
    const wrapper = await openForProduct();
    await chooseOption(wrapper, '方案预填', 'pv-four…');
    expect(wrapper.find('button[aria-label="条件模型"]').text()).toContain('mv-four');
    expect(wrapper.find('button[aria-label="方案预填"]').text()).toContain('pv-four');
    await wrapper.find('[aria-label="权益 seats"]').setValue('6');
    await chooseOption(wrapper, '权益 enabled', '是');
    await wrapper.find('[aria-label="权益 text"]').setValue('  原文  ');
    await wrapper.find('[aria-label="权益 areas 第 2 项"]').setValue('修改,保留\n换行');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).toHaveBeenCalledWith(expect.objectContaining({ modelVersionId: 'mv-four', rights: {
      seats: 6, enabled: true, text: '  原文  ', areas: ['北区,东区', '修改,保留\n换行', '']
    } }));
  });

  it('草稿授权可以启用，终态授权保持禁止启用', async () => {
    vi.mocked(listGrants).mockResolvedValue(pageOf([
      { ...grants[0]!, state: 'DRAFT' }, { ...grants[1]!, state: 'REVOKED' }
    ]));
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    const buttons = wrapper.findAll('tbody button').filter(button => button.text() === '启用');
    expect(buttons[0]!.attributes('disabled')).toBeUndefined();
    expect(buttons[1]!.attributes('disabled')).toBeDefined();
    await buttons[0]!.trigger('click');
    await flushPromises();
    expect(patchGrantState).toHaveBeenCalledWith('g-1', { state: 'ENABLED' }, 1);
    expect(wrapper.text()).toContain('授权已启用。');
  });

  it('创建响应迟到且身份已变化时不回写成功或再次读取列表', async () => {
    let sameSession = true;
    let finish!: (value: GrantView) => void;
    vi.mocked(captureLicenseSession).mockImplementation(() => () => sameSession);
    vi.mocked(createGrant).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    vi.mocked(getModelVersion).mockResolvedValue(model);
    const wrapper = await openForProduct();
    await chooseOption(wrapper, '条件模型', 'mv-four… (v1)');
    await wrapper.find('[aria-label="权益 seats"]').setValue('2');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    const readsBeforeResponse = vi.mocked(listGrants).mock.calls.length;
    sameSession = false;
    finish({ ...grants[0]!, grantId: 'old-identity-grant' });
    await flushPromises();
    expect(wrapper.text()).not.toContain('授权已创建：old-identity-grant');
    expect(listGrants).toHaveBeenCalledTimes(readsBeforeResponse);
  });

  it('手工权益拒绝小数并保留输入，不伪造整数请求', async () => {
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    vi.mocked(getModelVersion).mockResolvedValue(model);
    const wrapper = await openForProduct();
    await chooseOption(wrapper, '条件模型', 'mv-four… (v1)');
    await wrapper.find('[aria-label="权益 seats"]').setValue('2.5');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('必须是有效整数');
    expect((wrapper.find('[aria-label="权益 seats"]').element as HTMLInputElement).value).toBe('2.5');
  });

  it('方案的 false、空文本和空集合不会被当成未提供', async () => {
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    vi.mocked(listPlans).mockResolvedValue(pageOf([plan]));
    vi.mocked(getModelVersion).mockResolvedValue(model);
    vi.mocked(getPlanVersion).mockResolvedValue({ ...plan, prefillRights: { seats: 1, enabled: false, text: '', areas: [] } });
    const wrapper = await openForProduct();
    await chooseOption(wrapper, '方案预填', 'pv-four…');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).toHaveBeenCalledWith(expect.objectContaining({ rights: { seats: 1, enabled: false, text: '', areas: [] } }));
  });

  it('模型详情读取失败时禁提交，不发送空权益', async () => {
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    vi.mocked(getModelVersion).mockRejectedValue(new Error('模型暂不可用'));
    const wrapper = await openForProduct();
    await chooseOption(wrapper, '条件模型', 'mv-four… (v1)');
    expect(wrapper.find('.license-grant-editor button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('模型暂不可用');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).not.toHaveBeenCalled();
  });

  it('产品切换清旧模型方案权益，迟到详情不能回填', async () => {
    vi.mocked(listProducts).mockResolvedValue(pageOf([
      { productId: 'p-1', displayName: '渠道管理系统' }, { productId: 'p-2', displayName: '通用产品二' }
    ]) as never);
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    let finish!: (value: typeof model) => void;
    vi.mocked(getModelVersion).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const wrapper = await openForProduct();
    await chooseOption(wrapper, '条件模型', 'mv-four… (v1)');
    await chooseOption(wrapper, '产品', '通用产品二');
    finish(model);
    await flushPromises();
    expect(wrapper.find('[data-right-field="seats"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="条件模型"]').text()).toBe('请选择已发布模型');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('请先选择当前产品的已发布模型');
  });

  it('清除方案恢复当前模型默认值，不沿用旧方案预填', async () => {
    vi.mocked(listModels).mockResolvedValue(pageOf([model]));
    vi.mocked(listPlans).mockResolvedValue(pageOf([plan]));
    vi.mocked(getModelVersion).mockResolvedValue(model);
    vi.mocked(getPlanVersion).mockResolvedValue({ ...plan, prefillRights: { seats: 9, enabled: true, text: '方案值', areas: ['方案项'] } });
    const wrapper = await openForProduct();
    await chooseOption(wrapper, '方案预填', 'pv-four…');
    await chooseOption(wrapper, '方案预填', '不使用方案预填');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).toHaveBeenCalledWith(expect.objectContaining({ rights: { seats: 1, enabled: false, text: '', areas: [] } }));
  });

  it('缺管理码与详情页码时隐藏对应操作', async () => {
    vi.mocked(canApi).mockImplementation(code => code.endsWith('.read'));
    vi.mocked(canPage).mockReturnValue(false);
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    expect(wrapper.find('header button.button-primary').exists()).toBe(false);
    const actions = wrapper.findAll('tbody button').map(button => button.text());
    expect(actions).not.toContain('暂停');
    expect(actions).not.toContain('签发凭据');
    expect(actions).not.toContain('资格名单');
    expect(actions).not.toContain('部署激活');
  });

  it('表单打开后管理权限消失，强制提交仍不发送写请求', async () => {
    const wrapper = await openForProduct();
    vi.mocked(canApi).mockImplementation(code => code !== 'license.grant.manage');
    await wrapper.find('.license-grant-editor').trigger('submit');
    await flushPromises();
    expect(createGrant).not.toHaveBeenCalled();
  });

  async function openIssuance() {
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    await wrapper.findAll('tbody button').find(button => button.text() === '签发凭据')!.trigger('click');
    await flushPromises();
    return wrapper;
  }

  it('只给OFFLINE显示普通离线签发，ONLINE和HYBRID提示相应流程', async () => {
    vi.mocked(listGrants).mockResolvedValue(pageOf([grants[0]!, { ...grants[1]!, grantId: 'g-hybrid', mode: 'HYBRID' }, grants[1]!]));
    const wrapper = mount(GrantSection, { props: { section: 'grants' } });
    await flushPromises();
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0]!.text()).toContain('通过在线判定使用');
    expect(rows[1]!.text()).toContain('支持在线判定，暂不提供租约交付');
    expect(rows[0]!.text()).not.toContain('签发凭据');
    expect(rows[1]!.text()).not.toContain('签发凭据');
    expect(rows[2]!.text()).toContain('签发凭据');
  });

  it('部署签发从已有激活选择，提交精确激活编号与换机后代数', async () => {
    const wrapper = await openIssuance();
    expect(listActivations).toHaveBeenCalledWith('g-2');
    expect(wrapper.findAll('.license-issue-editor input')).toHaveLength(0);
    await chooseOption(wrapper, '有效激活', 'deployment-a · act-current · 代数 4', '.license-issue-editor');
    await wrapper.find('.license-issue-editor').trigger('submit');
    await flushPromises();
    expect(requestCredentialIssuance).toHaveBeenCalledWith('g-2', { kid: 'kid-current', subjectRef: {
      kind: 'DEPLOYMENT', activationId: 'act-current', activationGeneration: 4
    } }, expect.any(String));
    expect(wrapper.text()).toContain('凭据已就绪：cred-1');
    expect(wrapper.find('.license-issue-editor button[type="submit"]').attributes('disabled')).toBeDefined();
  });

  it('固定服务资格提交来源、主体、资格编号与当前代数，不靠手填证明', async () => {
    vi.mocked(listGrants).mockResolvedValue(pageOf([serviceGrant]));
    const wrapper = await openIssuance();
    expect(listSubjectAssignments).toHaveBeenCalledWith('g-service');
    await chooseOption(wrapper, '有效资格', 'official-source / service-a · assignment-current · 代数 7', '.license-issue-editor');
    await wrapper.find('.license-issue-editor').trigger('submit');
    await flushPromises();
    expect(requestCredentialIssuance).toHaveBeenCalledWith('g-service', { kid: 'kid-current', subjectRef: {
      kind: 'SERVICE', sourceId: 'official-source', subjectId: 'service-a', assignmentId: 'assignment-current', assignmentGeneration: 7
    } }, expect.any(String));
  });

  it('候选排除其他授权、错误种类、暂停对象与非法代数', async () => {
    vi.mocked(listGrants).mockResolvedValue(pageOf([serviceGrant]));
    vi.mocked(listSubjectAssignments).mockResolvedValue(pageOf([
      assignment, { ...assignment, assignmentId: 'wrong-grant', grantId: 'other-grant' },
      { ...assignment, assignmentId: 'wrong-kind', subjectRef: { ...assignment.subjectRef, kind: 'PERSON' } },
      { ...assignment, assignmentId: 'suspended', state: 'SUSPENDED' }, { ...assignment, assignmentId: 'invalid-generation', assignmentGeneration: 0 }
    ]));
    const wrapper = await openIssuance();
    await wrapper.find('.license-issue-editor button[aria-label="有效资格"]').trigger('click');
    expect(wrapper.findAll('.license-issue-editor .form-select-option').map(item => item.text())).toEqual([
      'official-source / service-a · assignment-current · 代数 7'
    ]);
  });

  it('不选择对象、无可用档案或候选读取失败时强制submit也不签发', async () => {
    const wrapper = await openIssuance();
    await wrapper.find('.license-issue-editor').trigger('submit');
    expect(requestCredentialIssuance).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('请完整读取签发候选');
    wrapper.unmount();
    vi.mocked(listSigningProfiles).mockResolvedValue(pageOf([
      { profileId: 'other-profile', productId: 'other-product', purpose: 'CREDENTIAL', kid: 'other-kid', status: 'ACTIVE', rowVersion: 1, publicKeyFingerprint: '', createdAt: null, retiredAt: null }
    ]));
    const noProfile = await openIssuance();
    expect(noProfile.text()).toContain('当前产品没有可用的凭据签名档案');
    await noProfile.find('.license-issue-editor').trigger('submit');
    expect(requestCredentialIssuance).not.toHaveBeenCalled();
    noProfile.unmount();
    vi.mocked(listActivations).mockRejectedValue(new Error('激活读取失败'));
    const failed = await openIssuance();
    expect(failed.text()).toContain('激活读取失败');
    await failed.find('.license-issue-editor').trigger('submit');
    expect(requestCredentialIssuance).not.toHaveBeenCalled();
  });

  it('候选读权限消失或身份切换后不能用旧候选签发', async () => {
    let sameSession = true;
    vi.mocked(captureLicenseSession).mockImplementation(() => () => sameSession);
    const wrapper = await openIssuance();
    await chooseOption(wrapper, '有效激活', 'deployment-a · act-current · 代数 4', '.license-issue-editor');
    vi.mocked(canApi).mockImplementation(code => code !== 'license.activation.read');
    await wrapper.find('.license-issue-editor').trigger('submit');
    expect(requestCredentialIssuance).not.toHaveBeenCalled();
    vi.mocked(canApi).mockReturnValue(true);
    sameSession = false;
    await wrapper.find('.license-issue-editor').trigger('submit');
    expect(requestCredentialIssuance).not.toHaveBeenCalled();
  });

  it('同一请求结果不明后重试沿用原输入与幂等键', async () => {
    vi.mocked(requestCredentialIssuance).mockRejectedValueOnce(new Error('调用结果未知'));
    const wrapper = await openIssuance();
    await chooseOption(wrapper, '有效激活', 'deployment-a · act-current · 代数 4', '.license-issue-editor');
    await wrapper.find('.license-issue-editor').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('调用结果未知');
    await wrapper.find('.license-issue-editor').trigger('submit');
    await flushPromises();
    const calls = vi.mocked(requestCredentialIssuance).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
  });

  it('关闭后旧候选迟到不能覆盖新打开的签发对象', async () => {
    let finish!: (value: LicensePage<ActivationView>) => void;
    vi.mocked(listActivations).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const wrapper = await openIssuance();
    await wrapper.findAll('.license-issue-editor button').find(item => item.text() === '关闭')!.trigger('click');
    await wrapper.findAll('tbody button').find(button => button.text() === '签发凭据')!.trigger('click');
    await flushPromises();
    finish(pageOf([{ ...activation, activationId: 'late-old', deploymentCode: 'late', activationGeneration: 1 }]));
    await flushPromises();
    await wrapper.find('.license-issue-editor button[aria-label="有效激活"]').trigger('click');
    const options = wrapper.findAll('.license-issue-editor .form-select-option').map(item => item.text());
    expect(options).toEqual(['deployment-a · act-current · 代数 4']);
  });
});
