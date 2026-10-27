import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import ModelSection from './ModelSection.vue';
import { canApi } from '../auth/permissions';
import type { LicensePage } from '../api/http';
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true) }));

vi.mock('../api/domain', async () => {
  const actual = await vi.importActual<typeof import('../api/domain')>('../api/domain');
  return {
    ...actual,
    listModels: vi.fn(),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
    createModel: vi.fn(),
    getModelVersion: vi.fn(),
    patchDraftSnapshot: vi.fn(),
    publishModelVersion: vi.fn(),
    retireModelVersion: vi.fn(),
    evaluateModelAction: vi.fn()
  };
});

import {
  createModel, evaluateModelAction, getModelVersion, getProduct, listModels, listProducts, publishModelVersion
} from '../api/domain';

const versions = [
  { modelVersionId: 'mv-1', modelId: 'mdl-1', productId: 'p-1', version: 1, status: 'DRAFT', fieldsSummary: '2 个字段', actionsSummary: '1 个动作', rowVersion: 1 },
  { modelVersionId: 'mv-2', modelId: 'mdl-1', productId: 'p-1', version: 2, status: 'PUBLISHED', fieldsSummary: '2 个字段', actionsSummary: '1 个动作', rowVersion: 3 }
];

function pageOf<T>(data: T[]): LicensePage<T> {
  return { data, total: data.length, page: 1, size: 20, totalPages: data.length ? 1 : 0 };
}

describe('ModelSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canApi).mockReturnValue(true);
    vi.mocked(listModels).mockResolvedValue(pageOf(versions));
    vi.mocked(listProducts).mockResolvedValue(pageOf([
      { productId: 'p-1', declaredActions: ['channel.create'] }
    ]) as never);
    vi.mocked(getProduct).mockResolvedValue({ productId: 'p-1', declaredActions: ['channel.create'] } as never);
    vi.mocked(createModel).mockResolvedValue(versions[0]!);
  });

  it('模型版本列表渲染状态徽标与摘要', async () => {
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    expect(wrapper.text()).toContain('mv-1');
    expect(wrapper.text()).toContain('草稿');
    expect(wrapper.text()).toContain('已发布');
    expect(wrapper.text()).toContain('2 个字段');
  });

  it('草稿行提供编辑与发布，已发布行提供退役', async () => {
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    const actions = wrapper.findAll('tbody button').map(button => button.text());
    expect(actions).toContain('发布');
    expect(actions).toContain('编辑草稿');
    expect(actions).toContain('退役');
  });

  it('发布走行版本围栏并刷新列表', async () => {
    vi.mocked(publishModelVersion).mockResolvedValue(versions[1]!);
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    const publishButton = wrapper.findAll('tbody button').find(button => button.text() === '发布')!;
    await publishButton.trigger('click');
    await flushPromises();
    expect(vi.mocked(publishModelVersion)).toHaveBeenCalledWith('mv-1', 1);
    expect(wrapper.text()).toContain('模型已发布');
  });

  it('试算回读快照按声明预填并展示结论', async () => {
    vi.mocked(getModelVersion).mockResolvedValue({
      ...versions[0]!,
      snapshot: {
        fields: {
          rights: { channelLimit: { type: 'INTEGER', required: true } },
          facts: { channelCountAfter: { type: 'INTEGER', required: true, source: 'PRODUCT' } }
        },
        actions: { 'channel.create': { all: [{ bool: true }] } }
      }
    } as never);
    vi.mocked(evaluateModelAction).mockResolvedValue({ action: 'channel.create', declared: true });
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    const evalButton = wrapper.findAll('tbody button').find(button => button.text() === '试算')!;
    await evalButton.trigger('click');
    await flushPromises();
    const dialog = wrapper.find('.license-model-evaluation');
    expect(dialog.exists()).toBe(true);
    await dialog.trigger('submit');
    await flushPromises();
    expect(vi.mocked(evaluateModelAction)).toHaveBeenCalled();
    expect(wrapper.text()).toContain('动作已声明');
  });

  it('新建模型提交快照（字段声明+动作树）', async () => {
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    await wrapper.find('header button.button-primary').trigger('click');
    await flushPromises();
    // 默认预置一个权益字段+一个事实字段；从产品声明动作添加条件树
    const addAction = wrapper.findAll('button').find(button => button.text().includes('从产品声明动作添加'))!;
    await addAction.trigger('click');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(vi.mocked(createModel)).toHaveBeenCalledWith('p-1', expect.objectContaining({
      fields: {
        rights: expect.objectContaining({ rightField1: expect.objectContaining({ type: 'INTEGER' }) }),
        facts: expect.objectContaining({ factField1: expect.objectContaining({ type: 'INTEGER', source: 'PRODUCT' }) })
      },
      actions: expect.objectContaining({ 'channel.create': expect.anything() }),
      subjectPolicy: expect.objectContaining({ allowedKinds: ['DEPLOYMENT'], allowedEligibilityKinds: ['ALLOCATED_DEPLOYMENTS'] }),
      connectivityPolicy: expect.objectContaining({ allowedModes: ['ONLINE'] }),
      requiredCapabilities: expect.arrayContaining(['license-condition/1', 'clock-state/1', 'subject-binding/1'])
    }));
  });

  it('试算权益与事实四种类型按真实值提交', async () => {
    const definitions = {
      count: { type: 'INTEGER' as const, minimum: 1, maximum: 9 }, enabled: { type: 'BOOLEAN' as const },
      text: { type: 'STRING' as const }, areas: { type: 'STRING_SET' as const }
    };
    vi.mocked(getModelVersion).mockResolvedValue({ ...versions[0]!, snapshot: {
      fields: { rights: definitions, facts: definitions }, actions: { 'channel.create': { bool: true } }
    } });
    vi.mocked(evaluateModelAction).mockResolvedValue({ action: 'channel.create', declared: false });
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    await wrapper.findAll('tbody button').find(button => button.text() === '试算')!.trigger('click');
    await flushPromises();
    const form = wrapper.find('.license-model-evaluation');
    await form.find('[aria-label="权益 count"]').setValue('3');
    await form.find('[aria-label="事实 count"]').setValue('4');
    await form.find('[aria-label="权益 text"]').setValue('  原文  ');
    await form.find('[aria-label="事实 text"]').setValue('事实文本');
    const setFields = form.findAll('[data-right-field="areas"]');
    await setFields[0]!.find('button').trigger('click');
    await setFields[0]!.find('textarea').setValue('a,b\n全文');
    await form.trigger('submit');
    await flushPromises();
    expect(evaluateModelAction).toHaveBeenCalledWith('mv-1', 'channel.create',
      { count: 3, enabled: false, text: '  原文  ', areas: ['a,b\n全文'] },
      { count: 4, enabled: false, text: '事实文本', areas: [] });
    expect(form.text()).toContain('试算不通过');
    expect(form.find('[role="status"]').classes()).not.toContain('success');
  });

  it('试算详情失败阻止接口请求，错误在抽屉内可见', async () => {
    vi.mocked(getModelVersion).mockRejectedValue(new Error('模型读取失败'));
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    const evaluate = wrapper.findAll('tbody button').find(button => button.text() === '试算')!;
    await evaluate.trigger('click');
    await flushPromises();
    const form = wrapper.find('.license-model-evaluation');
    expect(form.text()).toContain('模型读取失败');
    expect(form.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    await form.trigger('submit');
    expect(evaluateModelAction).not.toHaveBeenCalled();
  });

  it('试算保留非法整数输入，修正后再按真实整数发请求', async () => {
    vi.mocked(getModelVersion).mockResolvedValue({ ...versions[0]!, snapshot: {
      fields: { rights: { count: { type: 'INTEGER', minimum: 0, maximum: 9 } }, facts: {} }, actions: { 'channel.create': { bool: true } }
    } });
    vi.mocked(evaluateModelAction).mockResolvedValue({ action: 'channel.create', declared: true });
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    await wrapper.findAll('tbody button').find(button => button.text() === '试算')!.trigger('click');
    await flushPromises();
    const form = wrapper.find('.license-model-evaluation');
    await form.find('[aria-label="权益 count"]').setValue('2.5');
    await form.trigger('submit');
    await flushPromises();
    expect(evaluateModelAction).not.toHaveBeenCalled();
    expect(form.text()).toContain('必须是有效整数');
    expect((form.find('[aria-label="权益 count"]').element as HTMLInputElement).value).toBe('2.5');
    await form.find('[aria-label="权益 count"]').setValue('2');
    await form.trigger('submit');
    await flushPromises();
    expect(evaluateModelAction).toHaveBeenCalledWith('mv-1', 'channel.create', { count: 2 }, {});
  });

  it('模型只读用户保留试算，隐藏新建编辑发布与退役', async () => {
    vi.mocked(canApi).mockImplementation(code => code === 'license.model.read');
    const wrapper = mount(ModelSection, { props: { section: 'models', productId: 'p-1' } });
    await flushPromises();
    const actions = wrapper.findAll('button').map(button => button.text());
    expect(actions).toContain('试算');
    for (const action of ['新建模型', '编辑草稿', '发布', '退役']) expect(actions).not.toContain(action);
  });
});
