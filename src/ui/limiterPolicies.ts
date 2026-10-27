import type { LimiterPolicyInput, LimiterPolicyUnit } from '../api/domain';

export const LIMITER_POLICY_UNITS: Array<{ value: LimiterPolicyUnit; label: string }> = [
  { value: 'SECONDS', label: '秒' },
  { value: 'MINUTES', label: '分钟' },
  { value: 'HOURS', label: '小时' },
  { value: 'DAYS', label: '天' }
];

export function createLimiterPolicy(): LimiterPolicyInput {
  return {
    serviceCode: '',
    resourceCode: '',
    limits: [{ count: 100, window: 1, unit: 'MINUTES' }]
  };
}

function safePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 前端只做可解释校验，服务端仍是限频授权的最终裁决。 */
export function validateLimiterPolicies(policies: LimiterPolicyInput[]): string[] {
  const errors: string[] = [];
  if (policies.length > 64) errors.push('客户限频策略不能超过 64 项。');
  const identities = new Set<string>();
  policies.forEach((policy, index) => {
    const label = `第 ${index + 1} 条限频策略`;
    if (!policy.serviceCode.trim() || policy.serviceCode.trim().length > 128) errors.push(`${label}的服务编码必须为 1 到 128 个字符。`);
    if (!policy.resourceCode.trim() || policy.resourceCode.trim().length > 128) errors.push(`${label}的资源编码必须为 1 到 128 个字符。`);
    const identity = `${policy.serviceCode.trim()}\u0000${policy.resourceCode.trim()}`;
    if (identities.has(identity)) errors.push(`${label}与其他策略重复声明了同一服务和资源。`);
    identities.add(identity);
    if (!policy.limits.length || policy.limits.length > 8) errors.push(`${label}必须配置 1 到 8 个限频窗口。`);
    policy.limits.forEach((limit, limitIndex) => {
      if (!safePositiveInteger(limit.count) || !safePositiveInteger(limit.window)) {
        errors.push(`${label}第 ${limitIndex + 1} 个窗口的次数和窗口必须是正整数。`);
      }
      if (!LIMITER_POLICY_UNITS.some(option => option.value === limit.unit)) {
        errors.push(`${label}第 ${limitIndex + 1} 个窗口的时间单位无效。`);
      }
    });
  });
  return errors;
}

export function serializeLimiterPolicies(policies: LimiterPolicyInput[]): LimiterPolicyInput[] {
  return policies.map(policy => ({
    serviceCode: policy.serviceCode.trim(),
    resourceCode: policy.resourceCode.trim(),
    limits: policy.limits.map(limit => ({ count: limit.count, window: limit.window, unit: limit.unit }))
  }));
}
