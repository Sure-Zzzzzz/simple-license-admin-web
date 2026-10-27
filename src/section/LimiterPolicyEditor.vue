<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import type { LimiterPolicyInput, LimiterPolicyLimit } from '../api/domain';
import { LIMITER_POLICY_UNITS, createLimiterPolicy } from '../ui/limiterPolicies';

const props = withDefaults(defineProps<{ modelValue: LimiterPolicyInput[]; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ 'update:modelValue': [value: LimiterPolicyInput[]] }>();

function update(next: LimiterPolicyInput[]) { emit('update:modelValue', next); }
function addPolicy() { update([...props.modelValue, createLimiterPolicy()]); }
function removePolicy(index: number) { update(props.modelValue.filter((_, itemIndex) => itemIndex !== index)); }
function addLimit(policyIndex: number) {
  const next = props.modelValue.map(policy => ({ ...policy, limits: policy.limits.map(limit => ({ ...limit })) }));
  next[policyIndex]?.limits.push({ count: 100, window: 1, unit: 'MINUTES' });
  update(next);
}
function removeLimit(policyIndex: number, limitIndex: number) {
  const next = props.modelValue.map(policy => ({ ...policy, limits: policy.limits.filter((_, itemIndex) => itemIndex !== limitIndex) }));
  update(next);
}
function updatePolicy(policyIndex: number, patch: Partial<LimiterPolicyInput>) {
  update(props.modelValue.map((policy, itemIndex) => itemIndex === policyIndex ? { ...policy, ...patch } : policy));
}
function updateLimit(policyIndex: number, limitIndex: number, patch: Partial<LimiterPolicyLimit>) {
  update(props.modelValue.map((policy, itemIndex) => itemIndex === policyIndex
    ? { ...policy, limits: policy.limits.map((limit, currentIndex) => currentIndex === limitIndex ? { ...limit, ...patch } : limit) }
    : policy));
}
</script>

<template>
  <section class="license-limiter-editor" aria-label="客户 OpenAPI 限频授权">
    <header class="license-policy-section-header">
      <div><h3>客户 OpenAPI 限频授权</h3><p>可选。启用授权时由 License 投影到 limiter Management；namespace、客户维度和远端规则编号由服务端确认。</p></div>
      <button class="button-secondary" type="button" :disabled="disabled || modelValue.length >= 64" @click="addPolicy"><Plus :size="15" />添加策略</button>
    </header>
    <p v-if="!modelValue.length" class="license-hint">当前授权不限制客户 OpenAPI 调用频率。</p>
    <fieldset v-for="(policy, policyIndex) in modelValue" :key="policyIndex" class="license-limiter-policy">
      <legend>策略 {{ policyIndex + 1 }}</legend>
      <div class="license-limiter-policy-head">
        <label>服务编码<input :value="policy.serviceCode" maxlength="128" :disabled="disabled" @input="updatePolicy(policyIndex, { serviceCode: ($event.target as HTMLInputElement).value })" /></label>
        <label>资源编码<input :value="policy.resourceCode" maxlength="128" :disabled="disabled" @input="updatePolicy(policyIndex, { resourceCode: ($event.target as HTMLInputElement).value })" /></label>
        <button class="icon-button" type="button" :aria-label="`删除限频策略 ${policyIndex + 1}`" :disabled="disabled" @click="removePolicy(policyIndex)"><X :size="16" /></button>
      </div>
      <div class="license-limiter-limits">
        <div v-for="(limit, limitIndex) in policy.limits" :key="limitIndex" class="license-limiter-limit">
          <label>次数<input :value="limit.count" type="number" min="1" step="1" :disabled="disabled" @input="updateLimit(policyIndex, limitIndex, { count: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label>窗口<input :value="limit.window" type="number" min="1" step="1" :disabled="disabled" @input="updateLimit(policyIndex, limitIndex, { window: Number(($event.target as HTMLInputElement).value) })" /></label>
          <label>单位<FormSelect :model-value="limit.unit" :options="LIMITER_POLICY_UNITS" aria-label="限频单位" :disabled="disabled" @update:model-value="value => updateLimit(policyIndex, limitIndex, { unit: String(value) as LimiterPolicyLimit['unit'] })" /></label>
          <button v-if="policy.limits.length > 1" class="icon-button" type="button" :aria-label="`删除策略 ${policyIndex + 1} 的窗口 ${limitIndex + 1}`" :disabled="disabled" @click="removeLimit(policyIndex, limitIndex)"><X :size="16" /></button>
        </div>
        <button class="button-secondary" type="button" :disabled="disabled || policy.limits.length >= 8" @click="addLimit(policyIndex)"><Plus :size="15" />添加窗口</button>
      </div>
    </fieldset>
  </section>
</template>

<style scoped>
.license-limiter-editor, .license-limiter-policy, .license-limiter-limits { display: grid; gap: 10px; min-width: 0; }
.license-policy-section-header, .license-limiter-policy-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.license-policy-section-header h3 { margin: 0; }
.license-policy-section-header p { margin: 4px 0 0; color: var(--iam-color-text-secondary); font-size: 13px; }
.license-limiter-policy { border: 1px solid var(--iam-color-border); border-radius: var(--iam-radius-control); margin: 0; padding: 12px; }
.license-limiter-policy legend { color: var(--iam-color-text-secondary); font-size: 13px; padding: 0 4px; }
.license-limiter-policy-head { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) auto; align-items: end; }
.license-limiter-limits { padding-left: 12px; border-left: 2px solid var(--iam-color-border); }
.license-limiter-limit { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: 8px; align-items: end; }
.license-limiter-limits > button { justify-self: start; }
@media (max-width: 720px) { .license-limiter-policy-head, .license-limiter-limit { grid-template-columns: 1fr; } .license-limiter-policy-head .icon-button, .license-limiter-limit .icon-button { justify-self: end; } }
</style>
