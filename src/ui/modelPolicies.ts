import type {
  ModelConnectivityMode, ModelDevicePolicy, ModelEligibilityKind, ModelPolicies,
  ModelQuotaDefinition, ModelQuotaEnforcement, ModelQuotaKind, ModelQuotaWindow,
  ModelRevocationMode, ModelSnapshot, ModelSubjectKind, ModelValidityKind, ProductView
} from '../api/domain';

export const BASE_REQUIRED_CAPABILITIES = ['license-condition/1', 'clock-state/1', 'subject-binding/1'];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 表单默认值是显式草稿内容，提交时不会由服务端隐式补齐。 */
export function createModelPolicies(actions: string[] = []): ModelPolicies {
  return {
    subjectPolicy: { allowedKinds: ['DEPLOYMENT'], allowedEligibilityKinds: ['ALLOCATED_DEPLOYMENTS'], offlineProofProfiles: [] },
    validityPolicy: {
      allowedKinds: ['FIXED', 'PERPETUAL'], minimumStartsAt: null, maximumStartsAt: null,
      minimumDurationSeconds: null, maximumDurationSeconds: null, maximumGraceSeconds: null, graceActions: [...actions]
    },
    connectivityPolicy: { allowedModes: ['ONLINE'] },
    clockPolicy: { skewSeconds: 0, rollbackToleranceSeconds: 0 },
    devicePolicy: { mode: 'NONE' },
    organizationPolicy: { required: false },
    quotaDefinitions: {}, quotaConstraints: {},
    revocationPolicy: { mode: 'OPTIONAL' },
    requiredCapabilities: [...BASE_REQUIRED_CAPABILITIES]
  };
}

export function cloneModelPolicies(policies: ModelPolicies): ModelPolicies { return clone(policies); }

export function policiesFromSnapshot(snapshot: ModelSnapshot, actions: string[] = []): { policies: ModelPolicies; legacy: boolean } {
  const base = createModelPolicies(actions);
  const hasPolicies = Boolean(snapshot.subjectPolicy && snapshot.validityPolicy && snapshot.connectivityPolicy
    && snapshot.clockPolicy && snapshot.devicePolicy && snapshot.organizationPolicy
    && snapshot.quotaDefinitions && snapshot.quotaConstraints && snapshot.revocationPolicy
    && snapshot.requiredCapabilities);
  if (!hasPolicies) return { policies: base, legacy: true };
  return { policies: clone({
    ...base,
    subjectPolicy: snapshot.subjectPolicy,
    validityPolicy: snapshot.validityPolicy,
    connectivityPolicy: snapshot.connectivityPolicy,
    clockPolicy: snapshot.clockPolicy,
    devicePolicy: snapshot.devicePolicy,
    organizationPolicy: snapshot.organizationPolicy,
    quotaDefinitions: snapshot.quotaDefinitions,
    quotaConstraints: snapshot.quotaConstraints,
    revocationPolicy: snapshot.revocationPolicy,
    requiredCapabilities: snapshot.requiredCapabilities
  } as ModelPolicies), legacy: false };
}

export function policiesToSnapshot(snapshot: Pick<ModelSnapshot, 'fields' | 'actions'>, policies: ModelPolicies): ModelSnapshot {
  return { fields: clone(snapshot.fields), actions: clone(snapshot.actions), ...clone(policies) };
}

function safeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value); }
function unique(values: string[]): boolean { return new Set(values).size === values.length; }
function includes<T>(values: readonly T[], value: T): boolean { return values.includes(value); }
function errorPush(errors: string[], text: string) { if (!errors.includes(text)) errors.push(text); }

/** 前端只做可解释的组合校验；服务端 422 仍是最终裁决。 */
export function validateModelPolicies(policies: ModelPolicies, product?: Pick<ProductView, 'supportedCapabilities' | 'declaredActions'>): string[] {
  const errors: string[] = [];
  const s = policies.subjectPolicy; const v = policies.validityPolicy; const c = policies.connectivityPolicy;
  const o = policies.organizationPolicy; const d = policies.devicePolicy; const r = policies.revocationPolicy;
  if (!s.allowedKinds.length) errorPush(errors, '至少允许一种授权对象。');
  if (!s.allowedEligibilityKinds.length) errorPush(errors, '至少允许一种资格种类。');
  if (!unique(s.allowedKinds) || !unique(s.allowedEligibilityKinds) || !unique(s.offlineProofProfiles)) errorPush(errors, '政策集合不能包含重复项。');
  if (s.allowedKinds.includes('DEPLOYMENT') && s.allowedEligibilityKinds.some(k => k !== 'ALLOCATED_DEPLOYMENTS')) errorPush(errors, '部署对象只能使用 ALLOCATED_DEPLOYMENTS 资格。');
  if (s.allowedKinds.includes('SERVICE') && s.allowedEligibilityKinds.some(k => k !== 'ASSIGNED_SUBJECTS')) errorPush(errors, '服务对象只能使用 ASSIGNED_SUBJECTS 资格。');
  if (s.allowedKinds.includes('PERSON') && s.allowedEligibilityKinds.some(k => !['CUSTOMER_MEMBERS', 'ASSIGNED_SUBJECTS'].includes(k))) errorPush(errors, '人员对象只能使用 CUSTOMER_MEMBERS 或 ASSIGNED_SUBJECTS 资格。');
  if (s.allowedEligibilityKinds.includes('CUSTOMER_MEMBERS') && (!s.allowedKinds.every(k => k === 'PERSON') || !o.required || c.allowedModes.includes('OFFLINE'))) errorPush(errors, 'CUSTOMER_MEMBERS 只允许人员、组织要求且不能离线。');
  if ((s.allowedKinds.includes('PERSON') || s.allowedKinds.includes('SERVICE')) && d.mode !== 'NONE') errorPush(errors, '人员或服务对象只能使用 NONE 设备政策。');
  if ((c.allowedModes.includes('OFFLINE') || c.allowedModes.includes('HYBRID')) && !s.offlineProofProfiles.length) errorPush(errors, '离线或混合模式必须声明受控离线身份版本。');
  if (!c.allowedModes.length || !unique(c.allowedModes)) errorPush(errors, '至少允许一种连接模式且不能重复。');
  if (c.allowedModes.includes('HYBRID')) {
    if (!safeInteger(c.refreshIntervalSeconds) || c.refreshIntervalSeconds! <= 0) errorPush(errors, 'HYBRID 的刷新间隔必须是正整数。');
    if (!safeInteger(c.leaseDurationSeconds) || c.leaseDurationSeconds! <= 0 || (c.refreshIntervalSeconds !== undefined && c.refreshIntervalSeconds > c.leaseDurationSeconds!)) errorPush(errors, 'HYBRID 的租约必须为正整数且不小于刷新间隔。');
    if (!safeInteger(c.outageDurationSeconds) || c.outageDurationSeconds! < 0) errorPush(errors, 'HYBRID 的断网时长必须是非负整数。');
    if (!Array.isArray(c.outageActions) || c.outageActions.some(a => !v.graceActions.includes(a))) errorPush(errors, '断网动作必须来自模型动作。');
  } else if (c.refreshIntervalSeconds !== undefined || c.leaseDurationSeconds !== undefined || c.outageDurationSeconds !== undefined || c.outageActions?.length) errorPush(errors, '只有 HYBRID 才能填写租约、断网与刷新字段。');
  for (const [label, value] of [['时钟偏差', policies.clockPolicy.skewSeconds], ['回拨容忍', policies.clockPolicy.rollbackToleranceSeconds] as const]) {
    if (!safeInteger(value) || value < 0 || value > 300) errorPush(errors, `${label}必须是 0 到 300 的安全整数。`);
  }
  if (d.mode === 'WEIGHTED') {
    if (d.profileVersion !== 'hardware/1' || !Object.keys(d.components).length || Object.values(d.components).some(w => !safeInteger(w) || w < 1 || w > 100)) errorPush(errors, '加权设备政策必须使用 hardware/1，并声明 1 到 100 的组件权重。');
    const total = Object.values(d.components).reduce((sum, value) => sum + value, 0);
    if (!safeInteger(d.minimumAvailableWeight) || d.minimumAvailableWeight <= 0 || d.minimumAvailableWeight > total) errorPush(errors, '最低可用权重必须大于 0 且不超过总权重。');
    if (!safeInteger(d.maximumMismatchWeight) || d.maximumMismatchWeight < 0 || d.maximumMismatchWeight >= d.minimumAvailableWeight) errorPush(errors, '最大不匹配权重必须非负且小于最低可用权重。');
  }
  if (d.mode === 'DEVICE_KEY' && typeof d.requireHardwareBacked !== 'boolean') errorPush(errors, '设备密钥政策必须明确硬件保护要求。');
  if (o.required && (!safeInteger(o.maxObservationAgeSeconds) || o.maxObservationAgeSeconds < 1 || o.maxObservationAgeSeconds > 86400 || !safeInteger(o.membershipLeaseSeconds) || o.membershipLeaseSeconds < 1 || o.membershipLeaseSeconds > o.maxObservationAgeSeconds)) errorPush(errors, '组织政策的观测时效与成员租约必须是合法秒数。');
  for (const [metric, q] of Object.entries(policies.quotaDefinitions)) validateQuota(errors, metric, q, s, v);
  for (const [action, metrics] of Object.entries(policies.quotaConstraints)) {
    if (!Array.isArray(metrics) || !unique(metrics) || metrics.some(metric => !policies.quotaDefinitions[metric])) errorPush(errors, `动作 ${action} 的额度约束引用了未知指标。`);
  }
  if (r.mode === 'REQUIRED' && (!safeInteger(r.maxAgeSeconds) || r.maxAgeSeconds <= 0)) errorPush(errors, '必需吊销政策必须声明正整数 maxAgeSeconds。');
  if (r.mode === 'OPTIONAL' && r.maxAgeSeconds !== undefined) errorPush(errors, 'OPTIONAL 吊销政策不能包含 maxAgeSeconds。');
  if (!unique(policies.requiredCapabilities) || policies.requiredCapabilities.some(cap => !cap.trim())) errorPush(errors, '必需能力必须是非空且不重复的版本标识。');
  if (product) {
    for (const capability of policies.requiredCapabilities) if (!product.supportedCapabilities.includes(capability)) errorPush(errors, `产品未声明必需能力 ${capability}，无法形成可发布政策。`);
    for (const action of [...v.graceActions, ...(c.outageActions ?? [])]) if (!product.declaredActions.includes(action)) errorPush(errors, `政策引用了产品未声明的动作 ${action}。`);
  }
  return errors;
}

function validateQuota(errors: string[], metric: string, q: ModelQuotaDefinition, subjects: ModelPolicies['subjectPolicy'], validity: ModelPolicies['validityPolicy']) {
  if (!metric.trim() || !safeInteger(q.limitRight) || q.limitRight < 0) errorPush(errors, `额度 ${metric || '未命名'} 的 limitRight 必须是非负安全整数。`);
  if (q.kind === 'NAMED_SEAT') {
    if (q.enforcement !== 'ONLINE' || !validity.allowedKinds.includes('FIXED') || !subjects.allowedEligibilityKinds.some(k => k === 'CUSTOMER_MEMBERS' || k === 'ASSIGNED_SUBJECTS')) errorPush(errors, `NAMED_SEAT 额度 ${metric} 必须在线、固定期限并使用实名资格。`);
    if (q.window || q.periodSeconds !== undefined || q.maxReservationSeconds !== undefined) errorPush(errors, `NAMED_SEAT 额度 ${metric} 不能填写窗口、周期或最大预留。`);
  } else if (q.kind === 'CONCURRENT') {
    if (q.window || q.periodSeconds !== undefined) errorPush(errors, `CONCURRENT 额度 ${metric} 不能填写窗口或周期。`);
    if (q.enforcement === 'ONLINE' && (!safeInteger(q.maxReservationSeconds) || q.maxReservationSeconds <= 0)) errorPush(errors, `在线 CONCURRENT 额度 ${metric} 必须填写正整数最大预留秒数。`);
  } else if (q.kind === 'CONSUMPTION') {
    if (!includes(['TOTAL', 'FIXED_WINDOW'] as ModelQuotaWindow[], q.window!)) errorPush(errors, `CONSUMPTION 额度 ${metric} 必须选择窗口。`);
    if (q.window === 'FIXED_WINDOW' && (!safeInteger(q.periodSeconds) || q.periodSeconds <= 0)) errorPush(errors, `固定窗口额度 ${metric} 必须填写正整数周期。`);
  } else errorPush(errors, `额度 ${metric} 的种类无效。`);
  if (q.enforcement !== 'LOCAL' && q.enforcement !== 'ONLINE') errorPush(errors, `额度 ${metric} 的执行方式无效。`);
  if (q.enforcement === 'LOCAL' && !subjects.allowedKinds.every(k => k === 'DEPLOYMENT')) errorPush(errors, `LOCAL 额度 ${metric} 只适用于部署对象。`);
}

export function policySummary(policies: ModelPolicies): string[] {
  const s = policies.subjectPolicy; const c = policies.connectivityPolicy; const d = policies.devicePolicy;
  return [
    `对象：${s.allowedKinds.join('、')}；资格：${s.allowedEligibilityKinds.join('、')}`,
    `模式：${c.allowedModes.join('、')}；设备：${d.mode}`,
    `期限：${policies.validityPolicy.allowedKinds.join('、')}；额度：${Object.keys(policies.quotaDefinitions).length} 项`,
    `组织要求：${policies.organizationPolicy.required ? '是' : '否'}；吊销：${policies.revocationPolicy.mode}`,
    `必需能力：${policies.requiredCapabilities.join('、') || '无'}`
  ];
}

export const modelOptionValues = {
  subjectKinds: ['DEPLOYMENT', 'PERSON', 'SERVICE'] as ModelSubjectKind[],
  eligibilityKinds: ['ALLOCATED_DEPLOYMENTS', 'CUSTOMER_MEMBERS', 'ASSIGNED_SUBJECTS'] as ModelEligibilityKind[],
  validityKinds: ['FIXED', 'PERPETUAL'] as ModelValidityKind[],
  connectivityModes: ['ONLINE', 'OFFLINE', 'HYBRID'] as ModelConnectivityMode[],
  deviceModes: ['NONE', 'WEIGHTED', 'DEVICE_KEY'] as ModelDevicePolicy['mode'][],
  quotaKinds: ['NAMED_SEAT', 'CONCURRENT', 'CONSUMPTION'] as ModelQuotaKind[],
  quotaEnforcement: ['LOCAL', 'ONLINE'] as ModelQuotaEnforcement[],
  revocationModes: ['OPTIONAL', 'REQUIRED'] as ModelRevocationMode[]
};
