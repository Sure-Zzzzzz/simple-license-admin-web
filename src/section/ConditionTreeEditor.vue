<script setup lang="ts">
import { computed } from 'vue';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import ConditionOperandEditor from './ConditionOperandEditor.vue';
import type { CompareOp, OperandNode, TreeNode } from '../api/domain';

/**
 * 条件树编辑器（递归）：节点恰一形态键（all/any/not/bool/compare/member），与 core
 * RuleModelWire 的 wire 契约逐键对齐。切换节点形态时给该形态合法初值；组合节点
 * 内增删子节点；canRemove=false 的根节点不可删（树至少有根）。
 */
const props = defineProps<{
  modelValue: TreeNode;
  fields: string[];
  canRemove?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: TreeNode]; remove: [] }>();

const nodeKind = computed<'all' | 'any' | 'not' | 'bool' | 'compare' | 'member'>(() => {
  const node = props.modelValue as Record<string, unknown>;
  for (const key of ['all', 'any', 'not', 'bool', 'compare', 'member'] as const) {
    if (key in node) return key;
  }
  return 'bool';
});

const kindOptions = [
  { value: 'all', label: '全部满足（AND）' },
  { value: 'any', label: '任一满足（OR）' },
  { value: 'not', label: '取反（NOT）' },
  { value: 'bool', label: '布尔常量' },
  { value: 'compare', label: '比较' },
  { value: 'member', label: '集合成员' }
];

const operatorOptions: Array<{ value: CompareOp; label: string }> = [
  { value: 'EQ', label: '等于（EQ）' },
  { value: 'NE', label: '不等于（NE）' },
  { value: 'LT', label: '小于（LT）' },
  { value: 'LTE', label: '不大于（LTE）' },
  { value: 'GT', label: '大于（GT）' },
  { value: 'GTE', label: '不小于（GTE）' }
];

const boolText = computed(() => String((props.modelValue as { bool: boolean }).bool));

// 模板不能写类型断言；形态片段经 computed 取强类型值
const compareNode = computed(() =>
  (props.modelValue as { compare: { operator: CompareOp; left: OperandNode; right: OperandNode } }).compare);
const memberNode = computed(() =>
  (props.modelValue as { member: { value: OperandNode; set: OperandNode } }).member);
const notChild = computed(() => (props.modelValue as { not: TreeNode }).not);

/** 默认叶子：两个引用的 LTE 比较（指标上限形态）；引用字段缺失时退化为布尔常量。 */
function defaultLeaf(): TreeNode {
  if (props.fields.length >= 2) {
    return {
      compare: {
        operator: 'LTE',
        left: { ref: props.fields[props.fields.length - 1]! },
        right: { ref: props.fields[0]! }
      }
    };
  }
  return { bool: true };
}

function switchKind(kind: string | number) {
  const next = String(kind);
  if (next === 'all' || next === 'any') {
    emit('update:modelValue', { [next]: [defaultLeaf()] } as TreeNode);
  } else if (next === 'not') {
    emit('update:modelValue', { not: defaultLeaf() });
  } else if (next === 'bool') {
    emit('update:modelValue', { bool: true });
  } else if (next === 'compare') {
    emit('update:modelValue', {
      compare: { operator: 'LTE', left: { ref: props.fields[0] ?? 'rights.unset' }, right: { literal: 0 } }
    });
  } else {
    emit('update:modelValue', {
      member: { value: { ref: props.fields[0] ?? 'facts.unset' }, set: { literal: [] } }
    });
  }
}

function emitPartial(patch: Partial<TreeNode>) {
  emit('update:modelValue', { ...props.modelValue, ...patch } as TreeNode);
}

function childrenOf(node: TreeNode): TreeNode[] {
  const value = node as { all?: TreeNode[]; any?: TreeNode[] };
  return value.all ?? value.any ?? [];
}

function replaceChild(index: number, child: TreeNode) {
  const list = childrenOf(props.modelValue).slice();
  list.splice(index, 1, child);
  emitPartial(nodeKind.value === 'all' ? { all: list } : { any: list });
}

function addChild() {
  const list = childrenOf(props.modelValue).slice();
  list.push(defaultLeaf());
  emitPartial(nodeKind.value === 'all' ? { all: list } : { any: list });
}

function removeChild(index: number) {
  const list = childrenOf(props.modelValue).slice();
  list.splice(index, 1);
  emitPartial(nodeKind.value === 'all' ? { all: list } : { any: list });
}

function replaceNotChild(child: TreeNode) {
  emitPartial({ not: child });
}

function setBool(value: string | number) {
  emitPartial({ bool: value === 'true' } as Partial<TreeNode>);
}

function setOperator(value: string | number) {
  const compare = (props.modelValue as { compare: { operator: CompareOp; left: OperandNode; right: OperandNode } }).compare;
  emitPartial({ compare: { ...compare, operator: value as CompareOp } });
}

function setOperand(side: 'left' | 'right', value: OperandNode) {
  const compare = (props.modelValue as { compare: { operator: CompareOp; left: OperandNode; right: OperandNode } }).compare;
  emitPartial({ compare: { ...compare, [side]: value } });
}

function setMemberOperand(side: 'value' | 'set', value: OperandNode) {
  const member = (props.modelValue as { member: { value: OperandNode; set: OperandNode } }).member;
  emitPartial({ member: { ...member, [side]: value } });
}
</script>

<template>
  <div class="license-tree-node" :data-kind="nodeKind">
    <div class="license-tree-row">
      <FormSelect
        :model-value="nodeKind"
        :options="kindOptions"
        aria-label="节点类型"
        class="license-tree-kind"
        @update:model-value="switchKind"
      />
      <button
        v-if="canRemove"
        type="button"
        class="button-secondary license-tree-remove"
        aria-label="删除此节点"
        @click="emit('remove')"
      >删除</button>
    </div>

    <!-- 布尔常量 -->
    <FormSelect
      v-if="nodeKind === 'bool'"
      :model-value="boolText"
      :options="[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]"
      aria-label="布尔值"
      class="license-tree-leaf"
      @update:model-value="setBool"
    />

    <!-- 比较 -->
    <div v-else-if="nodeKind === 'compare'" class="license-tree-compare">
      <FormSelect
        :model-value="compareNode.operator"
        :options="operatorOptions"
        aria-label="比较运算符"
        class="license-tree-leaf"
        @update:model-value="setOperator"
      />
      <ConditionOperandEditor
        :model-value="compareNode.left"
        :fields="fields"
        label="左操作数"
        @update:model-value="value => setOperand('left', value)"
      />
      <ConditionOperandEditor
        :model-value="compareNode.right"
        :fields="fields"
        label="右操作数"
        @update:model-value="value => setOperand('right', value)"
      />
    </div>

    <!-- 集合成员 -->
    <div v-else-if="nodeKind === 'member'" class="license-tree-compare">
      <ConditionOperandEditor
        :model-value="memberNode.value"
        :fields="fields"
        label="值"
        @update:model-value="value => setMemberOperand('value', value)"
      />
      <ConditionOperandEditor
        :model-value="memberNode.set"
        :fields="fields"
        label="集合"
        @update:model-value="value => setMemberOperand('set', value)"
      />
    </div>

    <!-- 组合节点：子节点递归 -->
    <div v-else class="license-tree-children">
      <template v-if="nodeKind === 'not'">
        <ConditionTreeEditor
          :model-value="notChild"
          :fields="fields"
          :can-remove="true"
          @update:model-value="replaceNotChild"
          @remove="() => emit('update:modelValue', { bool: true })"
        />
      </template>
      <template v-else>
        <div
          v-for="(child, index) in childrenOf(modelValue)"
          :key="index"
          class="license-tree-child"
        >
          <ConditionTreeEditor
            :model-value="child"
            :fields="fields"
            :can-remove="true"
            @update:model-value="value => replaceChild(index, value)"
            @remove="() => removeChild(index)"
          />
        </div>
        <button type="button" class="button-secondary license-tree-add" @click="addChild">+ 添加子条件</button>
      </template>
    </div>
  </div>
</template>
