<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import type { RightsFieldInput } from '../ui/rightsFields';

withDefaults(defineProps<{ fields: RightsFieldInput[]; disabled?: boolean; label?: string }>(), { label: '权益' });
const typeLabels = { INTEGER: '整数', BOOLEAN: '布尔', STRING: '文本', STRING_SET: '文本集合' };
</script>

<template>
  <div class="license-rights-fields">
    <fieldset v-for="field in fields" :key="field.name" :data-right-field="field.name" class="license-right-field">
      <legend>{{ label }} {{ field.name }} · {{ typeLabels[field.definition.type] }}</legend>
      <label class="check-option"><input v-model="field.included" type="checkbox" :disabled="disabled" />设置此权益<span v-if="field.definition.required">（模型必填）</span></label>
      <template v-if="field.included">
        <input v-if="field.definition.type === 'INTEGER'" v-model="field.scalar" type="text" inputmode="numeric" :aria-label="`${label} ${field.name}`" :disabled="disabled" />
        <FormSelect v-else-if="field.definition.type === 'BOOLEAN'" v-model="field.scalar" :options="[{ value: 'false', label: '否' }, { value: 'true', label: '是' }]" :aria-label="`${label} ${field.name}`" :disabled="disabled" />
        <textarea v-else-if="field.definition.type === 'STRING'" v-model="field.scalar" :aria-label="`${label} ${field.name}`" :disabled="disabled" rows="2" />
        <div v-else class="license-right-items">
          <div v-for="(_, index) in field.items" :key="index" class="license-right-item">
            <textarea v-model="field.items[index]" :aria-label="`${label} ${field.name} 第 ${index + 1} 项`" :disabled="disabled" rows="1" />
            <button class="icon-button" type="button" :aria-label="`删除 ${field.name} 第 ${index + 1} 项`" :disabled="disabled" @click="field.items.splice(index, 1)"><X :size="16" /></button>
          </div>
          <button class="button-secondary" type="button" :disabled="disabled" @click="field.items.push('')"><Plus :size="15" />添加文本项</button>
          <p v-if="!field.items.length" class="license-hint">当前为空集合；每一项可包含逗号或换行。</p>
        </div>
        <p v-if="field.definition.minimum !== undefined || field.definition.maximum !== undefined" class="license-hint">整数范围：{{ field.definition.minimum ?? '不限' }} ～ {{ field.definition.maximum ?? '不限' }}</p>
        <p v-if="field.definition.type === 'STRING' && field.definition.maxLength !== undefined" class="license-hint">最多 {{ field.definition.maxLength }} 个字符。</p>
        <p v-if="field.definition.type === 'STRING_SET' && field.definition.maxItems !== undefined" class="license-hint">最多 {{ field.definition.maxItems }} 项。</p>
        <p v-if="field.definition.type === 'STRING' && field.definition.enumValues?.length" class="license-hint">允许的文本值：{{ field.definition.enumValues.join('、') }}</p>
      </template>
    </fieldset>
  </div>
</template>

<style scoped>
.license-rights-fields, .license-right-field, .license-right-items { display: grid; gap: 10px; min-width: 0; }
.license-right-field { border: 1px solid var(--iam-color-border); border-radius: var(--iam-radius-control); margin: 0; padding: 12px; }
.license-right-field legend { color: var(--iam-color-text-secondary); font-size: 13px; padding: 0 4px; }
.license-right-field .check-option { display: flex; align-items: center; gap: 8px; }
.license-right-field .check-option input { min-height: auto; }
.license-right-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
.license-right-items > button { justify-self: start; }
</style>
