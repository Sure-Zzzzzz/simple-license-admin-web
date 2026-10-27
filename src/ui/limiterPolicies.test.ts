import { describe, expect, it } from 'vitest';
import { createLimiterPolicy, serializeLimiterPolicies, validateLimiterPolicies } from './limiterPolicies';

describe('limiter policy form contract', () => {
  it('creates the documented one-window draft', () => {
    expect(createLimiterPolicy()).toEqual({
      serviceCode: '', resourceCode: '', limits: [{ count: 100, window: 1, unit: 'MINUTES' }]
    });
  });

  it('rejects duplicate targets and invalid windows', () => {
    const policy = { serviceCode: 'orders', resourceCode: 'create', limits: [{ count: 0, window: 1, unit: 'MINUTES' as const }] };
    expect(validateLimiterPolicies([policy, policy])).toEqual(expect.arrayContaining([
      '第 1 条限频策略第 1 个窗口的次数和窗口必须是正整数。',
      '第 2 条限频策略与其他策略重复声明了同一服务和资源。'
    ]));
  });

  it('trims identifiers without inventing a namespace or remote id', () => {
    expect(serializeLimiterPolicies([{ serviceCode: ' orders ', resourceCode: ' create ', limits: [{ count: 10, window: 1, unit: 'SECONDS' }] }]))
      .toEqual([{ serviceCode: 'orders', resourceCode: 'create', limits: [{ count: 10, window: 1, unit: 'SECONDS' }] }]);
  });
});
