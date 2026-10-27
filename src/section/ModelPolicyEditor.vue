<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import type { ModelConnectivityMode, ModelDevicePolicy, ModelEligibilityKind, ModelPolicies, ModelQuotaDefinition, ModelQuotaKind, ModelSubjectKind, ModelValidityKind, ProductView } from '../api/domain';
import { cloneModelPolicies, modelOptionValues, validateModelPolicies } from '../ui/modelPolicies';

const props = defineProps<{
  modelValue: ModelPolicies;
  product?: Pick<ProductView, 'supportedCapabilities' | 'declaredActions'>;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: ModelPolicies]; 'validity-change': [errors: string[]] }>();
const draft = reactive<ModelPolicies>(cloneModelPolicies(props.modelValue));
const offlineProfiles = computed({
  get: () => draft.subjectPolicy.offlineProofProfiles.join(', '),
  set: (value: string) => { draft.subjectPolicy.offlineProofProfiles = value.split(',').map(item => item.trim()).filter(Boolean); }
});
const requiredCapabilities = computed({
  get: () => draft.requiredCapabilities.join(', '),
  set: (value: string) => { draft.requiredCapabilities = value.split(',').map(item => item.trim()).filter(Boolean); }
});
const errors = computed(() => validateModelPolicies(draft, props.product));
watch(draft, value => { const next = cloneModelPolicies(value); emit('update:modelValue', next); emit('validity-change', validateModelPolicies(next, props.product)); }, { deep: true, immediate: true });

function toggle<T extends string>(values: T[], value: T) {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1); else values.push(value);
}
function label(value: string): string {
  const labels: Record<string, string> = {
    DEPLOYMENT: '部署', PERSON: '人员', SERVICE: '服务', ALLOCATED_DEPLOYMENTS: '已分配部署', CUSTOMER_MEMBERS: '客户成员', ASSIGNED_SUBJECTS: '已分配主体',
    FIXED: '固定期限', PERPETUAL: '永久', ONLINE: '在线', OFFLINE: '离线', HYBRID: '混合', NONE: '无设备绑定', WEIGHTED: '加权设备', DEVICE_KEY: '设备密钥',
    NAMED_SEAT: '实名席位', CONCURRENT: '并发', CONSUMPTION: '消耗量', LOCAL: '本地', TOTAL: '总量', FIXED_WINDOW: '固定窗口', OPTIONAL: '可选', REQUIRED: '必需'
  };
  return labels[value] ?? value;
}
const options = (values: readonly string[]) => values.map(value => ({ value, label: label(value) }));

function quotaEntries() { return Object.entries(draft.quotaDefinitions); }
function addQuota() {
  let metric = 'quota'; let index = 1;
  while (draft.quotaDefinitions[metric + index]) index += 1;
  draft.quotaDefinitions[metric + index] = { limitRight: 1, kind: 'CONCURRENT', enforcement: 'ONLINE', maxReservationSeconds: 3600 };
}
function renameQuota(oldMetric: string, event: Event) {
  const next = (event.target as HTMLInputElement).value.trim();
  if (!next || next === oldMetric || draft.quotaDefinitions[next]) return;
  const definition = draft.quotaDefinitions[oldMetric]; delete draft.quotaDefinitions[oldMetric]; draft.quotaDefinitions[next] = definition;
  for (const [action, metrics] of Object.entries(draft.quotaConstraints)) draft.quotaConstraints[action] = metrics.map(metric => metric === oldMetric ? next : metric);
}
function removeQuota(metric: string) {
  delete draft.quotaDefinitions[metric];
  for (const [action, metrics] of Object.entries(draft.quotaConstraints)) draft.quotaConstraints[action] = metrics.filter(item => item !== metric);
}
function quotaNeedsWindow(definition: ModelQuotaDefinition) { return definition.kind === 'CONSUMPTION'; }
function quotaNeedsReservation(definition: ModelQuotaDefinition) { return definition.kind === 'CONCURRENT' && definition.enforcement === 'ONLINE'; }
function addConstraint(action: string) { if (!draft.quotaConstraints[action]) draft.quotaConstraints[action] = []; }
function removeConstraint(action: string) { delete draft.quotaConstraints[action]; }
function constraintValue(action: string) { return (draft.quotaConstraints[action] ?? []).join(', '); }
function setConstraint(action: string, value: string) { draft.quotaConstraints[action] = value.split(',').map(item => item.trim()).filter(Boolean); }
function addWeightedComponent() {
  if (draft.devicePolicy.mode !== 'WEIGHTED') return;
  let name = 'component'; let index = 1;
  while (draft.devicePolicy.components[name + index]) index += 1;
  draft.devicePolicy.components[name + index] = 50;
}
function removeWeightedComponent(name: string) {
  if (draft.devicePolicy.mode === 'WEIGHTED') delete draft.devicePolicy.components[name];
}
function setDeviceMode(mode: ModelDevicePolicy['mode']) {
  if (mode === 'NONE') draft.devicePolicy = { mode };
  else if (mode === 'WEIGHTED') draft.devicePolicy = { mode, profileVersion: 'hardware/1', components: { systemUuid: 50 }, minimumAvailableWeight: 50, maximumMismatchWeight: 0 };
  else draft.devicePolicy = { mode, requireHardwareBacked: true };
}
</script>

<template>
  <div class="license-policy-editor" :aria-disabled="disabled ? 'true' : undefined">
    <p v-if="errors.length" class="license-message danger" role="alert"><span>当前政策有 {{ errors.length }} 项组合问题，修正后才能提交。</span></p>
    <section class="license-policy-section">
      <header><h3>主体与资格</h3><p>决定授权对象、资格来源以及离线身份版本。</p></header>
      <div class="license-policy-options"><label v-for="value in modelOptionValues.subjectKinds" :key="value" class="license-form-check"><input type="checkbox" :checked="draft.subjectPolicy.allowedKinds.includes(value as ModelSubjectKind)" :disabled="disabled" @change="toggle(draft.subjectPolicy.allowedKinds, value as ModelSubjectKind)" />{{ label(value) }}</label></div>
      <div class="license-policy-options"><label v-for="value in modelOptionValues.eligibilityKinds" :key="value" class="license-form-check"><input type="checkbox" :checked="draft.subjectPolicy.allowedEligibilityKinds.includes(value as ModelEligibilityKind)" :disabled="disabled" @change="toggle(draft.subjectPolicy.allowedEligibilityKinds, value as ModelEligibilityKind)" />{{ label(value) }}</label></div>
      <label>受控离线身份版本（逗号分隔）<input v-model="offlineProfiles" :disabled="disabled" placeholder="例如 subject-proof/1" /></label>
    </section>
    <section class="license-policy-section">
      <header><h3>期限与宽限</h3><p>秒数与时间戳均要求安全整数，最终以服务端校验为准。</p></header>
      <div class="license-policy-options"><label v-for="value in modelOptionValues.validityKinds" :key="value" class="license-form-check"><input type="checkbox" :checked="draft.validityPolicy.allowedKinds.includes(value as ModelValidityKind)" :disabled="disabled" @change="toggle(draft.validityPolicy.allowedKinds, value as ModelValidityKind)" />{{ label(value) }}</label></div>
      <div class="license-policy-grid"><label>最早开始时间戳<input v-model.number="draft.validityPolicy.minimumStartsAt" type="number" :disabled="disabled" placeholder="可选" /></label><label>最晚开始时间戳<input v-model.number="draft.validityPolicy.maximumStartsAt" type="number" :disabled="disabled" placeholder="可选" /></label><label>最短期限秒数<input v-model.number="draft.validityPolicy.minimumDurationSeconds" type="number" :disabled="disabled" placeholder="可选" /></label><label>最长期限秒数<input v-model.number="draft.validityPolicy.maximumDurationSeconds" type="number" :disabled="disabled" placeholder="可选" /></label><label>最大宽限秒数<input v-model.number="draft.validityPolicy.maximumGraceSeconds" type="number" :disabled="disabled" placeholder="可选" /></label></div>
      <label>允许宽限动作（逗号分隔）<input :value="draft.validityPolicy.graceActions.join(', ')" :disabled="disabled" @input="draft.validityPolicy.graceActions = ($event.target as HTMLInputElement).value.split(',').map(item => item.trim()).filter(Boolean)" /></label>
    </section>
    <section class="license-policy-section">
      <header><h3>连接与时钟</h3><p>混合模式才允许填写刷新、租约和断网窗口。</p></header>
      <div class="license-policy-options"><label v-for="value in modelOptionValues.connectivityModes" :key="value" class="license-form-check"><input type="checkbox" :checked="draft.connectivityPolicy.allowedModes.includes(value as ModelConnectivityMode)" :disabled="disabled" @change="toggle(draft.connectivityPolicy.allowedModes, value as ModelConnectivityMode)" />{{ label(value) }}</label></div>
      <div v-if="draft.connectivityPolicy.allowedModes.includes('HYBRID')" class="license-policy-grid"><label>刷新间隔秒数<input v-model.number="draft.connectivityPolicy.refreshIntervalSeconds" type="number" :disabled="disabled" /></label><label>租约时长秒数<input v-model.number="draft.connectivityPolicy.leaseDurationSeconds" type="number" :disabled="disabled" /></label><label>断网时长秒数<input v-model.number="draft.connectivityPolicy.outageDurationSeconds" type="number" :disabled="disabled" /></label><label>断网动作（逗号分隔）<input :value="(draft.connectivityPolicy.outageActions ?? []).join(', ')" :disabled="disabled" @input="draft.connectivityPolicy.outageActions = ($event.target as HTMLInputElement).value.split(',').map(item => item.trim()).filter(Boolean)" /></label></div>
      <div class="license-policy-grid"><label>允许时钟偏差秒数<input v-model.number="draft.clockPolicy.skewSeconds" type="number" :disabled="disabled" /></label><label>回拨容忍秒数<input v-model.number="draft.clockPolicy.rollbackToleranceSeconds" type="number" :disabled="disabled" /></label></div>
    </section>
    <section class="license-policy-section">
      <header><h3>设备与组织</h3><p>人员、服务对象不能静默使用设备绑定；真实 Provider 能力仍由签发校验确认。</p></header>
      <div class="license-field"><span>设备政策</span><FormSelect :model-value="draft.devicePolicy.mode" :options="options(modelOptionValues.deviceModes)" aria-label="设备政策" :disabled="disabled" @update:model-value="value => setDeviceMode(String(value) as ModelDevicePolicy['mode'])" /></div>
      <div v-if="draft.devicePolicy.mode === 'WEIGHTED'" class="license-policy-subsection"><div v-for="(weight, name) in draft.devicePolicy.components" :key="name" class="license-policy-row"><input :value="name" disabled /><input v-model.number="draft.devicePolicy.components[name]" type="number" min="1" max="100" aria-label="组件权重" :disabled="disabled" /><button type="button" class="button-secondary" :disabled="disabled" @click="removeWeightedComponent(name)">删除</button></div><div class="license-policy-grid"><label>最低可用权重<input v-model.number="draft.devicePolicy.minimumAvailableWeight" type="number" :disabled="disabled" /></label><label>最大不匹配权重<input v-model.number="draft.devicePolicy.maximumMismatchWeight" type="number" :disabled="disabled" /></label></div><button type="button" class="button-secondary" :disabled="disabled" @click="addWeightedComponent">添加组件</button></div>
      <label v-if="draft.devicePolicy.mode === 'DEVICE_KEY'" class="license-form-check"><input v-model="draft.devicePolicy.requireHardwareBacked" type="checkbox" :disabled="disabled" />要求硬件保护设备密钥</label>
      <label class="license-form-check"><input type="checkbox" :checked="draft.organizationPolicy.required" :disabled="disabled" @change="draft.organizationPolicy = ($event.target as HTMLInputElement).checked ? { required: true, maxObservationAgeSeconds: 3600, membershipLeaseSeconds: 900 } : { required: false }" />要求组织成员关系</label>
      <div v-if="draft.organizationPolicy.required" class="license-policy-grid"><label>最大观测年龄秒数<input v-model.number="draft.organizationPolicy.maxObservationAgeSeconds" type="number" :disabled="disabled" /></label><label>成员租约秒数<input v-model.number="draft.organizationPolicy.membershipLeaseSeconds" type="number" :disabled="disabled" /></label></div>
    </section>
    <section class="license-policy-section">
      <header><h3>额度与动作约束</h3><p>额度指标是模型契约的一部分；页面只提交结构化定义。</p></header>
      <div v-for="([metric, definition]) in quotaEntries()" :key="metric" class="license-policy-card"><div class="license-policy-row"><input :value="metric" aria-label="额度指标" :disabled="disabled" @change="renameQuota(metric, $event)" /><button type="button" class="button-secondary" :disabled="disabled" @click="removeQuota(metric)">删除</button></div><div class="license-policy-grid"><label>权益上限<input v-model.number="definition.limitRight" type="number" min="0" :disabled="disabled" /></label><label>种类<FormSelect :model-value="definition.kind" :options="options(modelOptionValues.quotaKinds)" aria-label="额度种类" :disabled="disabled" @update:model-value="value => definition.kind = String(value) as ModelQuotaKind" /></label><label>执行方式<FormSelect :model-value="definition.enforcement" :options="options(modelOptionValues.quotaEnforcement)" aria-label="额度执行方式" :disabled="disabled" @update:model-value="value => definition.enforcement = String(value) as ModelQuotaDefinition['enforcement']" /></label><label v-if="quotaNeedsWindow(definition)">窗口<FormSelect :model-value="definition.window ?? ''" :options="[{ value: '', label: '请选择' }, ...options(['TOTAL', 'FIXED_WINDOW'])]" aria-label="额度窗口" :disabled="disabled" @update:model-value="value => definition.window = String(value) as ModelQuotaDefinition['window']" /></label><label v-if="definition.window === 'FIXED_WINDOW'">周期秒数<input v-model.number="definition.periodSeconds" type="number" min="1" :disabled="disabled" /></label><label v-if="quotaNeedsReservation(definition)">最大预留秒数<input v-model.number="definition.maxReservationSeconds" type="number" min="1" :disabled="disabled" /></label></div></div>
      <button type="button" class="button-secondary" :disabled="disabled" @click="addQuota">添加额度</button>
      <div v-for="action in (props.product?.declaredActions ?? [])" :key="action" class="license-policy-row"><code>{{ action }}</code><input :value="constraintValue(action)" :disabled="disabled" placeholder="额度指标，逗号分隔" aria-label="额度约束" @input="setConstraint(action, ($event.target as HTMLInputElement).value)" /><button v-if="draft.quotaConstraints[action]" type="button" class="button-secondary" :disabled="disabled" @click="removeConstraint(action)">清除约束</button><button v-else type="button" class="button-secondary" :disabled="disabled" @click="addConstraint(action)">添加约束</button></div>
    </section>
    <section class="license-policy-section">
      <header><h3>吊销与能力</h3><p>能力版本必须由产品声明，页面不会替 Provider 伪造支持。</p></header>
      <div class="license-field"><span>吊销方式</span><FormSelect :model-value="draft.revocationPolicy.mode" :options="options(modelOptionValues.revocationModes)" aria-label="吊销方式" :disabled="disabled" @update:model-value="value => draft.revocationPolicy = String(value) === 'REQUIRED' ? { mode: 'REQUIRED', maxAgeSeconds: 86400 } : { mode: 'OPTIONAL' }" /></div>
      <label v-if="draft.revocationPolicy.mode === 'REQUIRED'">最大吊销年龄秒数<input v-model.number="draft.revocationPolicy.maxAgeSeconds" type="number" min="1" :disabled="disabled" /></label>
      <label>必需能力版本（逗号分隔）<input v-model="requiredCapabilities" :disabled="disabled" placeholder="license-condition/1, clock-state/1" /></label>
    </section>
  </div>
</template>
