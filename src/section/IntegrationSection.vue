<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Plus, RefreshCw } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import {
  confirmIntegrationPlan, createIntegrationAttempt, createIntegrationPlan, getApplicationBindings,
  getIntegrationCommand, getOrganizationBinding, listCustomers, listIntegrationCommands, listProducts,
  reconcileIntegrationCommand, reconfirmIntegrationEnvironment,
  type ApplicationBindingView, type IntegrationPlanView, type OrganizationBindingView, type ProjectionConfirmation
} from '../api/domain';
import type { LicensePage } from '../api/http';
import { canApi, permissionState } from '../auth/permissions';
import { licenseState } from '../licenseState';
import { captureLicenseSession } from '../ui/sessionFence';
import { createProjectionRuleForm, serializeProjectionRules } from '../ui/projectionRules';
import ProjectionRulesEditor from './ProjectionRulesEditor.vue';
import ProjectionRulesSummary from './ProjectionRulesSummary.vue';

const props = defineProps<{ section: string }>();
type Action = 'confirm' | 'refresh' | 'auto' | 'reconcile' | 'environment';
const loading = ref(false), submitting = ref(false), drawerLoading = ref(false);
const errorMessage = ref(''), message = ref(''), drawerError = ref('');
const page = ref(1);
const result = ref<LicensePage<IntegrationPlanView>>({ data: [], total: 0, page: 1, size: 20, totalPages: 0 });
const drawer = ref<'create' | 'detail' | null>(null);
const selected = ref<IntegrationPlanView | null>(null), action = ref<Action | null>(null);
const detailCommandId = ref('');
const acknowledged = ref(false), priorCallTerminated = ref(false), openRoleId = ref('');
const environment = ref<OrganizationBindingView | null>(null);
const environmentInput = reactive({ organizationInstanceId: '', bindingGeneration: '' });
const createForm = reactive({ productId: '', customerId: '', applicationId: '', source: 'EXPLICIT', approved: false });
const rulesForm = reactive(createProjectionRuleForm()), bindings = ref<ApplicationBindingView[]>([]);
const bindingsLoading = ref(false);
const productOptions = ref<Array<{ value: string; label: string }>>([]), customerOptions = ref<Array<{ value: string; label: string }>>([]);
const binding = computed(() => bindings.value.find(item => String(item.applicationId) === createForm.applicationId));
const manage = () => canApi('license.integration.manage');
let active = true, listRequest = 0, drawerRequest = 0, bindingRequest = 0;
let drawerSession = captureLicenseSession(), lastCreateInput = '', createKey = '', actionKey = '';
const columns: DataTableColumn[] = [
  { key: 'target', label: '客户 / 产品', nowrap: true }, { key: 'applicationId', label: '目标应用' },
  { key: 'desiredRevision', label: '清单版本' }, { key: 'state', label: '状态' },
  { key: 'confirmedRevision', label: '人工确认版本' }, { key: 'planValidUntil', label: '有效期' }, { key: 'actions', label: '操作' }
];
const actionLabels: Record<Action, string> = { confirm: '确认人工执行结果', refresh: '刷新最新清单', auto: '自动执行清单', reconcile: '核对异常执行结果', environment: '重新确认身份环境' };
const drawerTitle = computed(() => drawer.value === 'create' ? '新建角色联动清单' : action.value ? actionLabels[action.value] : '角色联动详情');
function stateLabel(state: string) {
  return ({ PENDING_EXECUTION: '待执行', MANUALLY_CONFIRMED: '已人工确认', VERIFIED: '已核验', SUPERSEDED: '已替代',
    UNCERTAIN: '执行结果未知', DRIFTED: '实际角色已变化', ENVIRONMENT_RECONFIRM_REQUIRED: '身份环境待重确认' } as Record<string, string>)[state] || state;
}
function stateBadge(state: string) {
  if (state === 'VERIFIED' || state === 'MANUALLY_CONFIRMED') return 'success';
  if (state === 'UNCERTAIN' || state === 'DRIFTED') return 'danger';
  return state === 'SUPERSEDED' ? 'neutral' : 'warning';
}
function failureLabel(reason: string) {
  return ({ EXECUTION_RESULT_UNKNOWN: '尚未确认此前执行结果，请核对实际角色。', BUSINESS_OR_ROLE_CHANGED: '商业授权或实际角色已变化，请重新核对。',
    REVISION_CONFLICT: '角色版本已变化，需要重新生成清单。', MANIFEST_CONFLICT: '应用权限登记已变化，需要重新批准权限。',
    REJECTED: '身份服务未接受该操作，请核对受委托权限。', UNAVAILABLE: '身份服务暂不可用，请先回读当前状态。' } as Record<string, string>)[reason] || '执行尚未完成，请回读状态并核对身份服务中的实际角色。';
}
function dateLabel(seconds?: number | null) { return seconds && Number.isFinite(seconds) ? new Date(seconds * 1000).toLocaleString() : '—'; }
function idsLabel(ids?: number[]) { return ids?.length ? ids.join('、') : '无'; }
function validApplicationId(id: string) { return /^[1-9]\d*$/.test(id) && BigInt(id) <= 9223372036854775807n; }
function writable(plan: IntegrationPlanView) { return ['PENDING_EXECUTION', 'MANUALLY_CONFIRMED', 'VERIFIED'].includes(plan.state); }
function unexpired(plan: IntegrationPlanView) { return Number.isFinite(plan.validUntil) && plan.validUntil > Date.now() / 1000; }
function currentDrawer(request: number, session: () => boolean) { return active && request === drawerRequest && session(); }
function resetDrawer() {
  ++drawerRequest; ++bindingRequest; drawer.value = null; selected.value = null; action.value = null;
  drawerError.value = ''; drawerLoading.value = false; bindingsLoading.value = false;
  acknowledged.value = false; priorCallTerminated.value = false; environment.value = null;
  detailCommandId.value = '';
}
function closeDrawer() { if (!submitting.value) resetDrawer(); }
function invalidate() {
  ++listRequest; resetDrawer(); result.value.data = []; result.value.total = 0;
  productOptions.value = []; customerOptions.value = []; loading.value = false; submitting.value = false;
  errorMessage.value = ''; message.value = '';
}
onBeforeUnmount(() => { active = false; invalidate(); });
watch(() => [permissionState.ready, licenseState.apiBase], invalidate);
async function loadPage() {
  if (!canApi('license.integration.read')) return;
  const request = ++listRequest, session = captureLicenseSession(); loading.value = true; errorMessage.value = '';
  try { const next = await listIntegrationCommands(page.value); if (active && request === listRequest && session()) result.value = next; }
  catch (error) { if (active && request === listRequest && session()) errorMessage.value = error instanceof Error ? error.message : '清单读取未完成'; }
  finally { if (active && request === listRequest && session()) loading.value = false; }
}
async function loadCandidates<T extends { displayName: string; code: string }>(read: (page: number, size: number) => Promise<LicensePage<T>>, id: (row: T) => string) {
  const options: Array<{ value: string; label: string }> = []; let number = 1;
  const request = drawerRequest, session = captureLicenseSession();
  while (true) {
    const data = await read(number, 100);
    if (!currentDrawer(request, session)) return [];
    options.push(...data.data.map(row => ({ value: id(row), label: `${row.displayName || row.code} · ${row.code}` })));
    if (number >= data.totalPages) break; number += 1;
  }
  return options;
}
async function openCreate() {
  if (!manage() || submitting.value) return;
  resetDrawer(); drawer.value = 'create'; drawerSession = captureLicenseSession();
  const request = drawerRequest, session = drawerSession;
  Object.assign(createForm, { productId: '', customerId: '', applicationId: '', source: 'EXPLICIT', approved: false });
  Object.assign(rulesForm, createProjectionRuleForm()); bindings.value = []; lastCreateInput = ''; createKey = ''; drawerLoading.value = true;
  try {
    const [products, customers] = await Promise.all([
      canApi('license.product.read') ? loadCandidates(listProducts, row => row.productId) : Promise.resolve([]),
      canApi('license.customer.read') ? loadCandidates(listCustomers, row => row.customerId) : Promise.resolve([])
    ]);
    if (currentDrawer(request, session)) { productOptions.value = products; customerOptions.value = customers; }
  } catch (error) { if (currentDrawer(request, session)) drawerError.value = error instanceof Error ? error.message : '选项读取未完成'; }
  finally { if (currentDrawer(request, session)) drawerLoading.value = false; }
}
async function changeProduct(value: string | number) {
  if (submitting.value || !drawerSession()) return;
  createForm.productId = String(value); createForm.applicationId = ''; createForm.source = 'EXPLICIT'; createForm.approved = false;
  bindings.value = []; const request = ++bindingRequest, session = captureLicenseSession(); bindingsLoading.value = false;
  if (!createForm.productId || !canApi('license.product.read')) return;
  bindingsLoading.value = true;
  try { const next = await getApplicationBindings(createForm.productId); if (active && request === bindingRequest && drawer.value === 'create' && session()) bindings.value = next.items; }
  catch (error) { if (active && request === bindingRequest && drawer.value === 'create' && session()) drawerError.value = error instanceof Error ? error.message : '应用绑定读取未完成'; }
  finally { if (active && request === bindingRequest && session()) bindingsLoading.value = false; }
}
async function submitCreate() {
  if (!manage() || submitting.value || drawerLoading.value || bindingsLoading.value || !drawerSession()) return;
  drawerError.value = ''; let input;
  try {
    if (!createForm.productId.trim() || !createForm.customerId.trim() || !validApplicationId(createForm.applicationId.trim())) throw new Error('请选择客户、产品并填写有效的目标应用编号。');
    if (!createForm.approved) throw new Error('请先确认所选权限已获得批准。');
    if (createForm.source === 'BINDING' && !binding.value?.basePermissionSnapshot) throw new Error('该应用绑定没有批准的权限快照，请填写精确权限。');
    input = { customerId: createForm.customerId.trim(), applicationId: createForm.applicationId.trim(), ...(createForm.source === 'EXPLICIT' ? { desiredRules: serializeProjectionRules(rulesForm) } : {}) };
  } catch (error) { drawerError.value = error instanceof Error ? error.message : '请核对权限'; return; }
  const fingerprint = JSON.stringify([createForm.productId, input]);
  if (fingerprint !== lastCreateInput) { lastCreateInput = fingerprint; createKey = crypto.randomUUID(); }
  const request = drawerRequest, session = drawerSession; submitting.value = true;
  try {
    const created = await createIntegrationPlan(createForm.productId.trim(), input, createKey);
    if (!currentDrawer(request, session)) return;
    selected.value = created; detailCommandId.value = created.commandId; drawer.value = 'detail'; action.value = null; message.value = '清单已生成，请核对权限与部门变更后选择执行方式。'; await loadPage();
  } catch (error) { if (currentDrawer(request, session)) drawerError.value = error instanceof Error ? error.message : '清单创建未完成'; }
  finally { if (currentDrawer(request, session)) submitting.value = false; }
}
async function openDetail(commandId: string) {
  if (!canApi('license.integration.read') || submitting.value) return;
  resetDrawer(); drawer.value = 'detail'; drawerSession = captureLicenseSession();
  detailCommandId.value = commandId;
  const request = drawerRequest, session = drawerSession; drawerLoading.value = true;
  try { const next = await getIntegrationCommand(commandId); if (currentDrawer(request, session)) selected.value = next; }
  catch (error) { if (currentDrawer(request, session)) drawerError.value = error instanceof Error ? error.message : '详情读取未完成'; }
  finally { if (currentDrawer(request, session)) drawerLoading.value = false; }
}
async function prepareAction(next: Action) {
  if (!manage() || !canApi('license.integration.read') || !selected.value || submitting.value || !drawerSession()) return;
  const request = ++drawerRequest, session = drawerSession, commandId = selected.value.commandId;
  drawerLoading.value = true; drawerError.value = ''; action.value = null;
  acknowledged.value = false; priorCallTerminated.value = false; environment.value = null; actionKey = crypto.randomUUID();
  try {
    const latest = await getIntegrationCommand(commandId); if (!currentDrawer(request, session)) return;
    if (!Number.isSafeInteger(latest.desiredRevision) || latest.desiredRevision < 1 || !Number.isSafeInteger(latest.bindingGeneration) || latest.bindingGeneration < 1) throw new Error('清单版本不完整，不能执行管理操作。');
    selected.value = latest; openRoleId.value = latest.openRoleId || '';
    Object.assign(environmentInput, { organizationInstanceId: latest.organizationInstanceId, bindingGeneration: String(latest.bindingGeneration) });
    if (next === 'environment' && canApi('license.customer.read')) {
      const current = await getOrganizationBinding(latest.customerId); if (!currentDrawer(request, session)) return;
      environment.value = current; Object.assign(environmentInput, { organizationInstanceId: current.organizationInstanceId || '', bindingGeneration: String(current.bindingGeneration ?? '') });
    }
    if (next === 'confirm' && (latest.state !== 'PENDING_EXECUTION' || !unexpired(latest))) throw new Error('该清单已不适合人工确认，请刷新最新清单。');
    if ((next === 'auto' || next === 'refresh') && !writable(latest)) throw new Error('请先完成异常核对或环境重确认，再生成清单。');
    if (next === 'auto' && (latest.state !== 'PENDING_EXECUTION' || !unexpired(latest))) throw new Error('该清单已失效，请刷新最新清单后执行。');
    if (next === 'reconcile' && !['UNCERTAIN', 'DRIFTED'].includes(latest.state)) throw new Error('当前状态无需异常核对，请回到详情。');
    action.value = next;
  } catch (error) { if (currentDrawer(request, session)) drawerError.value = error instanceof Error ? error.message : '操作准备未完成'; }
  finally { if (currentDrawer(request, session)) drawerLoading.value = false; }
}
async function submitAction() {
  if (!manage() || !selected.value || !action.value || submitting.value || drawerLoading.value || !drawerSession()) return;
  const plan = selected.value, mode = action.value, request = drawerRequest, session = drawerSession; drawerError.value = '';
  if (!acknowledged.value) { drawerError.value = '请核对清单并勾选确认。'; return; }
  if ((mode === 'reconcile' || mode === 'environment') && !priorCallTerminated.value) { drawerError.value = '须先核实此前调用已终止，才能继续。'; return; }
  const confirmation: ProjectionConfirmation = { expectedRevision: plan.desiredRevision, organizationInstanceId: plan.organizationInstanceId, bindingGeneration: plan.bindingGeneration,
    ...(openRoleId.value.trim() ? { openRoleId: openRoleId.value.trim() } : {}) };
  if ((mode === 'confirm' || mode === 'reconcile') && !confirmation.openRoleId) { drawerError.value = '首次确认须填写实际专用角色编号。'; return; }
  if (mode === 'environment') {
    const number = Number(environmentInput.bindingGeneration);
    if (!environmentInput.organizationInstanceId.trim() || !Number.isSafeInteger(number) || number < 1 || number > 2147483647) { drawerError.value = '请填写当前身份环境及有效的组织绑定版本。'; return; }
    if (environmentInput.organizationInstanceId === plan.organizationInstanceId && number === plan.bindingGeneration && (!environment.value || environment.value.rootDepartmentId === plan.rootDepartmentId)) { drawerError.value = '环境和组织绑定没有变化，无需重新确认。'; return; }
  }
  submitting.value = true;
  try {
    let updated: IntegrationPlanView;
    if (mode === 'confirm') updated = await confirmIntegrationPlan(plan.planId, confirmation);
    else if (mode === 'reconcile') updated = await reconcileIntegrationCommand(plan.commandId, { ...confirmation, priorCallTerminated: true });
    else if (mode === 'environment') updated = await reconfirmIntegrationEnvironment(plan.productId, { customerId: plan.customerId, applicationId: plan.applicationId, organizationInstanceId: environmentInput.organizationInstanceId.trim(), bindingGeneration: Number(environmentInput.bindingGeneration), desiredRules: plan.approvedRules, priorCallTerminated: true });
    else updated = await createIntegrationAttempt(plan.commandId, mode === 'auto' ? 'AUTO' : 'MANUAL', actionKey);
    if (!currentDrawer(request, session)) return;
    selected.value = updated; detailCommandId.value = updated.commandId; action.value = null;
    // 实际治理状态决定文案，HTTP 成功不等于远端执行成功。
    message.value = mode === 'auto' ? `执行结果：${stateLabel(updated.state)}。` : mode === 'confirm' || mode === 'reconcile' ? `已记录人工核对：${stateLabel(updated.state)}。` : '最新清单已生成，请重新核对后执行。'; await loadPage();
  } catch (error) {
    if (!currentDrawer(request, session)) return;
    drawerError.value = `${error instanceof Error ? error.message : '操作未完成'}。请回读详情核对当前状态。`;
    // 自动写入失败后必须重新读取事实，禁止直接按原表单盲目重发。
    action.value = null;
    try { const current = await getIntegrationCommand(plan.commandId); if (currentDrawer(request, session)) selected.value = current; }
    catch { if (currentDrawer(request, session)) selected.value = null; }
  } finally { if (currentDrawer(request, session)) submitting.value = false; }
}
onMounted(() => void loadPage());
watch(() => props.section, () => { page.value = 1; invalidate(); void loadPage(); });
</script>

<template>
  <section class="license-page">
    <PageHeader title="角色联动" description="将客户的有效授权落实为目标应用的专用角色与部门权限"><template #actions><button v-if="manage()" type="button" class="button-primary" :disabled="submitting" @click="() => void openCreate()"><Plus :size="15" aria-hidden="true" />新建清单</button></template></PageHeader>
    <p v-if="errorMessage" class="license-message danger" role="alert">{{ errorMessage }}</p><p v-if="message" class="license-message" role="status">{{ message }}</p>
    <section class="panel license-data-surface">
      <header class="data-toolbar"><div><h2>联动清单<span>{{ result.total }} 项</span></h2><p>先核对商业授权、应用权限和部门范围，再选择执行方式。</p></div><button type="button" class="button-secondary" :disabled="loading" @click="() => void loadPage()"><RefreshCw :size="15" aria-hidden="true" />刷新</button></header>
      <DataTable :columns="columns" :rows="result.data" row-key="commandId" :loading="loading" empty-text="暂无角色联动清单">
        <template #cell-target="{ row }"><button type="button" class="table-primary-action" @click="() => void openDetail(row.commandId)"><strong>{{ row.customerId }}</strong><span>{{ row.productId }}</span></button></template>
        <template #cell-state="{ row }"><span class="status-badge" :class="stateBadge(row.state)">{{ stateLabel(row.state) }}</span></template>
        <template #cell-confirmedRevision="{ row }">{{ row.confirmedRevision ?? '—' }}</template><template #cell-planValidUntil="{ row }">{{ dateLabel(row.planValidUntil) }}</template>
        <template #cell-actions="{ row }"><button type="button" class="button-secondary" :disabled="submitting" @click="() => void openDetail(row.commandId)">查看详情</button></template>
      </DataTable>
      <Pagination :current="page" :total="result.total" :page-size="20" :page-size-options="[20]" @update:current="value => { page = value; void loadPage(); }" />
    </section>
    <Drawer :open="drawer !== null" :title="drawerTitle" description="清单生成与自动执行是独立操作，人工确认保留独立回执。" :pending="submitting" @close="closeDrawer">
      <p v-if="drawerError" class="license-message danger" role="alert"><span>{{ drawerError }}</span><button v-if="drawer === 'detail' && detailCommandId" type="button" class="button-secondary" :disabled="submitting || drawerLoading" @click="() => void openDetail(detailCommandId)">回读详情</button></p><p v-if="drawerLoading" class="license-hint" role="status">正在读取当前资料…</p>
      <form v-if="drawer === 'create'" class="drawer-form license-form license-integration-create" @submit.prevent="() => void submitCreate()">
        <div v-if="canApi('license.customer.read')" class="license-field"><span>客户</span><FormSelect v-model="createForm.customerId" :options="[{ value: '', label: '选择客户…' }, ...customerOptions]" aria-label="客户" :disabled="submitting || drawerLoading" /></div><label v-else>客户编号<input v-model="createForm.customerId" aria-label="客户编号" :disabled="submitting" required /></label>
        <div v-if="canApi('license.product.read')" class="license-field"><span>产品</span><FormSelect :model-value="createForm.productId" :options="[{ value: '', label: '选择产品…' }, ...productOptions]" aria-label="产品" :disabled="submitting || drawerLoading" @update:model-value="value => void changeProduct(value)" /></div><label v-else>产品编号<input v-model="createForm.productId" aria-label="产品编号" :disabled="submitting" required /></label>
        <div v-if="canApi('license.product.read')" class="license-field"><span>已绑定应用</span><FormSelect v-model="createForm.applicationId" :options="[{ value: '', label: bindingsLoading ? '正在读取应用…' : '选择已绑定应用…' }, ...bindings.map(item => ({ value: String(item.applicationId), label: `应用 ${item.applicationId} · 权限版本 ${item.basePermissionSnapshotVersion}` }))]" aria-label="已绑定应用" :disabled="submitting || bindingsLoading || !createForm.productId" /></div><label v-else>目标应用编号<input v-model="createForm.applicationId" aria-label="目标应用编号" inputmode="numeric" :disabled="submitting" required /></label>
        <div class="license-field"><span>权限批准依据</span><FormSelect v-model="createForm.source" :options="[{ value: 'EXPLICIT', label: '填写本次批准的精确权限' }, { value: 'BINDING', label: '使用应用绑定的批准快照', disabled: !binding?.basePermissionSnapshot }]" aria-label="权限批准依据" :disabled="submitting" /></div>
        <ProjectionRulesEditor v-if="createForm.source === 'EXPLICIT'" :form="rulesForm" :disabled="submitting" /><ProjectionRulesSummary v-else-if="binding?.basePermissionSnapshot" :rules="binding.basePermissionSnapshot" title="应用绑定的批准权限" /><p v-else class="license-message danger">该应用绑定没有批准的权限快照。</p>
        <label class="check-option"><input v-model="createForm.approved" aria-label="批准权限确认" type="checkbox" :disabled="submitting" />所选权限已获批准，且属于当前目标应用。</label>
        <div class="drawer-actions"><button type="button" class="button-secondary" :disabled="submitting" @click="closeDrawer">取消</button><button v-if="manage()" type="submit" class="button-primary" :disabled="submitting || drawerLoading || bindingsLoading">{{ submitting ? '生成中…' : '生成清单' }}</button></div>
      </form>
      <section v-if="drawer === 'detail' && selected" class="license-detail-stack">
        <dl class="license-detail-grid">
          <div><dt>客户</dt><dd>{{ selected.customerId }}</dd></div><div><dt>产品</dt><dd>{{ selected.productId }}</dd></div><div><dt>目标应用</dt><dd>{{ selected.applicationId }}</dd></div><div><dt>状态</dt><dd><span class="status-badge" :class="stateBadge(selected.state)">{{ stateLabel(selected.state) }}</span></dd></div><div><dt>清单版本</dt><dd>{{ selected.desiredRevision }}</dd></div><div><dt>有效期</dt><dd>{{ dateLabel(selected.validUntil) }}</dd></div>
          <div><dt>身份环境</dt><dd>{{ selected.organizationInstanceId }}</dd></div><div><dt>组织绑定版本</dt><dd>{{ selected.bindingGeneration }}</dd></div><div><dt>组织根部门</dt><dd>{{ selected.rootDepartmentId }}</dd></div><div><dt>专用角色编号</dt><dd>{{ selected.openRoleId || '尚未绑定' }}</dd></div><div><dt>外部角色标识</dt><dd>{{ selected.externalId }}</dd></div><div><dt>应用权限版本</dt><dd>{{ selected.manifestVersion }}</dd></div>
        </dl>
        <p v-if="selected.failureReason" class="license-message danger">处理说明：{{ failureLabel(selected.failureReason) }}</p><p v-if="selected.state === 'UNCERTAIN' || selected.state === 'DRIFTED'" class="license-message danger">请先核对此前调用与 IAM 实际角色，不要重复执行。</p>
        <p v-if="!selected.contributionPresent" class="license-message">当前没有有效人员授权贡献。本次清单将清除专用角色的应用权限与部门挂载；尚无角色时不会创建空角色。</p>
        <section><h3>商业授权依据</h3><p v-if="!selected.contributions.length" class="license-hint">无有效贡献</p><p v-for="item in selected.contributions" :key="item.grantId">{{ item.grantId }} · 授权修订 {{ item.grantRevision }} · 状态版本 {{ item.grantStateVersion }}</p></section>
        <ProjectionRulesSummary :rules="selected.approvedRules" title="批准权限" /><ProjectionRulesSummary :rules="selected.desiredRules" title="本次期望权限" />
        <dl class="license-detail-grid"><div><dt>最终挂载部门</dt><dd>{{ idsLabel(selected.targetDepartmentIds) }}</dd></div><div><dt>新增挂载</dt><dd>{{ idsLabel(selected.departmentDiff.toMount) }}</dd></div><div><dt>移除挂载</dt><dd>{{ idsLabel(selected.departmentDiff.toUnmount) }}</dd></div></dl>
        <div v-if="!action && manage() && !drawerLoading" class="license-table-actions">
          <button v-if="writable(selected)" type="button" class="button-secondary" :disabled="submitting" @click="() => void prepareAction('refresh')">刷新最新清单</button><button v-if="selected.state === 'PENDING_EXECUTION' && unexpired(selected)" type="button" class="button-secondary" :disabled="submitting" @click="() => void prepareAction('confirm')">确认人工执行结果</button><button v-if="selected.state === 'PENDING_EXECUTION' && unexpired(selected)" type="button" class="button-primary" :disabled="submitting" @click="() => void prepareAction('auto')">自动执行</button><button v-if="['UNCERTAIN', 'DRIFTED'].includes(selected.state)" type="button" class="button-secondary" :disabled="submitting" @click="() => void prepareAction('reconcile')">核对异常结果</button><button type="button" class="button-secondary" :disabled="submitting" @click="() => void prepareAction('environment')">重新确认身份环境</button>
        </div>
        <form v-if="action" class="drawer-form license-form license-integration-action" @submit.prevent="() => void submitAction()">
          <p v-if="action === 'auto'" class="license-message">将由 License 向 IAM 写入专用角色权限及部门挂载，随后回读核验。请确认上述变更范围。</p><p v-else-if="action === 'refresh'" class="license-message">重新读取当前商业授权和组织目录，生成最新清单。本操作不向 IAM 写入权限。</p><p v-else-if="action === 'confirm' || action === 'reconcile'" class="license-message">请先在 IAM 完成人工操作并核对实际角色。服务端会回读实际权限与部门范围；成功后记录人工确认回执。</p><p v-else class="license-message">仅在身份环境或组织绑定已变化时重确认。将生成新的外部角色标识及清单，旧角色保留为历史。</p>
          <label v-if="(action === 'confirm' || action === 'reconcile') && !selected.openRoleId">实际专用角色编号<input v-model="openRoleId" aria-label="实际专用角色编号" :disabled="submitting" required /></label>
          <template v-if="action === 'environment'"><label>当前身份环境<input v-model="environmentInput.organizationInstanceId" aria-label="当前身份环境" :readonly="Boolean(environment)" :disabled="submitting" required /></label><label>当前组织绑定版本<input v-model="environmentInput.bindingGeneration" aria-label="当前组织绑定版本" inputmode="numeric" :readonly="Boolean(environment)" :disabled="submitting" required /></label><p v-if="environment" class="license-hint">当前组织根部门：{{ environment.rootDepartmentId ?? '未绑定' }}。请确认客户组织绑定已批准。</p></template>
          <label v-if="action === 'reconcile' || action === 'environment'" class="check-option"><input v-model="priorCallTerminated" type="checkbox" aria-label="此前调用已终止" :disabled="submitting" />已核实此前调用终止，不会继续修改旧角色。</label><label class="check-option"><input v-model="acknowledged" type="checkbox" aria-label="操作范围确认" :disabled="submitting" />已核对当前客户、目标应用、权限及部门变更。</label>
          <div class="drawer-actions"><button type="button" class="button-secondary" :disabled="submitting" @click="action = null">返回详情</button><button v-if="manage()" type="submit" class="button-primary" :disabled="submitting || !acknowledged || ((action === 'reconcile' || action === 'environment') && !priorCallTerminated)">{{ submitting ? '处理中…' : actionLabels[action] }}</button></div>
        </form>
      </section>
    </Drawer>
  </section>
</template>
