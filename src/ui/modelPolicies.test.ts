import { describe, expect, it } from 'vitest';
import type { ModelPolicies } from '../api/domain';
import { BASE_REQUIRED_CAPABILITIES, createModelPolicies, policiesFromSnapshot, policiesToSnapshot, validateModelPolicies } from './modelPolicies';

function valid(): ModelPolicies {
  const policies = createModelPolicies(['channel.create']);
  policies.requiredCapabilities = [...BASE_REQUIRED_CAPABILITIES];
  return policies;
}

describe('modelPolicies', () => {
  it('legacy snapshot remains readable without silently claiming a complete policy', () => {
    const result = policiesFromSnapshot({ fields: { rights: {}, facts: {} }, actions: {} });
    expect(result.legacy).toBe(true);
    expect(result.policies.requiredCapabilities).toEqual(BASE_REQUIRED_CAPABILITIES);
  });

  it('serializes all policy sections beside fields and actions', () => {
    const policies = valid();
    const snapshot = policiesToSnapshot({ fields: { rights: {}, facts: {} }, actions: {} }, policies);
    expect(snapshot.subjectPolicy).toEqual(policies.subjectPolicy);
    expect(snapshot.connectivityPolicy).toEqual(policies.connectivityPolicy);
    expect(snapshot.requiredCapabilities).toEqual(BASE_REQUIRED_CAPABILITIES);
  });

  it('rejects invalid hybrid and subject combinations', () => {
    const policies = valid();
    policies.subjectPolicy.allowedKinds = ['PERSON'];
    policies.subjectPolicy.allowedEligibilityKinds = ['CUSTOMER_MEMBERS'];
    policies.organizationPolicy = { required: true, maxObservationAgeSeconds: 3600, membershipLeaseSeconds: 900 };
    policies.connectivityPolicy = { allowedModes: ['HYBRID'], refreshIntervalSeconds: 300, leaseDurationSeconds: 120, outageDurationSeconds: 60, outageActions: [] };
    expect(validateModelPolicies(policies).some(error => error.includes('租约'))).toBe(true);
  });

  it('rejects a required capability that the product has not declared', () => {
    const policies = valid();
    expect(validateModelPolicies(policies, { supportedCapabilities: [], declaredActions: ['channel.create'] }))
      .toEqual(expect.arrayContaining([expect.stringContaining('产品未声明必需能力')]));
  });

  it('requires explicit fields for fixed consumption windows and online concurrency', () => {
    const policies = valid();
    policies.quotaDefinitions = {
      seats: { limitRight: 2, kind: 'CONCURRENT', enforcement: 'ONLINE' },
      traffic: { limitRight: 10, kind: 'CONSUMPTION', enforcement: 'ONLINE', window: 'FIXED_WINDOW' }
    };
    const errors = validateModelPolicies(policies);
    expect(errors.some(error => error.includes('最大预留'))).toBe(true);
    expect(errors.some(error => error.includes('周期'))).toBe(true);
  });
});
