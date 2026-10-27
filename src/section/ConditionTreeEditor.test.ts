import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ConditionTreeEditor from './ConditionTreeEditor.vue';
import ConditionOperandEditor from './ConditionOperandEditor.vue';
import type { TreeNode } from '../api/domain';

const fields = ['rights.channelLimit', 'facts.channelCountAfter'];

function mountTree(modelValue: TreeNode) {
  return mount(ConditionTreeEditor, {
    props: { modelValue, fields, canRemove: false },
    global: { stubs: { FormSelect: true, ConditionOperandEditor: true } }
  });
}

describe('ConditionTreeEditor', () => {
  it('渲染组合节点并递归子节点，子节点可删除且根不可删', async () => {
    const wrapper = mountTree({
      all: [
        { compare: { operator: 'LTE', left: { ref: 'facts.channelCountAfter' }, right: { ref: 'rights.channelLimit' } } },
        { bool: true }
      ]
    });
    expect(wrapper.findAll('.license-tree-node')).toHaveLength(3); // 根+两子
    const removeButtons = wrapper.findAll('button[aria-label="删除此节点"]');
    expect(removeButtons).toHaveLength(2);
    await removeButtons[0]!.trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toEqual({ all: [{ bool: true }] });
  });

  it('组合节点添加子条件给默认叶子（两引用的 LTE 比较形态）', async () => {
    const wrapper = mountTree({ all: [{ bool: true }] });
    await wrapper.find('button.license-tree-add').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toEqual({
      all: [
        { bool: true },
        { compare: { operator: 'LTE', left: { ref: 'facts.channelCountAfter' }, right: { ref: 'rights.channelLimit' } } }
      ]
    });
  });

  it('NOT 子节点删除时退化为布尔常量（树至少保留根）', async () => {
    const wrapper = mountTree({ not: { bool: false } });
    await wrapper.find('button[aria-label="删除此节点"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toEqual({ bool: true });
  });

  it('比较节点渲染操作符选择与两侧操作数编辑器', () => {
    const wrapper = mountTree({
      compare: { operator: 'EQ', left: { ref: 'rights.channelLimit' }, right: { literal: 100 } }
    });
    expect(wrapper.find('.license-tree-compare').exists()).toBe(true);
    expect(wrapper.findAllComponents(ConditionOperandEditor)).toHaveLength(2);
  });

  it('字段声明为空时默认叶子退化为布尔常量', async () => {
    const wrapper = mount(ConditionTreeEditor, {
      props: { modelValue: { all: [{ bool: true }] }, fields: [], canRemove: false },
      global: { stubs: { FormSelect: true, ConditionOperandEditor: true } }
    });
    await wrapper.find('button.license-tree-add').trigger('click');
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toEqual({ all: [{ bool: true }, { bool: true }] });
  });
});

describe('ConditionOperandEditor', () => {
  it('引用形态渲染字段下拉；文本集合字面量渲染逗号输入', () => {
    const refSide = mount(ConditionOperandEditor, {
      props: { modelValue: { ref: 'rights.channelLimit' }, fields, label: '左操作数' }
    });
    expect(refSide.findAll('.form-select-toggle').length).toBeGreaterThan(0);

    const setSide = mount(ConditionOperandEditor, {
      props: { modelValue: { literal: ['beta', 'ga'] }, fields, label: '集合' }
    });
    const area = setSide.find('textarea');
    expect(area.exists()).toBe(true);
    expect((area.element as HTMLTextAreaElement).value).toBe('beta, ga');
  });

  it('文本集合输入按逗号拆分回写', async () => {
    const wrapper = mount(ConditionOperandEditor, {
      props: { modelValue: { literal: ['x'] }, fields, label: '集合' }
    });
    const area = wrapper.find('textarea');
    await area.setValue('gold, platinum, ');
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toEqual({ literal: ['gold', 'platinum'] });
  });
});
