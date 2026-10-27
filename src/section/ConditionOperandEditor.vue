<script setup lang="ts">
import { computed } from 'vue';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import type { OperandNode } from '../api/domain';

/**
 * 条件操作数编辑器：字段引用（下拉选已声明字段）或字面量（整数/布尔/文本/文本集合）。
 * wire 恰一键：{ref:"ns.field"} 或 {literal:...}；切换形态时重置为该形态合法初值。
 */
const props = defineProps<{
  modelValue: OperandNode;
  fields: string[];
  label: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: OperandNode] }>();

const isRef = computed(() => 'ref' in props.modelValue);

const refOptions = computed(() => props.fields.map(field => ({ value: field, label: field })));

const literalValue = computed<number | boolean | string | string[]>(() =>
  (props.modelValue as { literal: number | boolean | string | string[] }).literal);
const refValue = computed(() => (props.modelValue as { ref: string }).ref);

const literalKind = computed<'INTEGER' | 'BOOLEAN' | 'STRING' | 'STRING_SET'>(() => {
  const value = literalValue.value;
  if (typeof value === 'number') return 'INTEGER';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (Array.isArray(value)) return 'STRING_SET';
  return 'STRING';
});

const literalKindOptions = [
  { value: 'INTEGER', label: '整数' },
  { value: 'BOOLEAN', label: '布尔' },
  { value: 'STRING', label: '文本' },
  { value: 'STRING_SET', label: '文本集合' }
];

const kindOptions = [
  { value: 'ref', label: '字段引用' },
  { value: 'literal', label: '字面量' }
];

function switchKind(kind: string | number) {
  if (kind === 'ref') {
    emit('update:modelValue', { ref: props.fields[0] ?? 'rights.unset' });
  } else {
    emit('update:modelValue', { literal: 0 });
  }
}

function switchLiteralKind(kind: string | number) {
  if (kind === 'INTEGER') emit('update:modelValue', { literal: 0 });
  else if (kind === 'BOOLEAN') emit('update:modelValue', { literal: false });
  else if (kind === 'STRING_SET') emit('update:modelValue', { literal: [] });
  else emit('update:modelValue', { literal: '' });
}

function setRef(value: string | number) {
  emit('update:modelValue', { ref: String(value) });
}

function setNumberLiteral(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim();
  const parsed = raw === '' ? 0 : Math.trunc(Number(raw));
  emit('update:modelValue', { literal: Number.isFinite(parsed) ? parsed : 0 });
}

function setBooleanLiteral(value: string | number) {
  emit('update:modelValue', { literal: value === 'true' });
}

function setStringLiteral(event: Event) {
  emit('update:modelValue', { literal: (event.target as HTMLInputElement).value });
}

function setSetLiteral(event: Event) {
  const items = (event.target as HTMLTextAreaElement).value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  emit('update:modelValue', { literal: items });
}
</script>

<template>
  <div class="license-operand">
    <span class="license-operand-label">{{ label }}</span>
    <FormSelect
      :model-value="isRef ? 'ref' : 'literal'"
      :options="kindOptions"
      :aria-label="`${label}形态`"
      class="license-operand-kind"
      @update:model-value="switchKind"
    />
    <FormSelect
      v-if="isRef"
      :model-value="refValue"
      :options="refOptions"
      :aria-label="`${label}引用字段`"
      class="license-operand-value"
      @update:model-value="setRef"
    />
    <template v-else>
      <FormSelect
        :model-value="literalKind"
        :options="literalKindOptions"
        :aria-label="`${label}字面量类型`"
        class="license-operand-kind"
        @update:model-value="switchLiteralKind"
      />
      <input
        v-if="literalKind === 'INTEGER'"
        class="license-operand-value"
        type="number"
        :value="literalValue"
        :aria-label="`${label}整数值`"
        @input="setNumberLiteral"
      >
      <FormSelect
        v-else-if="literalKind === 'BOOLEAN'"
        :model-value="String(literalValue)"
        :options="[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]"
        :aria-label="`${label}布尔值`"
        class="license-operand-value"
        @update:model-value="setBooleanLiteral"
      />
      <input
        v-else-if="literalKind === 'STRING'"
        class="license-operand-value"
        :value="literalValue"
        :aria-label="`${label}文本值`"
        @input="setStringLiteral"
      >
      <textarea
        v-else
        class="license-operand-value"
        rows="2"
        placeholder="逗号分隔集合成员"
        :aria-label="`${label}文本集合`"
        :value="(literalValue as string[]).join(', ')"
        @input="setSetLiteral"
      />
    </template>
  </div>
</template>
