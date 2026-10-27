import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils';
import PlanSection from './PlanSection.vue';
import { canApi } from '../auth/permissions';
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true) }));
import type { LicensePage } from '../api/http';

vi.mock('../api/domain', async () => {
  const actual = await vi.importActual<typeof import('../api/domain')>('../api/domain');
  return {
    ...actual,
    listPlans: vi.fn(),
    listProducts: vi.fn(),
    listModels: vi.fn(),
    getModelVersion: vi.fn(),
    getPlanVersion: vi.fn(),
    createPlan: vi.fn(),
    patchPlanPrefill: vi.fn(),
    publishPlanVersion: vi.fn()
  };
});

import {
  createPlan, getModelVersion, getPlanVersion, listModels, listPlans, listProducts,
  patchPlanPrefill, publishPlanVersion,
  type ModelFieldDef, type ModelVersionDetail, type ModelVersionView, type PlanVersionDetail,
  type RightsValues
} from '../api/domain';

enableAutoUnmount(afterEach);

const plans = [
  { planVersionId: 'pv-1', planId: 'plan-1', productId: 'p-1', modelVersionId: 'mv-9', version: 1, status: 'DRAFT', rowVersion: 1 },
  { planVersionId: 'pv-2', planId: 'plan-2', productId: 'p-1', modelVersionId: 'mv-9', version: 2, status: 'PUBLISHED', rowVersion: 2 }
];

function pageOf<T>(data: T[]): LicensePage<T> {
  return { data, total: data.length, page: 1, size: 20, totalPages: data.length ? 1 : 0 };
}

function modelDetail(rights: Record<string, ModelFieldDef> = {}, modelVersionId = 'mv-9', productId = 'p-1'): ModelVersionDetail {
  return {
    modelVersionId, modelId: `mdl-${modelVersionId}`, productId, version: 1,
    status: 'PUBLISHED', fieldsSummary: '', actionsSummary: '', rowVersion: 1,
    snapshot: { fields: { rights, facts: {} }, actions: {} }
  };
}

const mixedDefinitions: Record<string, ModelFieldDef> = {
  limit: { type: 'INTEGER', minimum: 0, maximum: 100 },
  enabled: { type: 'BOOLEAN' },
  title: { type: 'STRING' },
  regions: { type: 'STRING_SET' }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function chooseOption(wrapper: ReturnType<typeof mount>, label: string, optionText: string) {
  const toggle = wrapper.find(`button[aria-label="${label}"]`);
  expect(toggle.exists(), `下拉「${label}」应存在`).toBe(true);
  await toggle.trigger('click');
  const option = wrapper.findAll('.form-select-option').find(item => item.text().includes(optionText));
  expect(option, `选项「${optionText}」应存在`).toBeDefined();
  await option!.trigger('click');
}

async function openCreate(wrapper: ReturnType<typeof mount>) {
  await flushPromises();
  await wrapper.find('header button.button-primary').trigger('click');
  await flushPromises();
}

async function openDraftEdit(wrapper: ReturnType<typeof mount>) {
  await flushPromises();
  await wrapper.findAll('tbody button').find(button => button.text() === '编辑预填')!.trigger('click');
  await flushPromises();
}

async function submitEditor(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('.license-plan-editor').trigger('submit');
  await flushPromises();
}

describe('PlanSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(canApi).mockReturnValue(true);
    vi.mocked(listPlans).mockResolvedValue(pageOf(plans));
    vi.mocked(listProducts).mockResolvedValue(pageOf([
      { productId: 'p-1', code: 'channel', displayName: '渠道套件' }
    ]) as never);
    vi.mocked(listModels).mockResolvedValue(pageOf([
      { modelVersionId: 'mv-9', modelId: 'mdl-9', productId: 'p-1', version: 1, status: 'PUBLISHED', fieldsSummary: '2 个字段', actionsSummary: '1 个动作', rowVersion: 1 }
    ]) as never);
    vi.mocked(getModelVersion).mockResolvedValue(modelDetail());
    vi.mocked(getPlanVersion).mockResolvedValue({ ...plans[0]!, prefillRights: {}, rowVersion: 7 });
    vi.mocked(createPlan).mockResolvedValue(plans[0]!);
    vi.mocked(patchPlanPrefill).mockResolvedValue({ ...plans[0]!, rowVersion: 8 });
    vi.mocked(publishPlanVersion).mockResolvedValue(plans[1]!);
  });

  it('缺管理权限时隐藏新建编辑发布入口', async () => {
    vi.mocked(canApi).mockImplementation(code => code.endsWith('.read'));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await flushPromises();
    expect(wrapper.find('header button.button-primary').exists()).toBe(false);
    const actions = wrapper.findAll('tbody button').map(button => button.text());
    expect(actions).not.toContain('编辑预填');
    expect(actions).not.toContain('发布');
  });

  it('读取模型期间清空选择会结束加载，迟到响应不恢复权益', async () => {
    const pending = deferred<ModelVersionDetail>();
    vi.mocked(getModelVersion).mockReturnValueOnce(pending.promise);
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await flushPromises();
    expect(wrapper.text()).toContain('正在读取模型与权益');
    await chooseOption(wrapper, '已发布模型版本', '选择模型版本');
    await flushPromises();
    expect(wrapper.text()).not.toContain('正在读取模型与权益');
    pending.resolve(modelDetail(mixedDefinitions));
    await flushPromises();
    expect(wrapper.find('[data-right-field="limit"]').exists()).toBe(false);
    expect(wrapper.find('.license-plan-editor button[type="submit"]').attributes('disabled')).toBeDefined();
  });

  it('读取模型候选期间清空产品不会遗留加载态', async () => {
    const pending = deferred<LicensePage<ModelVersionView>>();
    vi.mocked(listModels).mockReturnValueOnce(pending.promise);
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '产品', '选择产品');
    await flushPromises();
    expect(wrapper.text()).not.toContain('正在读取模型与权益');
    pending.resolve(pageOf([modelDetail()]));
    await flushPromises();
    expect(wrapper.find('button[aria-label="已发布模型版本"]').attributes('disabled')).toBeDefined();
  });

  it('方案列表渲染产品显示名与状态徽标', async () => {
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await flushPromises();
    expect(wrapper.text()).toContain('渠道套件');
    expect(wrapper.text()).toContain('草稿');
    expect(wrapper.text()).toContain('已发布');
  });

  it('草稿行提供编辑预填与发布', async () => {
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await flushPromises();
    const actions = wrapper.findAll('tbody button').map(button => button.text());
    expect(actions).toContain('编辑预填');
    expect(actions).toContain('发布');
  });

  it('发布走行版本围栏并刷新', async () => {
    vi.mocked(publishPlanVersion).mockResolvedValue(plans[1]!);
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await flushPromises();
    await wrapper.findAll('tbody button').find(button => button.text() === '发布')!.trigger('click');
    await flushPromises();
    expect(vi.mocked(publishPlanVersion)).toHaveBeenCalledWith('pv-1', 1);
    expect(wrapper.text()).toContain('方案已发布');
  });

  it('新建方案：选模型回读 rights 声明预填并提交', async () => {
    vi.mocked(getModelVersion).mockResolvedValue({
      modelVersionId: 'mv-9', modelId: 'mdl-9', productId: 'p-1', version: 1, status: 'PUBLISHED',
      fieldsSummary: '', actionsSummary: '', rowVersion: 1,
      snapshot: { fields: { rights: { channelLimit: { type: 'INTEGER', required: true } }, facts: {} }, actions: {} }
    } as never);
    vi.mocked(createPlan).mockResolvedValue(plans[0]!);
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    await flushPromises();
    // 选已发布模型（FormSelect 交互：点开关再点选项）
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await flushPromises();
    expect(wrapper.text()).toContain('权益 channelLimit');
    await wrapper.find('.license-plan-editor').trigger('submit');
    await flushPromises();
    expect(vi.mocked(createPlan)).toHaveBeenCalledWith('p-1', 'mv-9', { channelLimit: 0 });
  });

  it('模型候选只列已发布版本', async () => {
    vi.mocked(listModels).mockResolvedValue(pageOf([
      { modelVersionId: 'mv-draft', modelId: 'mdl-x', productId: 'p-1', version: 1, status: 'DRAFT', fieldsSummary: '', actionsSummary: '', rowVersion: 1 },
      { modelVersionId: 'mv-9', modelId: 'mdl-9', productId: 'p-1', version: 2, status: 'PUBLISHED', fieldsSummary: '', actionsSummary: '', rowVersion: 1 }
    ]) as never);
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    await flushPromises();
    await wrapper.find('button[aria-label="已发布模型版本"]').trigger('click');
    const choices = wrapper.findAll('.form-select-option').map(option => option.text());
    expect(choices.some(text => text.includes('mv-9'))).toBe(true);
    expect(choices.some(text => text.includes('mv-draft'))).toBe(false);
  });

  it('通过真实权益控件创建四类型预填，集合成员不按逗号或换行拆分', async () => {
    vi.mocked(getModelVersion).mockResolvedValue(modelDetail(mixedDefinitions));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await flushPromises();

    await wrapper.find('[data-right-field="limit"] input[type="text"]').setValue('25');
    await chooseOption(wrapper, '权益 enabled', '是');
    await wrapper.find('[data-right-field="title"] textarea').setValue('  标准版🙂  ');
    const regionField = wrapper.find('[data-right-field="regions"]');
    await regionField.find('button.button-secondary').trigger('click');
    await regionField.find('textarea').setValue('区域甲,区域乙\n🙂');
    await regionField.find('button.button-secondary').trigger('click');
    await submitEditor(wrapper);

    expect(createPlan).toHaveBeenCalledWith('p-1', 'mv-9', {
      limit: 25, enabled: true, title: '  标准版🙂  ', regions: ['区域甲,区域乙\n🙂', '']
    });
    expect(wrapper.find('.license-plan-editor').exists()).toBe(false);
    expect(wrapper.text()).toContain('方案已创建');
  });

  it('草稿四类型回读保留 false 和空文本，保存使用详情而非列表的版本', async () => {
    const values: RightsValues = { limit: 0, enabled: false, title: '', regions: ['a,b', '第一行\n第二行🙂', ''] };
    vi.mocked(getModelVersion).mockResolvedValue(modelDetail(mixedDefinitions));
    vi.mocked(getPlanVersion).mockResolvedValue({ ...plans[0]!, rowVersion: 9, prefillRights: values });
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openDraftEdit(wrapper);

    expect(getPlanVersion).toHaveBeenCalledWith('pv-1');
    expect(getModelVersion).toHaveBeenCalledWith('mv-9');
    expect((wrapper.find('[data-right-field="limit"] input[type="text"]').element as HTMLInputElement).value).toBe('0');
    expect(wrapper.find('button[aria-label="权益 enabled"]').text()).toContain('否');
    expect((wrapper.find('[data-right-field="title"] textarea').element as HTMLTextAreaElement).value).toBe('');
    expect(wrapper.findAll('[data-right-field="regions"] textarea').map(item => (item.element as HTMLTextAreaElement).value))
      .toEqual(['a,b', '第一行\n第二行🙂', '']);
    await submitEditor(wrapper);

    expect(patchPlanPrefill).toHaveBeenCalledWith('pv-1', values, 9);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('部分预填可看到未设置的模型字段，保存时保持缺省与空集合', async () => {
    vi.mocked(getModelVersion).mockResolvedValue(modelDetail(mixedDefinitions));
    vi.mocked(getPlanVersion).mockResolvedValue({ ...plans[0]!, rowVersion: 7, prefillRights: { enabled: false, regions: [] } });
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openDraftEdit(wrapper);

    expect(wrapper.findAll('[data-right-field]')).toHaveLength(4);
    expect((wrapper.find('[data-right-field="limit"] input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
    expect((wrapper.find('[data-right-field="title"] input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
    await submitEditor(wrapper);
    expect(patchPlanPrefill).toHaveBeenCalledWith('pv-1', { enabled: false, regions: [] }, 7);
  });

  it.each(['1.5', '', 'Infinity', '101'])('整数输入 %j 不创建、不截断，错误后保留可修改输入', async raw => {
    vi.mocked(getModelVersion).mockResolvedValue(modelDetail({ limit: { type: 'INTEGER', minimum: 0, maximum: 100 } }));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await flushPromises();
    const input = wrapper.find('[data-right-field="limit"] input[type="text"]');
    await input.setValue(raw);
    await submitEditor(wrapper);

    expect(createPlan).not.toHaveBeenCalled();
    expect(wrapper.find('.license-plan-editor [role="alert"]').text()).toContain('limit');
    expect((input.element as HTMLInputElement).value).toBe(raw);
    await input.setValue('20');
    await submitEditor(wrapper);
    expect(createPlan).toHaveBeenCalledWith('p-1', 'mv-9', { limit: 20 });
  });

  it('模型详情读取失败显示错误且禁提交，强制 submit 也不创建空预填', async () => {
    vi.mocked(getModelVersion).mockRejectedValueOnce(new Error('模型详情读取失败'));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await flushPromises();

    expect(wrapper.find('.license-plan-editor [role="alert"]').text()).toContain('模型详情读取失败');
    expect(wrapper.find('.license-plan-editor button[type="submit"]').attributes('disabled')).toBeDefined();
    await submitEditor(wrapper);
    expect(createPlan).not.toHaveBeenCalled();
    expect(wrapper.find('.license-plan-editor').exists()).toBe(true);
  });

  it('草稿关联模型读取失败不能用空预填覆盖已存数据', async () => {
    vi.mocked(getModelVersion).mockRejectedValueOnce(new Error('关联模型不可读取'));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openDraftEdit(wrapper);

    expect(wrapper.find('.license-plan-editor [role="alert"]').text()).toContain('关联模型不可读取');
    expect(wrapper.find('.license-plan-editor button[type="submit"]').attributes('disabled')).toBeDefined();
    await submitEditor(wrapper);
    expect(patchPlanPrefill).not.toHaveBeenCalled();
  });

  it('模型没有权益声明时明确允许创建空预填方案', async () => {
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await flushPromises();
    expect(wrapper.text()).toContain('所选模型未声明权益字段');
    expect(wrapper.find('.license-plan-editor button[type="submit"]').attributes('disabled')).toBeUndefined();
    await submitEditor(wrapper);
    expect(createPlan).toHaveBeenCalledWith('p-1', 'mv-9', {});
  });

  it('列表产品筛选可见且与新建表单产品独立，提交后仍使用原列表筛选', async () => {
    vi.mocked(listProducts).mockResolvedValue(pageOf([
      { productId: 'p-1', code: 'one', displayName: '产品一' },
      { productId: 'p-2', code: 'two', displayName: '产品二' }
    ]) as never);
    vi.mocked(listModels).mockImplementation(async productId => pageOf([modelDetail({}, productId === 'p-2' ? 'mv-2' : 'mv-9', productId)]));
    vi.mocked(getModelVersion).mockImplementation(async modelVersionId => modelDetail({}, modelVersionId, modelVersionId === 'mv-2' ? 'p-2' : 'p-1'));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await flushPromises();
    await chooseOption(wrapper, '产品筛选', '产品一');
    await flushPromises();
    expect(listPlans).toHaveBeenLastCalledWith('p-1');
    const listCallsBeforeEditor = vi.mocked(listPlans).mock.calls.length;

    await openCreate(wrapper);
    await chooseOption(wrapper, '产品', '产品二');
    await flushPromises();
    expect(listPlans).toHaveBeenCalledTimes(listCallsBeforeEditor);
    expect(wrapper.find('button[aria-label="产品筛选"]').text()).toContain('产品一');
    expect(wrapper.find('.license-plan-editor button[aria-label="产品"]').text()).toContain('产品二');
    await chooseOption(wrapper, '已发布模型版本', 'mv-2');
    await flushPromises();
    await submitEditor(wrapper);

    expect(createPlan).toHaveBeenCalledWith('p-2', 'mv-2', {});
    expect(listPlans).toHaveBeenLastCalledWith('p-1');
  });

  it('产品切换清空旧模型及权益，不能拿旧产品模型提交', async () => {
    vi.mocked(listProducts).mockResolvedValue(pageOf([
      { productId: 'p-1', code: 'one', displayName: '产品一' },
      { productId: 'p-2', code: 'two', displayName: '产品二' }
    ]) as never);
    vi.mocked(getModelVersion).mockResolvedValue(modelDetail({ limit: { type: 'INTEGER', minimum: 0, maximum: 100 } }));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await flushPromises();
    await wrapper.find('[data-right-field="limit"] input[type="text"]').setValue('60');
    await chooseOption(wrapper, '产品', '产品二');
    await flushPromises();

    expect(wrapper.find('[data-right-field="limit"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="已发布模型版本"]').text()).toContain('选择模型版本');
    expect(wrapper.find('.license-plan-editor button[type="submit"]').attributes('disabled')).toBeDefined();
    await submitEditor(wrapper);
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('乱序模型详情结果不得覆盖后来选中的模型及用户输入', async () => {
    const earlier = deferred<ModelVersionDetail>();
    vi.mocked(listModels).mockResolvedValue(pageOf([modelDetail({}, 'mv-a'), modelDetail({}, 'mv-b')]));
    vi.mocked(getModelVersion).mockImplementation(modelVersionId => modelVersionId === 'mv-a'
      ? earlier.promise : Promise.resolve(modelDetail({ current: { type: 'STRING' } }, 'mv-b')));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-a');
    await chooseOption(wrapper, '已发布模型版本', 'mv-b');
    await flushPromises();
    await wrapper.find('[data-right-field="current"] textarea').setValue('保留当前编辑');
    earlier.resolve(modelDetail({ outdated: { type: 'INTEGER', minimum: 0, maximum: 100 } }, 'mv-a'));
    await flushPromises();

    expect(wrapper.find('[data-right-field="outdated"]').exists()).toBe(false);
    expect((wrapper.find('[data-right-field="current"] textarea').element as HTMLTextAreaElement).value).toBe('保留当前编辑');
    await submitEditor(wrapper);
    expect(createPlan).toHaveBeenCalledWith('p-1', 'mv-b', { current: '保留当前编辑' });
  });

  it('旧模型失败不会覆盖后来成功的模型状态或禁用提交', async () => {
    const earlier = deferred<ModelVersionDetail>();
    vi.mocked(listModels).mockResolvedValue(pageOf([modelDetail({}, 'mv-a'), modelDetail({}, 'mv-b')]));
    vi.mocked(getModelVersion).mockImplementation(modelVersionId => modelVersionId === 'mv-a'
      ? earlier.promise : Promise.resolve(modelDetail({ current: { type: 'BOOLEAN' } }, 'mv-b')));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-a');
    await chooseOption(wrapper, '已发布模型版本', 'mv-b');
    await flushPromises();
    earlier.reject(new Error('旧模型失败'));
    await flushPromises();

    expect(wrapper.find('.license-plan-editor [role="alert"]').exists()).toBe(false);
    expect(wrapper.find('.license-plan-editor button[type="submit"]').attributes('disabled')).toBeUndefined();
    await submitEditor(wrapper);
    expect(createPlan).toHaveBeenCalledWith('p-1', 'mv-b', { current: false });
  });

  it('关闭后到达的模型详情不能回填重新打开的新建表单', async () => {
    const earlier = deferred<ModelVersionDetail>();
    vi.mocked(getModelVersion).mockReturnValueOnce(earlier.promise);
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '已发布模型版本', 'mv-9');
    await wrapper.find('.license-plan-editor button.button-secondary').trigger('click');
    await flushPromises();
    expect(wrapper.find('.license-plan-editor').exists()).toBe(false);
    await openCreate(wrapper);
    earlier.resolve(modelDetail({ outdated: { type: 'STRING' } }));
    await flushPromises();

    expect(wrapper.find('[data-right-field="outdated"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="已发布模型版本"]').text()).toContain('选择模型版本');
    expect(wrapper.find('.license-plan-editor button[type="submit"]').attributes('disabled')).toBeDefined();
  });

  it('关闭草稿编辑后到达的方案详情不能触发模型读取或污染新表单', async () => {
    const earlier = deferred<PlanVersionDetail>();
    vi.mocked(getPlanVersion).mockReturnValueOnce(earlier.promise);
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openDraftEdit(wrapper);
    await wrapper.find('.license-plan-editor button.button-secondary').trigger('click');
    await flushPromises();
    await openCreate(wrapper);
    earlier.resolve({ ...plans[0]!, prefillRights: { enabled: false }, rowVersion: 8 });
    await flushPromises();

    expect(getModelVersion).not.toHaveBeenCalled();
    expect(wrapper.findAll('[data-right-field]')).toHaveLength(0);
    expect(wrapper.find('.license-plan-editor button[type="submit"]').text()).toBe('创建方案');
  });

  it('较早的产品模型候选不能覆盖较晚产品的候选', async () => {
    const earlier = deferred<LicensePage<ModelVersionView>>();
    vi.mocked(listProducts).mockResolvedValue(pageOf([
      { productId: 'p-1', code: 'one', displayName: '产品一' },
      { productId: 'p-2', code: 'two', displayName: '产品二' }
    ]) as never);
    vi.mocked(listModels).mockImplementation(productId => productId === 'p-1'
      ? earlier.promise : Promise.resolve(pageOf([modelDetail({}, 'mv-new', 'p-2')])));
    const wrapper = mount(PlanSection, { props: { section: 'plans' } });
    await openCreate(wrapper);
    await chooseOption(wrapper, '产品', '产品二');
    await flushPromises();
    earlier.resolve(pageOf([modelDetail({}, 'mv-old', 'p-1')]));
    await flushPromises();
    await wrapper.find('button[aria-label="已发布模型版本"]').trigger('click');
    const options = wrapper.findAll('.form-select-option').map(option => option.text());
    expect(options.some(option => option.includes('mv-new'))).toBe(true);
    expect(options.some(option => option.includes('mv-old'))).toBe(false);
  });
});
