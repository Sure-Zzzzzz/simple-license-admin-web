import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./http', () => ({ request: vi.fn(), query: () => '' }));
import { request } from './http';
import { confirmIntegrationPlan, createActivation, createIntegrationAttempt, createIntegrationPlan, patchActivationCallerBinding, reconcileIntegrationCommand, reconfirmIntegrationEnvironment, recoverOperation, requestCredentialIssuance } from './domain';
function lastRequest() { const [path, init] = vi.mocked(request).mock.calls.at(-1)!; return { path, ...init, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }; }
describe('License HTTP 写入契约', () => {
  beforeEach(() => vi.resetAllMocks());
  it('批准规则创建使用正式产品端点和复用请求键', () => {
    const input = { customerId: 'customer-1', applicationId: '9', desiredRules: { pagePermissions: ['app.page'], apiPermissions: ['app.read'], dataGrantTemplate: null } };
    createIntegrationPlan('product/1', input, 'same-request'); expect(lastRequest()).toMatchObject({ path: '/api/license/v1/products/product%2F1/role-projection-plans', idempotencyKey: 'same-request', body: input });
  });
  it('刷新默认空体即 MANUAL，AUTO 必须显式指定', () => {
    createIntegrationAttempt('command-1'); expect(lastRequest().body).toBeUndefined();
    createIntegrationAttempt('command-1', 'AUTO', 'explicit-request'); expect(lastRequest()).toMatchObject({ idempotencyKey: 'explicit-request', body: { executionMode: 'AUTO' } });
  });
  it('人工回执携带期望修订、身份环境、绑定版本与首次角色', () => {
    const input = { expectedRevision: 3, organizationInstanceId: 'iam-instance', bindingGeneration: 2, openRoleId: 'role-9' };
    confirmIntegrationPlan('plan-1', input); expect(lastRequest()).toMatchObject({ path: '/api/license/v1/role-projection-plans/plan-1/confirmations', body: input });
    reconcileIntegrationCommand('command-1', { ...input, priorCallTerminated: true }); expect(lastRequest()).toMatchObject({ path: '/api/license/v1/integration-commands/command-1/reconciliations', body: { ...input, priorCallTerminated: true } });
  });
  it('环境重确认不用旧角色编号', () => {
    const input = { customerId: 'customer-1', applicationId: '9', organizationInstanceId: 'iam-new', bindingGeneration: 3, priorCallTerminated: true as const };
    reconfirmIntegrationEnvironment('product-1', input); expect(lastRequest()).toMatchObject({ path: '/api/license/v1/products/product-1/role-projection-reconfirmations', body: input });
  });
  it('签名接管请求包含执行批次、行版本和处理原因', () => {
    const input = { expectedRowVersion: 9, expectedExecutionGeneration: 3, reasonCategory: 'STALE_SIGNING_TAKEOVER' };
    recoverOperation('operation-1', input); expect(lastRequest()).toMatchObject({ path: '/api/license/v1/operations/operation-1/recoveries', body: input });
  });
  it('激活绑定结构化提交且离线缺省不序列化成null', () => {
    createActivation('grant-1', { deploymentCode: 'deploy-a' }); expect(lastRequest().body).toEqual({ deploymentCode: 'deploy-a' });
    const input = { expectedRowVersion: 2, callerBinding: { sourceId: 'official-source', subjectId: 'service-1' } };
    patchActivationCallerBinding('activation-1', input); expect(lastRequest()).toMatchObject({ path: '/api/license/v1/activations/activation-1/caller-binding', body: input });
  });
  it('签发精确绑定及代数原样序列化，并允许结果不明时复用原幂等键', () => {
    const activationInput = { kid: 'kid-1', subjectRef: { kind: 'DEPLOYMENT' as const, activationId: 'act-1', activationGeneration: 4 } };
    requestCredentialIssuance('grant/1', activationInput, 'same-issuance');
    expect(lastRequest()).toMatchObject({ path: '/api/license/v1/grants/grant%2F1/credentials', body: activationInput, idempotencyKey: 'same-issuance' });
    const assignmentInput = { kid: 'kid-1', subjectRef: { kind: 'PERSON' as const, sourceId: 'official-source', subjectId: 'person-1', assignmentId: 'assignment-1', assignmentGeneration: 7 } };
    requestCredentialIssuance('grant-2', assignmentInput, 'assignment-issuance');
    expect(lastRequest()).toMatchObject({ body: assignmentInput, idempotencyKey: 'assignment-issuance' });
  });
});
