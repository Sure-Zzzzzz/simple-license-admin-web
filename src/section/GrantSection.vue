<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import {
  createGrant, getModelVersion, getPlanVersion, listActivations, listCustomers, listGrants, listModels, listPlans,
  listProducts, listSigningProfiles, patchGrantState, requestCredentialIssuance,
  listSubjectAssignments, type ActivationView, type CredentialSubjectBinding, type GrantView,
  type ModelPolicies, type ModelVersionView, type PlanVersionView, type SigningProfileView, type SubjectAssignmentView
} from '../api/domain';
import type { LicensePage } from '../api/http';
import RightsFieldsEditor from './RightsFieldsEditor.vue';
import { createRightsFields, serializeRightsFields, type RightsFieldInput } from '../ui/rightsFields';
import { canApi, canPage } from '../auth/permissions';
import { captureLicenseSession } from '../ui/sessionFence';
import { policiesFromSnapshot, policySummary, validateModelPolicies } from '../ui/modelPolicies';
import LimiterPolicyEditor from './LimiterPolicyEditor.vue';
import { serializeLimiterPolicies, validateLimiterPolicies } from '../ui/limiterPolicies';

const props = defineProps<{ section: string }>();
const router = useRouter();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const createOpen = ref(false);
const page = ref(1);
type GrantPage = { data: GrantView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as GrantPage);
const filters = reactive({ customerId: '', productId: '' });

// 先选对象种类与资格政策，再出对应表单（DESIGN.SUBJECTS §8：不要求人员填设备 SN）
const form = reactive({
  customerId: '', productId: '', modelVersionId: '', planVersionId: '', mode: 'ONLINE',
  subjectKind: 'PERSON', eligibilityKind: 'CUSTOMER_MEMBERS',
  offlineProofProfile: '', businessOrderRef: '',
  startsAt: '', serviceUntil: '', commercialGraceUntil: '', perpetual: false,
  deploymentLimit: 1
});
const limiterPolicies = ref<import('../api/domain').LimiterPolicyInput[]>([]);

// 模型/方案联动：选产品→拉已发布模型与方案；选模型→按 rights 声明出权益输入；选方案→预填
const publishedModels = ref<ModelVersionView[]>([]);
const publishedPlans = ref<PlanVersionView[]>([]);
const rightFields = ref<RightsFieldInput[]>([]);
const selectedModelPolicies = ref<ModelPolicies | null>(null);
const rightsLoading = ref(false);
const choicesLoading = ref(false);
const rightsReady = ref(true);
const createErrorMessage = ref('');
let choicesRequest = 0;
let rightsRequest = 0;
let createSession = captureLicenseSession();

const modelOptions = computed(() => [
  { value: '', label: '请选择已发布模型' },
  ...publishedModels.value.map(model => ({
    value: model.modelVersionId,
    label: `${model.modelVersionId.slice(0, 12)}… (v${model.version})`
  }))
]);

const planOptions = computed(() => [
  { value: '', label: '不使用方案预填' },
  ...publishedPlans.value.map(plan => ({
    value: plan.planVersionId,
    label: `${plan.planVersionId.slice(0, 12)}…`
  }))
]);

async function loadModelChoices() {
  const request = ++choicesRequest;
  ++rightsRequest;
  const productId = form.productId;
  form.modelVersionId = '';
  form.planVersionId = '';
  rightFields.value = [];
  selectedModelPolicies.value = null;
  rightsReady.value = true;
  rightsLoading.value = false;
  createErrorMessage.value = '';
  publishedModels.value = [];
  publishedPlans.value = [];
  choicesLoading.value = false;
  if (!productId) return;
  choicesLoading.value = true;
  try {
    const emptyPage = { data: [], total: 0, page: 1, size: 20, totalPages: 0 };
    const [models, plans] = await Promise.all([
      canApi('license.model.read') ? listModels(productId) : emptyPage,
      canApi('license.plan.read') && canApi('license.model.read') ? listPlans(productId) : emptyPage
    ]);
    if (request !== choicesRequest || !createOpen.value) return;
    publishedModels.value = models.data.filter(item => item.status === 'PUBLISHED');
    publishedPlans.value = plans.data.filter(item => item.status === 'PUBLISHED');
  } catch (error) {
    if (request === choicesRequest && createOpen.value) {
      rightsReady.value = false;
      createErrorMessage.value = error instanceof Error ? error.message : '模型和方案候选读取失败，请重试。';
    }
  } finally {
    if (request === choicesRequest) choicesLoading.value = false;
  }
}

async function onModelChange(value: string | number) {
  if (String(value) && !canApi('license.model.read')) return;
  const request = ++rightsRequest;
  form.modelVersionId = String(value);
  form.planVersionId = '';
  createErrorMessage.value = '';
  rightsReady.value = !form.modelVersionId;
  rightsLoading.value = false;
  rightFields.value = [];
  if (!form.modelVersionId) return;
  rightsLoading.value = true;
  try {
    const detail = await getModelVersion(form.modelVersionId);
    if (request !== rightsRequest || !createOpen.value) return;
    if (detail.productId !== form.productId || detail.status !== 'PUBLISHED') throw new Error('请选择当前产品的已发布模型。');
    rightFields.value = createRightsFields(detail.snapshot.fields.rights ?? {});
    applyModelPolicy(detail.snapshot);
    rightsReady.value = true;
  } catch (error) {
    if (request === rightsRequest && createOpen.value) createErrorMessage.value = error instanceof Error ? error.message : '模型声明读取失败，请重试。';
  } finally {
    if (request === rightsRequest) rightsLoading.value = false;
  }
}

async function onPlanChange(value: string | number) {
  if (String(value) && (!canApi('license.plan.read') || !canApi('license.model.read'))) return;
  const request = ++rightsRequest;
  form.planVersionId = String(value);
  createErrorMessage.value = '';
  if (!form.planVersionId) {
    await onModelChange(form.modelVersionId);
    return;
  }
  rightsReady.value = false;
  rightsLoading.value = true;
  try {
    const plan = await getPlanVersion(form.planVersionId);
    if (request !== rightsRequest || !createOpen.value) return;
    if (plan.productId !== form.productId || plan.status !== 'PUBLISHED') throw new Error('请选择当前产品的已发布方案。');
    const model = await getModelVersion(plan.modelVersionId);
    if (request !== rightsRequest || !createOpen.value) return;
    if (model.productId !== form.productId || model.status !== 'PUBLISHED') throw new Error('方案引用模型已不可用于新授权，请重新选择。');
    const fields = createRightsFields(model.snapshot.fields.rights ?? {}, plan.prefillRights ?? {});
    form.modelVersionId = plan.modelVersionId;
    rightFields.value = fields;
    applyModelPolicy(model.snapshot);
    rightsReady.value = true;
  } catch (error) {
    if (request === rightsRequest && createOpen.value) createErrorMessage.value = error instanceof Error ? error.message : '方案预填读取失败，请重试。';
  } finally {
    if (request === rightsRequest) rightsLoading.value = false;
  }
}

function openCreate() {
  if (!canApi('license.grant.manage')) return;
  createSession = captureLicenseSession();
  limiterPolicies.value = [];
  createOpen.value = true;
  void loadModelChoices();
}

function closeCreate() {
  if (submitting.value) return;
  ++choicesRequest;
  ++rightsRequest;
  createOpen.value = false;
  choicesLoading.value = false;
  rightsLoading.value = false;
}

function retryRights() {
  if (form.planVersionId) void onPlanChange(form.planVersionId);
  else if (form.modelVersionId) void onModelChange(form.modelVersionId);
  else void loadModelChoices();
}

const allSubjectKinds = [
  { value: 'DEPLOYMENT', label: '部署' },
  { value: 'PERSON', label: '人员' },
  { value: 'SERVICE', label: '服务' }
];

const allModes = [
  { value: 'ONLINE', label: '在线' },
  { value: 'OFFLINE', label: '离线' },
  { value: 'HYBRID', label: '混合' }
];

// 表格列声明（契约 DataTable：单元格内容走 #cell-{key} 插槽）
const grantColumns: DataTableColumn[] = [
  { key: 'grantId', label: '授权编号', nowrap: true },
  { key: 'customerProduct', label: '客户 / 产品', nowrap: true },
  { key: 'profile', label: '对象 · 资格 · 模式', nowrap: true },
  { key: 'state', label: '状态' },
  { key: 'revision', label: '修订' },
  { key: 'actions', label: '操作' }
];

const eligibilityOptions = computed(() => {
  const allowed = selectedModelPolicies.value?.subjectPolicy.allowedEligibilityKinds;
  const values = form.subjectKind === 'DEPLOYMENT' ? ['ALLOCATED_DEPLOYMENTS'] : form.subjectKind === 'SERVICE' ? ['ASSIGNED_SUBJECTS'] : ['CUSTOMER_MEMBERS', 'ASSIGNED_SUBJECTS'];
  return values.filter(value => !allowed || allowed.includes(value as never)).map(value => ({
    value, label: value === 'ALLOCATED_DEPLOYMENTS' ? '部署分配' : value === 'CUSTOMER_MEMBERS' ? '客户当前成员' : '固定资格名单'
  }));
});

const subjectKinds = computed(() => {
  const allowed = selectedModelPolicies.value?.subjectPolicy.allowedKinds;
  return allSubjectKinds.filter(option => !allowed || allowed.includes(option.value as never));
});
const modes = computed(() => {
  const allowed = selectedModelPolicies.value?.connectivityPolicy.allowedModes;
  return allModes.filter(option => !allowed || allowed.includes(option.value as never));
});
const selectedPolicySummary = computed(() => selectedModelPolicies.value ? policySummary(selectedModelPolicies.value) : []);
const selectedPolicyErrors = computed(() => selectedModelPolicies.value ? validateModelPolicies(selectedModelPolicies.value) : []);

function applyModelPolicy(snapshot: import('../api/domain').ModelSnapshot) {
  const state = policiesFromSnapshot(snapshot);
  selectedModelPolicies.value = state.legacy ? null : state.policies;
  if (state.legacy) return;
  if (!state.policies.subjectPolicy.allowedKinds.includes(form.subjectKind as never)) form.subjectKind = state.policies.subjectPolicy.allowedKinds[0] ?? form.subjectKind;
  if (!state.policies.connectivityPolicy.allowedModes.includes(form.mode as never)) form.mode = state.policies.connectivityPolicy.allowedModes[0] ?? form.mode;
  if (!state.policies.subjectPolicy.allowedEligibilityKinds.includes(form.eligibilityKind as never)) form.eligibilityKind = state.policies.subjectPolicy.allowedEligibilityKinds[0] ?? form.eligibilityKind;
}


const needsOfflineProfile = computed(() =>
  form.mode !== 'ONLINE' && form.eligibilityKind === 'ASSIGNED_SUBJECTS' && form.subjectKind !== 'DEPLOYMENT');

const validity = computed(() => {
  if (form.perpetual) {
    return { kind: 'PERPETUAL', startsAt: Math.floor(new Date(form.startsAt).getTime() / 1000) };
  }
  return {
    kind: 'FIXED',
    startsAt: Math.floor(new Date(form.startsAt).getTime() / 1000),
    serviceUntil: Math.floor(new Date(form.serviceUntil).getTime() / 1000),
    commercialGraceUntil: Math.floor(new Date(form.commercialGraceUntil).getTime() / 1000)
  };
});

function detailLabel(row: GrantView): string {
  return row.subjectKind === "DEPLOYMENT" ? "部署激活" : "资格名单";
}

function openDetail(row: GrantView): void {
  if (!canGrantDetail(row)) return;
  const kind = row.subjectKind;
  if (kind === 'DEPLOYMENT') router.push(`/grants/${row.grantId}/activations`);
  else router.push(`/grants/${row.grantId}/subject-assignments`);
}

function canGrantDetail(row: GrantView): boolean {
  return row.subjectKind === 'DEPLOYMENT'
    ? canPage('license.page.activations') && canApi('license.activation.read')
    : canPage('license.page.subject-assignments') && canApi('license.subject-assignment.read');
}

function subjectLabel(kind: string): string {
  return kind === 'DEPLOYMENT' ? '部署' : kind === 'PERSON' ? '人员' : '服务';
}
function eligibilityLabel(kind: string): string {
  return kind === 'ALLOCATED_DEPLOYMENTS' ? '部署分配' : kind === 'CUSTOMER_MEMBERS' ? '客户成员' : '固定名单';
}
function modeLabel(mode: string): string {
  return mode === 'OFFLINE' ? '离线' : mode === 'ONLINE' ? '在线' : '混合';
}
function stateLabel(state: string): string {
  return state === 'ENABLED' ? '生效' : state === 'SUSPENDED' ? '暂停' : state === 'REVOKED' ? '已吊销' : state === 'DRAFT' ? '草稿' : state;
}

// 客户/产品名称映射（管理台走查规模全量拉取；分页治理随数据量增长批次接入）
const customerNames = ref<Record<string, string>>({});
const productNames = ref<Record<string, string>>({});
const namesErrorMessage = ref('');
let active = true;
let pageRequest = 0;
let namesRequest = 0;

const customerOptions = computed(() => Object.entries(customerNames.value).map(([value, label]) => ({ value, label })));
const productOptions = computed(() => Object.entries(productNames.value).map(([value, label]) => ({ value, label })));

async function loadNames() {
  const request = ++namesRequest;
  namesErrorMessage.value = '';
  try {
    const emptyPage = { data: [], total: 0, page: 1, size: 20, totalPages: 0 };
    const [customers, products] = await Promise.all([
      canApi('license.customer.read') ? listCustomers(1, 100) : emptyPage,
      canApi('license.product.read') ? listProducts(1, 100) : emptyPage
    ]);
    if (!active || request !== namesRequest) return;
    const cMap: Record<string, string> = {};
    customers.data.forEach(item => { cMap[item.customerId] = item.displayName; });
    customerNames.value = cMap;
    const pMap: Record<string, string> = {};
    products.data.forEach(item => { pMap[item.productId] = item.displayName; });
    productNames.value = pMap;
  } catch (error) {
    if (active && request === namesRequest) namesErrorMessage.value = error instanceof Error ? error.message : '客户与产品名称读取失败，列表将显示编号。';
  }
}

async function loadPage() {
  const request = ++pageRequest;
  errorMessage.value = ''; loading.value = true;
  try {
    const loaded = await listGrants(page.value, {
      customerId: filters.customerId || undefined, productId: filters.productId || undefined
    }) as GrantPage;
    if (!active || request !== pageRequest) return;
    result.value = loaded;
  } catch (error) {
    if (active && request === pageRequest) errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    if (active && request === pageRequest) loading.value = false;
  }
}

const hasFilter = computed(() => !!(filters.customerId || filters.productId));

// ===== 授权管理动作（启用/暂停/离线签发） =====
async function toggleGrantState(row: GrantView) {
  if (!canApi('license.grant.manage') || !['DRAFT', 'ENABLED', 'SUSPENDED'].includes(row.state)) return;
  if (submitting.value) return;
  const sameSession = captureLicenseSession();
  const current = () => active && sameSession();
  submitting.value = true; errorMessage.value = ''; message.value = '';
  try {
    const next = row.state === 'ENABLED' ? 'SUSPENDED' : 'ENABLED';
    await patchGrantState(row.grantId, { state: next }, row.rowVersion);
    if (!current()) return;
    message.value = next === 'ENABLED' ? '授权已启用。' : '授权已暂停（在线判定即时拒绝）。';
    await loadPage();
  } catch (error) {
    if (current()) errorMessage.value = error instanceof Error ? error.message : '状态变更未完成';
  } finally { if (current()) submitting.value = false; }
}

const issueOpen = ref(false);
const issueGrant = ref<GrantView | null>(null);
const issueForm = reactive({ kid: '', candidateId: '' });
const issueResult = ref('');
const issueErrorMessage = ref('');
const issueLoading = ref(false);
const issueProfiles = ref<SigningProfileView[]>([]);
const issueAssignments = ref<SubjectAssignmentView[]>([]);
const issueActivations = ref<ActivationView[]>([]);
let issueSequence = 0;
let issueSession = captureLicenseSession();
let issueAttempt: { fingerprint: string; key: string } | null = null;

const issueKidOptions = computed(() => issueProfiles.value.map(profile => ({ value: profile.kid, label: profile.kid })));
const issueCandidateOptions = computed(() => issueGrant.value?.subjectKind === 'DEPLOYMENT'
  ? issueActivations.value.map(item => ({ value: item.activationId, label: `${item.deploymentCode} · ${item.activationId} · 代数 ${item.activationGeneration}` }))
  : issueAssignments.value.map(item => ({ value: item.assignmentId, label: `${item.subjectRef.sourceId} / ${item.subjectRef.subjectId} · ${item.assignmentId} · 代数 ${item.assignmentGeneration}` })));

function canIssueGrant(row: GrantView): boolean {
  if (row.mode !== 'OFFLINE' || !canApi('license.grant.issue') || !canApi('license.signing-profile.read')) return false;
  return row.subjectKind === 'DEPLOYMENT'
    ? canApi('license.activation.read')
    : row.eligibilityKind === 'ASSIGNED_SUBJECTS' && canApi('license.subject-assignment.read');
}

function openIssue(row: GrantView) {
  if (!canIssueGrant(row) || row.state !== 'ENABLED') return;
  issueGrant.value = { ...row };
  issueSession = captureLicenseSession();
  Object.assign(issueForm, { kid: '', candidateId: '' });
  issueAttempt = null;
  issueResult.value = '';
  issueOpen.value = true;
  void loadIssueCandidates();
}

function closeIssue() {
  if (submitting.value) return;
  ++issueSequence;
  issueOpen.value = false;
  issueLoading.value = false;
  issueGrant.value = null;
  issueProfiles.value = [];
  issueAssignments.value = [];
  issueActivations.value = [];
  issueAttempt = null;
}

async function loadIssueCandidates() {
  const row = issueGrant.value;
  if (!row || !canIssueGrant(row) || !issueSession()) return;
  const sequence = ++issueSequence;
  issueErrorMessage.value = ''; issueLoading.value = true;
  issueProfiles.value = []; issueAssignments.value = []; issueActivations.value = [];
  Object.assign(issueForm, { kid: '', candidateId: '' });
  const current = () => active && issueOpen.value && sequence === issueSequence && issueSession();
  try {
    const [profiles, candidates] = await Promise.all([
      listSigningProfiles(), row.subjectKind === 'DEPLOYMENT' ? listActivations(row.grantId) : listSubjectAssignments(row.grantId)
    ]);
    if (!current()) return;
    issueProfiles.value = profiles.data.filter(item => Boolean(item.profileId) && item.productId === row.productId && item.purpose === 'CREDENTIAL' && item.status === 'ACTIVE');
    if (row.subjectKind === 'DEPLOYMENT') {
      issueActivations.value = (candidates.data as ActivationView[]).filter(item => item.grantId === row.grantId
        && item.state === 'ACTIVE' && item.deviceBindingMode === 'NONE'
        && Number.isSafeInteger(item.activationGeneration) && item.activationGeneration > 0);
    } else {
      issueAssignments.value = (candidates.data as SubjectAssignmentView[]).filter(item => item.grantId === row.grantId
        && item.state === 'ACTIVE' && item.subjectRef.kind === row.subjectKind
        && Boolean(item.subjectRef.sourceId) && Boolean(item.subjectRef.subjectId)
        && Number.isSafeInteger(item.assignmentGeneration) && item.assignmentGeneration > 0);
    }
    if (!issueProfiles.value.length) throw new Error('当前产品没有可用的凭据签名档案，请先配置档案或核对读取权限。');
    if (!issueCandidateOptions.value.length) throw new Error(row.subjectKind === 'DEPLOYMENT'
      ? '当前授权没有可签发的有效激活，请先完成部署激活。' : '当前授权没有可签发的有效资格，请先登记固定资格。');
    issueForm.kid = issueProfiles.value[0]!.kid;
  } catch (error) {
    if (current()) issueErrorMessage.value = error instanceof Error ? error.message : '签发候选读取失败，请重试。';
  } finally {
    if (current()) issueLoading.value = false;
  }
}

async function submitIssue() {
  const row = issueGrant.value;
  if (!row || !canIssueGrant(row) || !issueSession() || !issueOpen.value || submitting.value || issueResult.value) return;
  issueErrorMessage.value = '';
  if (issueLoading.value || !issueForm.candidateId || !issueProfiles.value.some(item => item.kid === issueForm.kid)) {
    issueErrorMessage.value = '请完整读取签发候选，并选择签名档案与有效对象。';
    return;
  }
  const sequence = issueSequence;
  const current = () => active && issueOpen.value && sequence === issueSequence && issueSession();
  submitting.value = true;
  try {
    let subjectRef: CredentialSubjectBinding;
    if (row.subjectKind === 'DEPLOYMENT') {
      const candidate = issueActivations.value.find(item => item.activationId === issueForm.candidateId);
      if (!candidate) throw new Error('激活已不在当前候选中，请重新读取。');
      subjectRef = { kind: 'DEPLOYMENT', activationId: candidate.activationId, activationGeneration: candidate.activationGeneration };
    } else {
      const candidate = issueAssignments.value.find(item => item.assignmentId === issueForm.candidateId);
      if (!candidate || (candidate.subjectRef.kind !== 'PERSON' && candidate.subjectRef.kind !== 'SERVICE')) throw new Error('资格已不在当前候选中，请重新读取。');
      subjectRef = { kind: candidate.subjectRef.kind, sourceId: candidate.subjectRef.sourceId, subjectId: candidate.subjectRef.subjectId,
        assignmentId: candidate.assignmentId, assignmentGeneration: candidate.assignmentGeneration };
    }
    const input = { kid: issueForm.kid, subjectRef };
    const fingerprint = JSON.stringify({ grantId: row.grantId, ...input });
    // 结果不明时，同一对象及输入沿用原键，避免重复创建签发任务。
    if (!issueAttempt || issueAttempt.fingerprint !== fingerprint) issueAttempt = { fingerprint, key: crypto.randomUUID() };
    const operation = await requestCredentialIssuance(row.grantId, input, issueAttempt.key);
    if (!current()) return;
    issueResult.value = operation.state === 'READY'
      ? `凭据已就绪：${operation.credentialId}，请到凭据交付页面下载。`
      : `签发任务 ${operation.operationId} 当前为 ${operation.state}，请到签发任务页面核对后续结果。`;
  } catch (error) {
    if (current()) issueErrorMessage.value = error instanceof Error ? error.message : '签发结果未确认，请先核对签发任务。';
  } finally { if (current()) submitting.value = false; }
}

function resetFilters() {
  filters.customerId = '';
  filters.productId = '';
  page.value = 1;
  void loadPage();
}

async function submitCreate() {
  if (!canApi('license.grant.manage') || !createOpen.value || !createSession()) return;
  if (!form.modelVersionId) {
    createErrorMessage.value = '请先选择当前产品的已发布模型，再提交授权。';
    return;
  }
  if (submitting.value || choicesLoading.value || rightsLoading.value || !rightsReady.value) {
    createErrorMessage.value = '请先完整读取模型和方案，再提交授权。';
    return;
  }
  if (selectedPolicyErrors.value.length) {
    createErrorMessage.value = `当前模型政策不可用于授权：${selectedPolicyErrors.value[0]}`;
    return;
  }
  const limiterErrors = validateLimiterPolicies(limiterPolicies.value);
  if (limiterErrors.length) {
    createErrorMessage.value = limiterErrors[0]!;
    return;
  }
  createErrorMessage.value = ''; message.value = ''; submitting.value = true;
  const sameSession = createSession;
  const current = () => active && sameSession();
  try {
    // 每份授权关联已发布模型；权益与额度使用同一不可变模型政策。
    const input: Parameters<typeof createGrant>[0] = {
      customerId: form.customerId, productId: form.productId,
      subjectKind: form.subjectKind, mode: form.mode
    };
    input.eligibilityKind = form.eligibilityKind;
    if (needsOfflineProfile.value && form.offlineProofProfile) {
      input.offlineProofProfile = form.offlineProofProfile;
    }
    if (form.modelVersionId) {
      input.modelVersionId = form.modelVersionId;
      input.rights = serializeRightsFields(rightFields.value, true);
    }
    if (form.businessOrderRef) input.businessOrderRef = form.businessOrderRef;
    if (limiterPolicies.value.length) input.limiterPolicies = serializeLimiterPolicies(limiterPolicies.value);
    // 期限业务事实（持久列；不填=装载侧兜底一年+七天宽限）
    if (form.startsAt) {
      const startsAt = Math.floor(new Date(form.startsAt).getTime() / 1000);
      if (form.perpetual) {
        input.validity = { kind: 'PERPETUAL', startsAt };
      } else {
        input.validity = {
          kind: 'FIXED', startsAt,
          serviceUntil: Math.floor(new Date(form.serviceUntil).getTime() / 1000),
          commercialGraceUntil: Math.floor(new Date(form.commercialGraceUntil || form.serviceUntil).getTime() / 1000)
        };
      }
    }
    const created = await createGrant(input);
    if (!current()) return;
    message.value = `授权已创建：${created.grantId}`;
    createOpen.value = false;
    await loadPage();
  } catch (error) {
    if (current()) createErrorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    if (current()) submitting.value = false;
  }
}

onMounted(() => { void loadNames(); void loadPage(); });
onBeforeUnmount(() => { active = false; ++pageRequest; ++namesRequest; ++issueSequence; });
watch(() => props.section, () => { page.value = 1; void loadPage(); });
watch(() => form.subjectKind, () => {
  form.eligibilityKind = eligibilityOptions.value[0]?.value ?? form.eligibilityKind;
});
</script>

<template>
  <section class="license-page">
    <PageHeader title="客户授权" description="客户×产品×对象×模式的商业权益台账">
      <template #actions>
        <button v-if="canApi('license.grant.manage') && canApi('license.customer.read') && canApi('license.product.read')" class="button-primary" type="button" :disabled="submitting" @click="openCreate">
          <Plus :size="15" aria-hidden="true" />新建授权
        </button>
      </template>
    </PageHeader>
    <p v-if="errorMessage" class="license-message danger" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" class="button-secondary" :disabled="loading" @click="() => void loadPage()">重试</button>
    </p>
    <p v-if="message" class="license-message success" role="status">{{ message }}</p>
    <p v-if="namesErrorMessage" class="license-message" role="status"><span>{{ namesErrorMessage }}</span><button type="button" class="button-secondary" :disabled="loading" @click="() => void loadNames()">重读名称</button></p>
    <section class="panel license-data-surface" aria-label="授权列表">
      <header class="data-toolbar">
        <div>
          <h2>授权列表<span>{{ result.total }} 项</span></h2>
          <p>当前授权范围内的商业授权</p>
        </div>
      </header>
      <div class="data-toolbar license-filter-bar">
        <FormSelect
          :model-value="filters.customerId"
          :options="[{ value: '', label: '全部客户' }, ...customerOptions]"
          aria-label="客户筛选"
          @update:model-value="value => { filters.customerId = String(value); page = 1; void loadPage(); }"
        />
        <FormSelect
          :model-value="filters.productId"
          :options="[{ value: '', label: '全部产品' }, ...productOptions]"
          aria-label="产品筛选"
          @update:model-value="value => { filters.productId = String(value); page = 1; void loadPage(); }"
        />
        <button class="button-secondary" type="button" @click="resetFilters">重置</button>
      </div>
      <div :aria-busy="loading">
        <DataTable
          :columns="grantColumns"
          :rows="result.data"
          row-key="grantId"
          :loading="loading"
          :empty-text="hasFilter ? '没有匹配的授权，调整筛选后重试' : '暂无授权（新建后进入草稿）'"
        >
          <template #cell-grantId="{ row }"><code>{{ row.grantId.slice(0, 12) }}…</code></template>
          <template #cell-customerProduct="{ row }">{{ customerNames[row.customerId] || row.customerId }} / {{ productNames[row.productId] || row.productId }}</template>
          <template #cell-profile="{ row }">{{ subjectLabel(row.subjectKind) }} · {{ eligibilityLabel(row.eligibilityKind) }} · {{ modeLabel(row.mode) }}</template>
          <template #cell-state="{ row }">
            <span class="status-badge"
              :class="row.state === 'ENABLED' ? 'success' : row.state === 'SUSPENDED' ? 'warning' : row.state === 'REVOKED' ? 'danger' : 'neutral'"
            >{{ stateLabel(row.state) }}</span>
          </template>
          <template #cell-revision="{ row }">r{{ row.grantRevision }} · v{{ row.grantStateVersion }}</template>
          <template #cell-actions="{ row }">
            <span class="license-table-actions">
              <button v-if="canGrantDetail(row)" class="button-secondary" type="button" @click="openDetail(row)">{{ detailLabel(row) }}</button>
              <button v-if="canApi('license.grant.manage')" class="button-secondary" type="button" :disabled="submitting || !['DRAFT', 'ENABLED', 'SUSPENDED'].includes(row.state)" @click="() => void toggleGrantState(row)">{{ row.state === 'ENABLED' ? '暂停' : '启用' }}</button>
              <button v-if="canIssueGrant(row)" class="button-secondary" type="button" :disabled="submitting || row.state !== 'ENABLED'" @click="openIssue(row)">签发凭据</button>
              <span v-if="row.mode === 'ONLINE'" class="license-hint">通过在线判定使用</span>
              <span v-else-if="row.mode === 'HYBRID'" class="license-hint">支持在线判定，暂不提供租约交付</span>
            </span>
          </template>
        </DataTable>
        <Pagination
          :current="page"
          :total="result.total"
          :page-size="20"
          :page-size-options="[20]"
          @update:current="value => { page = value; void loadPage(); }"
        />
      </div>
    </section>
    <Drawer :open="issueOpen" title="签发离线凭据" description="从当前授权的有效资格或激活中选择签发对象，按当前代数提交。" :pending="submitting" @close="closeIssue">
        <form class="drawer-form license-issue-editor" @submit.prevent="() => void submitIssue()">
          <p v-if="issueErrorMessage" class="license-message danger" role="alert"><span>{{ issueErrorMessage }}</span><button v-if="!issueAttempt" type="button" class="button-secondary" :disabled="issueLoading || submitting" @click="() => void loadIssueCandidates()">重读候选</button></p>
          <p v-if="issueLoading" class="license-hint" role="status">正在读取签名档案和有效对象…</p>
          <div class="license-field">
            <span>签名档案 kid</span>
            <FormSelect v-model="issueForm.kid" :options="issueKidOptions" aria-label="签名档案 kid" :disabled="submitting || issueLoading || !!issueResult" />
          </div>
          <div class="license-field">
            <span>{{ issueGrant?.subjectKind === 'DEPLOYMENT' ? '有效激活' : '有效资格' }}</span>
            <FormSelect v-model="issueForm.candidateId" :options="issueCandidateOptions" :aria-label="issueGrant?.subjectKind === 'DEPLOYMENT' ? '有效激活' : '有效资格'" :disabled="submitting || issueLoading || !!issueResult" />
          </div>
          <p class="license-hint">来源、主体、子对象编号与代数均来自服务端记录。状态变化或代数冲突时重新回读，不能手填绕过资格。</p>
          <p v-if="issueResult" class="license-message success" role="status">{{ issueResult }}</p>
          <div class="drawer-actions">
            <button type="button" class="button-secondary" :disabled="submitting" @click="closeIssue">关闭</button>
            <button v-if="canApi('license.grant.issue')" type="submit" class="button-primary" :disabled="submitting || issueLoading || !issueForm.kid || !issueForm.candidateId || !!issueResult">{{ submitting ? '签发中…' : '签发' }}</button>
          </div>
        </form>
    </Drawer>
    <Drawer :open="createOpen" title="新建授权" description="为客户配置产品、授权对象与商业权益。" :pending="submitting" @close="closeCreate">
        <form class="drawer-form license-grant-editor" @submit.prevent="() => void submitCreate()">
          <p v-if="createErrorMessage" class="license-message danger" role="alert"><span>{{ createErrorMessage }}</span><button type="button" class="button-secondary" :disabled="submitting || rightsLoading || choicesLoading" @click="retryRights">重读模型</button></p>
          <p v-if="rightsLoading || choicesLoading" class="license-hint" role="status">正在读取模型与方案…</p>
          <div class="license-field">
            <span>客户</span>
            <FormSelect :model-value="form.customerId" :options="customerOptions" aria-label="客户" :disabled="submitting" @update:model-value="value => { form.customerId = String(value); }" />
          </div>
          <div class="license-field">
            <span>产品</span>
            <FormSelect :model-value="form.productId" :options="productOptions" aria-label="产品" :disabled="submitting" @update:model-value="value => { form.productId = String(value); void loadModelChoices(); }" />
          </div>
          <div class="license-field">
            <span>校验模式</span>
            <FormSelect v-model="form.mode" :options="modes" aria-label="校验模式" :disabled="submitting" />
          </div>
          <div class="license-field">
            <span>授权对象</span>
            <FormSelect v-model="form.subjectKind" :options="subjectKinds" aria-label="授权对象" :disabled="submitting" />
          </div>
          <div class="license-field">
            <span>资格政策</span>
            <FormSelect v-model="form.eligibilityKind" :options="eligibilityOptions" aria-label="资格政策" :disabled="submitting" />
          </div>
          <div class="license-field">
            <span>条件模型</span>
            <FormSelect :model-value="form.modelVersionId" :options="modelOptions" aria-label="条件模型" :disabled="submitting || choicesLoading || !form.productId || !canApi('license.model.read')" @update:model-value="value => void onModelChange(value)" />
          </div>
          <section v-if="selectedModelPolicies" class="license-policy-summary-card" aria-label="模型政策摘要">
            <h3>模型政策约束</h3>
            <ul><li v-for="line in selectedPolicySummary" :key="line">{{ line }}</li></ul>
            <p v-if="selectedPolicyErrors.length" class="license-message danger">{{ selectedPolicyErrors[0] }}</p>
            <p v-else class="license-hint">当前对象、资格和模式候选已按模型政策收窄；签发时仍会重新核对真实资格与能力。</p>
          </section>
          <div v-if="form.productId && canApi('license.plan.read') && canApi('license.model.read')" class="license-field">
            <span>方案预填（可选）</span>
            <FormSelect :model-value="form.planVersionId" :options="planOptions" aria-label="方案预填" :disabled="submitting || choicesLoading" @update:model-value="value => void onPlanChange(value)" />
          </div>
          <RightsFieldsEditor :fields="rightFields" :disabled="submitting || rightsLoading" />
          <LimiterPolicyEditor v-model="limiterPolicies" :disabled="submitting || rightsLoading || choicesLoading" />
          <label v-if="needsOfflineProfile">离线身份能力版本<input v-model.trim="form.offlineProofProfile" :disabled="submitting" /></label>
          <fieldset>
            <legend>期限（可选，不填按一年+七天宽限装载）</legend>
            <label class="license-form-check"><input v-model="form.perpetual" type="checkbox" :disabled="submitting" />永久授权</label>
            <label>开始日期<input v-model="form.startsAt" type="date" :disabled="submitting || form.perpetual === false && !form.startsAt && false" /></label>
            <label v-if="!form.perpetual">服务截止<input v-model="form.serviceUntil" type="date" :disabled="submitting" /></label>
            <label v-if="!form.perpetual">宽限截止<input v-model="form.commercialGraceUntil" type="date" :disabled="submitting" /></label>
          </fieldset>
          <label>业务订单编号（可选）<input v-model.trim="form.businessOrderRef" :disabled="submitting" /></label>
          <div class="drawer-actions">
            <button type="button" class="button-secondary" :disabled="submitting" @click="closeCreate">取消</button>
            <button v-if="canApi('license.grant.manage')" type="submit" class="button-primary" :disabled="submitting || choicesLoading || rightsLoading || !rightsReady || !form.customerId || !form.productId || !form.modelVersionId">
              {{ submitting ? '提交中…' : '提交' }}
            </button>
          </div>
        </form>
    </Drawer>
  </section>
</template>
