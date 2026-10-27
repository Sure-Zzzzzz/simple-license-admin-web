import { query, request } from './http';
import type { LicensePage } from './http';

/**
 * 通用授权域契约（/api/license/v1）：类型对齐 DESIGN.HTTP.1.md 的 *View 分组。
 * 字段分组名在实施 DTO 用 *Request/*Response，此处为前端消费视图。
 */

// ===== 签发方 / 客户 / 组织绑定 =====

export interface IssuerView { issuerId: string; code: string; displayName: string; status: string; rowVersion: number; }
export interface CustomerView { customerId: string; code: string; displayName: string; status: string; rowVersion: number; }
export interface OrganizationBindingView { customerId: string; organizationInstanceId: string | null; rootDepartmentId: number | null; bindingGeneration: number | null; rowVersion: number; }

export const listIssuers = (page = 1, size?: number) =>
  request<LicensePage<IssuerView>>(`/api/license/v1/issuers${query({ page, size })}`);
export const createIssuer = (input: { code: string; displayName: string }) =>
  request<IssuerView>('/api/license/v1/issuers', { method: 'POST', body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });

export const listCustomers = (page = 1, size?: number) =>
  request<LicensePage<CustomerView>>(`/api/license/v1/customers${query({ page, size })}`);
export const createCustomer = (input: { code: string; displayName: string }) =>
  request<CustomerView>('/api/license/v1/customers', { method: 'POST', body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });

export const getOrganizationBinding = (customerId: string) =>
  request<OrganizationBindingView>(`/api/license/v1/customers/${encodeURIComponent(customerId)}/organization-binding`);
export const putOrganizationBinding = (customerId: string, input: { organizationInstanceId: string; rootDepartmentId: number }) =>
  request<OrganizationBindingView>(`/api/license/v1/customers/${encodeURIComponent(customerId)}/organization-binding`, { method: 'PUT', body: JSON.stringify(input) });
// ===== 产品 / 应用绑定 =====

export interface ProductView { productId: string; issuerId: string; code: string; displayName: string; supportedCapabilities: string[]; declaredActions: string[]; status: string; rowVersion: number; }
export interface ApplicationBindingView { applicationId: number; basePermissionSnapshotVersion: number; basePermissionSnapshot?: ProjectionRules; }

export const listProducts = (page = 1, size?: number) =>
  request<LicensePage<ProductView>>(`/api/license/v1/products${query({ page, size })}`);
export const createProduct = (input: { issuerId: string; code: string; displayName?: string; supportedCapabilities: string[]; declaredActions: string[] }) =>
  request<ProductView>('/api/license/v1/products', { method: 'POST', body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });
export const getProduct = (productId: string) =>
  request<ProductView>(`/api/license/v1/products/${encodeURIComponent(productId)}`);
export const getApplicationBindings = (productId: string) =>
  request<{ items: ApplicationBindingView[]; rowVersion: number }>(`/api/license/v1/products/${encodeURIComponent(productId)}/application-bindings`);
export const putApplicationBindings = (productId: string, input: { items: ApplicationBindingView[] }, expectedRowVersion: number) =>
  request<{ items: ApplicationBindingView[]; rowVersion: number }>(`/api/license/v1/products/${encodeURIComponent(productId)}/application-bindings`, { method: 'PUT', body: JSON.stringify({ ...input, expectedRowVersion }) });

// ===== 模型 / 方案（对齐 LicenseModelController 实施契约） =====

/** 快照字段定义：保留服务端声明的类型、取值范围及集合/文本限制。 */
export interface ModelFieldDef {
  type: 'INTEGER' | 'BOOLEAN' | 'STRING' | 'STRING_SET';
  required?: boolean;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  maxItems?: number;
  enumValues?: string[];
  unit?: string;
  source?: string;
}
export type RightsValue = number | boolean | string | string[];
export type RightsValues = Record<string, RightsValue>;
export type ModelSubjectKind = 'DEPLOYMENT' | 'PERSON' | 'SERVICE';
export type ModelEligibilityKind = 'ALLOCATED_DEPLOYMENTS' | 'CUSTOMER_MEMBERS' | 'ASSIGNED_SUBJECTS';
export type ModelValidityKind = 'FIXED' | 'PERPETUAL';
export type ModelConnectivityMode = 'ONLINE' | 'OFFLINE' | 'HYBRID';
export type ModelDeviceMode = 'NONE' | 'WEIGHTED' | 'DEVICE_KEY';
export type ModelQuotaKind = 'NAMED_SEAT' | 'CONCURRENT' | 'CONSUMPTION';
export type ModelQuotaEnforcement = 'LOCAL' | 'ONLINE';
export type ModelQuotaWindow = 'TOTAL' | 'FIXED_WINDOW';
export type ModelRevocationMode = 'OPTIONAL' | 'REQUIRED';

export interface ModelSubjectPolicy {
  allowedKinds: ModelSubjectKind[];
  allowedEligibilityKinds: ModelEligibilityKind[];
  offlineProofProfiles: string[];
}
export interface ModelValidityPolicy {
  allowedKinds: ModelValidityKind[];
  minimumStartsAt: number | null;
  maximumStartsAt: number | null;
  minimumDurationSeconds: number | null;
  maximumDurationSeconds: number | null;
  maximumGraceSeconds: number | null;
  graceActions: string[];
}
export interface ModelConnectivityPolicy {
  allowedModes: ModelConnectivityMode[];
  refreshIntervalSeconds?: number;
  leaseDurationSeconds?: number;
  outageDurationSeconds?: number;
  outageActions?: string[];
}
export interface ModelClockPolicy { skewSeconds: number; rollbackToleranceSeconds: number; }
export interface ModelWeightedDevicePolicy {
  mode: 'WEIGHTED'; profileVersion: 'hardware/1'; components: Record<string, number>;
  minimumAvailableWeight: number; maximumMismatchWeight: number;
}
export interface ModelDeviceKeyPolicy { mode: 'DEVICE_KEY'; requireHardwareBacked: boolean; }
export type ModelDevicePolicy = { mode: 'NONE' } | ModelWeightedDevicePolicy | ModelDeviceKeyPolicy;
export type ModelOrganizationPolicy = { required: false } | { required: true; maxObservationAgeSeconds: number; membershipLeaseSeconds: number };
export interface ModelQuotaDefinition {
  limitRight: number; kind: ModelQuotaKind; enforcement: ModelQuotaEnforcement;
  window?: ModelQuotaWindow; periodSeconds?: number; maxReservationSeconds?: number;
}
export interface ModelRevocationPolicy { mode: ModelRevocationMode; maxAgeSeconds?: number; }
export interface ModelPolicies {
  subjectPolicy: ModelSubjectPolicy;
  validityPolicy: ModelValidityPolicy;
  connectivityPolicy: ModelConnectivityPolicy;
  clockPolicy: ModelClockPolicy;
  devicePolicy: ModelDevicePolicy;
  organizationPolicy: ModelOrganizationPolicy;
  quotaDefinitions: Record<string, ModelQuotaDefinition>;
  quotaConstraints: Record<string, string[]>;
  revocationPolicy: ModelRevocationPolicy;
  requiredCapabilities: string[];
}
/** 模型快照：字段声明（rights/facts）+动作→条件树（节点恰一键：all/any/not/bool/compare/member）。 */
export interface ModelSnapshot extends Partial<ModelPolicies> {
  fields: { rights: Record<string, ModelFieldDef>; facts: Record<string, ModelFieldDef> };
  actions: Record<string, TreeNode>;
}
/** 条件树节点联合（wire 恰一形态键）。 */
export type TreeNode =
  | { all: TreeNode[] }
  | { any: TreeNode[] }
  | { not: TreeNode }
  | { bool: boolean }
  | { compare: { operator: CompareOp; left: OperandNode; right: OperandNode } }
  | { member: { value: OperandNode; set: OperandNode } };
export type CompareOp = 'EQ' | 'NE' | 'LT' | 'LTE' | 'GT' | 'GTE';
/** 操作数：字段引用（namespace.field）或字面量（整数/布尔/文本/文本集合）。 */
export type OperandNode =
  | { ref: string }
  | { literal: number | boolean | string | string[] };

export interface ModelVersionView {
  modelVersionId: string; modelId: string; productId: string; version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED' | string;
  fieldsSummary: string; actionsSummary: string; rowVersion: number;
}
export type ModelVersionDetail = ModelVersionView & { snapshot: ModelSnapshot };

export const listModels = (productId: string) =>
  request<LicensePage<ModelVersionView>>(`/api/license/v1/models${query({ productId })}`);
export const createModel = (productId: string, snapshot: ModelSnapshot) =>
  request<ModelVersionView>('/api/license/v1/models', {
    method: 'POST',
    body: JSON.stringify({ productId, snapshot }),
    idempotencyKey: crypto.randomUUID()
  });
export const getModelVersion = (modelVersionId: string) =>
  request<ModelVersionDetail>(`/api/license/v1/model-versions/${encodeURIComponent(modelVersionId)}`);
export const patchDraftSnapshot = (modelVersionId: string, snapshot: ModelSnapshot, expectedRowVersion: number) =>
  request<ModelVersionView>(`/api/license/v1/model-versions/${encodeURIComponent(modelVersionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ snapshot, expectedRowVersion })
  });
export const publishModelVersion = (modelVersionId: string, expectedRowVersion: number) =>
  request<ModelVersionView>(`/api/license/v1/model-versions/${encodeURIComponent(modelVersionId)}/publication`, {
    method: 'PUT',
    body: JSON.stringify({ expectedRowVersion })
  });
export const retireModelVersion = (modelVersionId: string, expectedRowVersion: number) =>
  request<ModelVersionView>(`/api/license/v1/model-versions/${encodeURIComponent(modelVersionId)}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'RETIRED', expectedRowVersion })
  });
/** 受限试算：草稿/已发布快照+假设权益/事实，只判声明不签发（返回 declared）。 */
export const evaluateModelAction = (modelVersionId: string, action: string,
                                    rights: RightsValues,
                                    facts: RightsValues) =>
  request<{ action: string; declared: boolean }>(`/api/license/v1/model-versions/${encodeURIComponent(modelVersionId)}/evaluations`, {
    method: 'POST',
    body: JSON.stringify({ action, rights, facts })
  });

export const listPlans = (productId?: string) =>
  request<LicensePage<PlanVersionView>>(`/api/license/v1/plans${query({ productId })}`);
export interface PlanVersionView {
  planVersionId: string; planId: string; productId: string; modelVersionId: string;
  version: number; status: 'DRAFT' | 'PUBLISHED' | string; rowVersion: number;
}
export type PlanVersionDetail = PlanVersionView & { prefillRights: RightsValues };
export const createPlan = (productId: string, modelVersionId: string, prefillRights: RightsValues) =>
  request<PlanVersionView>('/api/license/v1/plans', {
    method: 'POST',
    body: JSON.stringify({ productId, modelVersionId, prefillRights }),
    idempotencyKey: crypto.randomUUID()
  });
export const getPlanVersion = (planVersionId: string) =>
  request<PlanVersionDetail>(`/api/license/v1/plan-versions/${encodeURIComponent(planVersionId)}`);
export const patchPlanPrefill = (planVersionId: string, prefillRights: RightsValues, expectedRowVersion: number) =>
  request<PlanVersionView>(`/api/license/v1/plan-versions/${encodeURIComponent(planVersionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ prefillRights, expectedRowVersion })
  });
export const publishPlanVersion = (planVersionId: string, expectedRowVersion: number) =>
  request<PlanVersionView>(`/api/license/v1/plan-versions/${encodeURIComponent(planVersionId)}/publication`, {
    method: 'PUT',
    body: JSON.stringify({ expectedRowVersion })
  });

// ===== 客户授权 / 修订 =====

export interface GrantView {
  grantId: string; customerId: string; productId: string; subjectKind: string; eligibilityKind: string;
  mode: string; state: string; grantRevision: number; grantStateVersion: number;
  businessOrderRef: string | null; rowVersion: number;
  modelVersionId?: string | null; rights?: RightsValues;
  limiterPolicies?: LimiterPolicyInput[];
  validity?: { kind: 'FIXED' | 'PERPETUAL'; startsAt: number; serviceUntil?: number; commercialGraceUntil?: number };
}

export type LimiterPolicyUnit = 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS';
export interface LimiterPolicyLimit { count: number; window: number; unit: LimiterPolicyUnit; }
export interface LimiterPolicyInput { serviceCode: string; resourceCode: string; limits: LimiterPolicyLimit[]; }

export const listGrants = (page = 1, filters: { customerId?: string; productId?: string } = {}) =>
  request<LicensePage<GrantView>>(`/api/license/v1/grants${query({ page, ...filters })}`);
export const getGrant = (grantId: string) =>
  request<GrantView>(`/api/license/v1/grants/${encodeURIComponent(grantId)}`);
export const createGrant = (input: { customerId: string; productId: string; subjectKind: string; eligibilityKind?: string; offlineProofProfile?: string; mode: string; businessOrderRef?: string; modelVersionId?: string; rights?: RightsValues; limiterPolicies?: LimiterPolicyInput[];
  validity?: { kind: 'FIXED' | 'PERPETUAL'; startsAt: number; serviceUntil?: number; commercialGraceUntil?: number } }) =>
  request<GrantView>('/api/license/v1/grants', { method: 'POST', body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });
export const createGrantRevision = (grantId: string, input: Record<string, unknown>, expectedRowVersion: number) =>
  request<GrantView>(`/api/license/v1/grants/${encodeURIComponent(grantId)}/revisions`, { method: 'POST', body: JSON.stringify({ ...input, expectedRowVersion }) });
export const patchGrantState = (grantId: string, input: { state: 'ENABLED' | 'SUSPENDED' }, expectedRowVersion: number) =>
  request<GrantView>(`/api/license/v1/grants/${encodeURIComponent(grantId)}/state`, { method: 'PATCH', body: JSON.stringify({ ...input, expectedRowVersion }) });

// ===== 固定资格 / 实名 =====

export interface SubjectAssignmentView { assignmentId: string; grantId: string; subjectRef: { kind: string; sourceId: string; subjectId: string }; assignmentGeneration: number; state: string; metrics: string[]; retention: string; rowVersion: number; }

export const listSubjectAssignments = (grantId: string, page = 1) =>
  request<LicensePage<SubjectAssignmentView>>(`/api/license/v1/grants/${encodeURIComponent(grantId)}/subject-assignments${query({ page })}`);
export const createSubjectAssignment = (grantId: string, input: { grantRevision: number; subjectKind: string; sourceId: string; subjectId: string; requestedNamedMetrics?: string[] }) =>
  request<SubjectAssignmentView>(`/api/license/v1/grants/${encodeURIComponent(grantId)}/subject-assignments`, { method: 'POST', body: JSON.stringify(input) });
export const patchSubjectAssignmentState = (assignmentId: string, input: { state: 'ACTIVE' | 'SUSPENDED' }, expectedRowVersion: number) =>
  request<SubjectAssignmentView>(`/api/license/v1/subject-assignments/${encodeURIComponent(assignmentId)}/state`, { method: 'PATCH', body: JSON.stringify({ ...input, expectedRowVersion }) });
export const replaceSubjectAssignment = (assignmentId: string, input: { expectedRowVersion: number; sourceId: string; subjectId: string }) =>
  request<never>(`/api/license/v1/subject-assignments/${encodeURIComponent(assignmentId)}/replacements`, { method: 'POST', body: JSON.stringify(input) });
export const replaceActivation = (activationId: string, input: { expectedRowVersion: number; callerBinding?: ActivationCallerBinding; reasonCategory?: string }) =>
  request<ActivationView>(`/api/license/v1/activations/${encodeURIComponent(activationId)}/replacements`, { method: 'POST', body: JSON.stringify(input) });

export const addNamedSeatAllocations = (assignmentId: string, input: { expectedRowVersion: number; grantRevision: number; requestedNamedMetrics: string[] }) =>
  request<SubjectAssignmentView>(`/api/license/v1/subject-assignments/${encodeURIComponent(assignmentId)}/named-seat-allocations`, { method: 'POST', body: JSON.stringify(input) });

// ===== 部署激活 =====

export interface ActivationCallerBinding { sourceId: string; subjectId: string; }
/** 部署激活的当前额度快照；数量是该部署当前获准总额，不是历史凭据数量累加。 */
export interface ActivationAllocationView {
  allocationId: string;
  metric: string;
  quantity: number;
  grantRevision: number;
  retention: 'FIXED' | 'PERPETUAL' | string;
  retainUntil?: number;
  windowAnchorAt?: number | null;
}
export interface ActivationView {
  activationId: string; deploymentCode: string; grantId: string; state: string; activationGeneration: number;
  callerBinding: ActivationCallerBinding | null; deviceBindingMode: 'NONE';
  requestedAllocations: ActivationAllocationView[]; rowVersion: number;
}
export interface ActivationAllocationInput {
  metric: string;
  quantity: number;
  retention: 'FIXED' | 'PERPETUAL';
  retainUntil?: number;
}

export const listActivations = (grantId: string, page = 1) =>
  request<LicensePage<ActivationView>>(`/api/license/v1/grants/${encodeURIComponent(grantId)}/activations${query({ page })}`);
export const createActivation = (grantId: string, input: {
  deploymentCode: string;
  callerBinding?: ActivationCallerBinding;
  requestedAllocations?: ActivationAllocationInput[];
}) =>
  request<ActivationView>(`/api/license/v1/grants/${encodeURIComponent(grantId)}/activations`, { method: 'POST', body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });
export const patchActivationState = (activationId: string, input: { state: 'ACTIVE' | 'SUSPENDED' }, expectedRowVersion: number) =>
  request<ActivationView>(`/api/license/v1/activations/${encodeURIComponent(activationId)}/state`, { method: 'PATCH', body: JSON.stringify({ ...input, expectedRowVersion }) });
export const patchActivationCallerBinding = (activationId: string, input: { expectedRowVersion: number; callerBinding: ActivationCallerBinding }) =>
  request<ActivationView>(`/api/license/v1/activations/${encodeURIComponent(activationId)}/caller-binding`, { method: 'PATCH', body: JSON.stringify(input) });

// ===== 凭据交付 / 协作任务 =====

/** 凭据列表只返回元数据；原文只通过 /content 且 READY 时交付。 */
export interface CredentialMetaView {
  operationId: string; credentialId: string; grantId: string; state: string; status: string;
  executionGeneration: number; rowVersion: number; lastKmsCallAt?: number | null;
  reasonCategory?: string | null; resultResource?: string | null; activationId?: string;
}
/** status 枚举：PENDING_SIGN/SIGNING/READY/UNCERTAIN/ABANDONED/REJECTED（服务端演进期保持 string，消费侧自行判别）。 */
export interface OperationRow { operationId: string; credentialId: string; grantId: string; state: string; status?: string; executionGeneration: number; rowVersion: number; lastKmsCallAt?: string | null; reasonCategory: string | null; resultResource: string | null; }

export const listCredentials = (page = 1, filters: { grantId?: string; activationId?: string } = {}) =>
  request<LicensePage<CredentialMetaView>>(`/api/license/v1/credentials${query({ page, ...filters })}`);
export const getCredentialContent = (credentialId: string) =>
  request<{ credentialId: string; compactJws: string }>(`/api/license/v1/credentials/${encodeURIComponent(credentialId)}/content`);
/** 离线签发绑定精确子对象及其当前代数，不把来源编号或缺省代数当资格证明。 */
export type CredentialSubjectBinding =
  | { kind: 'DEPLOYMENT'; activationId: string; activationGeneration: number }
  | { kind: 'PERSON' | 'SERVICE'; sourceId: string; subjectId: string; assignmentId: string; assignmentGeneration: number };
export const requestCredentialIssuance = (grantId: string, input: { kid: string; subjectRef: CredentialSubjectBinding }, idempotencyKey: string = crypto.randomUUID()) =>
  request<OperationRow>(`/api/license/v1/grants/${encodeURIComponent(grantId)}/credentials`, { method: 'POST', body: JSON.stringify(input), idempotencyKey });
export const getOperation = (operationId: string) =>
  request<OperationRow>(`/api/license/v1/operations/${encodeURIComponent(operationId)}`);
export const listOperations = (page = 1, filters: { grantId?: string } = {}) =>
  request<LicensePage<OperationRow>>(`/api/license/v1/operations${query({ page, ...filters })}`);
export const recoverOperation = (operationId: string, input: { expectedRowVersion: number; expectedExecutionGeneration?: number; reasonCategory?: string }) =>
  request<OperationRow>(`/api/license/v1/operations/${encodeURIComponent(operationId)}/recoveries`, { method: 'POST', body: JSON.stringify(input) });
export const abandonOperation = (operationId: string, input: { expectedRowVersion: number; reasonCategory?: string }) =>
  request<OperationRow>(`/api/license/v1/operations/${encodeURIComponent(operationId)}/abandonments`, { method: 'POST', body: JSON.stringify(input) });

// ===== 吊销 / 吊销批次 =====

export interface RevocationView { targetKind: string; targetId: string; reasonCategory: string; revokedAt: number; }
export interface RevocationPackageView { packageId: string; sequence: number; status: string; manifestDigest: string | null; }

export const listRevocations = (page = 1, filters: { targetKind?: string; targetId?: string } = {}) =>
  request<LicensePage<RevocationView>>(`/api/license/v1/revocations${query({ page, ...filters })}`);
export const createRevocation = (input: { targetKind: string; targetId: string; reasonCategory: string; expectedRowVersion: number }) =>
  request<RevocationView>('/api/license/v1/revocations', { method: 'POST', body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });
export const createRevocationPackage = (productId: string) =>
  request<OperationRow>(`/api/license/v1/products/${encodeURIComponent(productId)}/revocation-packages`, { method: 'POST', body: JSON.stringify({}), idempotencyKey: crypto.randomUUID() });
export const getRevocationPackage = (packageId: string) =>
  request<RevocationPackageView>(`/api/license/v1/revocation-packages/${encodeURIComponent(packageId)}`);

// ===== 签名档案 / 信任资料 =====

export interface SigningProfileView { profileId: string; productId: string; purpose: string; kid: string; status: string; rowVersion: number; publicKeyFingerprint: string; createdAt: string | null; retiredAt: string | null; }

export const listSigningProfiles = (page = 1, status = 'ACTIVE') =>
  request<LicensePage<SigningProfileView>>(`/api/license/v1/signing-profiles${query({ page, status })}`);
export const createSigningProfile = (input: { productId: string; purpose: string; kid: string; keyRef: string; keyVersion: number; expectedProfileId?: string; expectedRowVersion?: number }) =>
  request<SigningProfileView>('/api/license/v1/signing-profiles', { method: 'POST', body: JSON.stringify(input), idempotencyKey: crypto.randomUUID() });
export const getTrustMaterial = (productId: string) =>
  request<{ keys: Array<{ kid: string; purpose: string; trustVersion: number; status: string }> }>(`/api/license/v1/products/${encodeURIComponent(productId)}/trust-material`);

// ===== 协作命令（角色联动清单） =====

/** 角色联动仅提交批准的精确三权规则，不把商业动作推导为应用权限。 */
export interface ProjectionDataGrant {
  resource: string; actions: string[]; all: boolean;
  constraints: Array<{ dimension: string; operator: 'IN'; values: string[] }>;
}
export interface ProjectionRules {
  pagePermissions: string[]; apiPermissions: string[];
  dataGrantTemplate: { protocol: 'simple-data-permission'; version: '1.0'; grants: ProjectionDataGrant[] } | null;
}
export interface IntegrationPlanView {
  planId: string; commandId: string; customerId: string; productId: string; applicationId: string;
  desiredRevision: number; state: string; executionMode: 'MANUAL' | 'AUTO'; validUntil: number; planValidUntil: number;
  confirmedRevision: number | null; failureReason: string | null; rowVersion: number;
  projectionId: string; externalId: string; organizationInstanceId: string; bindingGeneration: number; rootDepartmentId: number;
  manifestVersion: number; manifestDigest: string; contributionPresent: boolean;
  contributions: Array<{ grantId: string; grantRevision: number; grantStateVersion: number }>;
  approvedRules: ProjectionRules; desiredRules: ProjectionRules; targetDepartmentIds: number[];
  departmentDiff: { toMount: number[]; toUnmount: number[] }; openRoleId?: string; remoteRevision?: number;
}
export type IntegrationCommandView = IntegrationPlanView;
export interface ProjectionConfirmation {
  expectedRevision: number; organizationInstanceId: string; bindingGeneration: number; openRoleId?: string;
}

export const listIntegrationCommands = (page = 1) =>
  request<LicensePage<IntegrationCommandView>>(`/api/license/v1/integration-commands${query({ page })}`);
export const getIntegrationCommand = (commandId: string) =>
  request<IntegrationPlanView>(`/api/license/v1/integration-commands/${encodeURIComponent(commandId)}`);
export const createIntegrationPlan = (productId: string, input: { customerId: string; applicationId: string; desiredRules?: ProjectionRules }, idempotencyKey: string = crypto.randomUUID()) =>
  request<IntegrationPlanView>(`/api/license/v1/products/${encodeURIComponent(productId)}/role-projection-plans`, {
    method: 'POST', body: JSON.stringify(input), idempotencyKey
  });
export const createIntegrationAttempt = (commandId: string, executionMode: 'MANUAL' | 'AUTO' = 'MANUAL', idempotencyKey: string = crypto.randomUUID()) =>
  request<IntegrationCommandView>(`/api/license/v1/integration-commands/${encodeURIComponent(commandId)}/attempts`, {
    method: 'POST',
    // 后端约定空体即 MANUAL；只有明确选择 AUTO 才写入模式，避免把刷新误当成远端执行。
    ...(executionMode === 'AUTO' ? { body: JSON.stringify({ executionMode }) } : {}),
    idempotencyKey
  });

export const getIntegrationPlan = (planId: string) =>
  request<IntegrationPlanView>(`/api/license/v1/role-projection-plans/${encodeURIComponent(planId)}`);

export const confirmIntegrationPlan = (planId: string, input: ProjectionConfirmation) =>
  request<IntegrationPlanView>(`/api/license/v1/role-projection-plans/${encodeURIComponent(planId)}/confirmations`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
export const reconcileIntegrationCommand = (commandId: string, input: ProjectionConfirmation & { priorCallTerminated: true }) =>
  request<IntegrationPlanView>(`/api/license/v1/integration-commands/${encodeURIComponent(commandId)}/reconciliations`, { method: 'POST', body: JSON.stringify(input) });
export const reconfirmIntegrationEnvironment = (productId: string, input: { customerId: string; applicationId: string; organizationInstanceId: string; bindingGeneration: number; desiredRules?: ProjectionRules; priorCallTerminated: true }) =>
  request<IntegrationPlanView>(`/api/license/v1/products/${encodeURIComponent(productId)}/role-projection-reconfirmations`, { method: 'POST', body: JSON.stringify(input) });
