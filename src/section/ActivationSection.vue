<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Plus, X } from 'lucide-vue-next';
import {
  createActivation, getCredentialContent, getGrant, listActivations, listCredentials,
  patchActivationCallerBinding, patchActivationState, replaceActivation, type ActivationAllocationInput,
  type ActivationView, type ActivationCallerBinding
} from '../api/domain';
import type { LicensePage } from '../api/http';
import { canApi, permissionState } from '../auth/permissions';
import { captureLicenseSession } from '../ui/sessionFence';
import { licenseState } from '../licenseState';

import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';

const props = defineProps<{ section: string; grantId?: string }>();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const page = ref(1);
type ActivationPage = { data: ActivationView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as ActivationPage);
const showCreate = ref(false);
const form = reactive({ deploymentCode: '', sourceId: '', subjectId: '' });
type AllocationForm = {
  metric: string;
  quantity: string;
  retention: 'FIXED' | 'PERPETUAL';
  retainUntil: string;
};
const allocations = ref<AllocationForm[]>([]);
const grantMode = ref<string | null>(null);
const createErrorMessage = ref('');
const replaceTarget = ref<ActivationView | null>(null);
const replaceForm = reactive({ changeBinding: false, sourceId: '', subjectId: '', acknowledged: false });
const replaceErrorMessage = ref('');
const downloading = ref(false);
let loadSequence = 0;
let active = true;
let createSession = captureLicenseSession(), replaceSession = captureLicenseSession(), bindingSession = captureLicenseSession();
const bindingTarget = ref<ActivationView | null>(null);
const bindingForm = reactive({ sourceId: '', subjectId: '', acknowledged: false });
const bindingErrorMessage = ref('');

const title = computed(() => `部署激活：${props.grantId ?? ''}`);
const canDownloadCredential = computed(() => canApi('license.grant.read') && canApi('license.grant.deliver'));

// 表格列声明（契约 DataTable：特殊单元格走 #cell-{key} 插槽）
const activationColumns: DataTableColumn[] = [
  { key: 'deploymentCode', label: '部署编码' },
  { key: 'activationId', label: '激活编号', nowrap: true },
  { key: 'activationGeneration', label: '代数' },
  { key: 'requestedAllocations', label: '本地额度' },
  { key: 'state', label: '状态' },
  { key: 'callerBinding', label: '获准服务主体' },
  { key: 'deviceBindingMode', label: '设备指纹' },
  { key: 'actions', label: '操作' }
];

function stateText(state: string): string {
  return state === 'ACTIVE' ? '有效' : state === 'SUSPENDED' ? '已停止新签发'
    : state === 'REPLACED' || state === 'SUPERSEDED' ? '已换机' : state;
}

function formatEpochDate(epochSeconds?: number): string {
  if (!epochSeconds) return '—';
  const date = new Date(epochSeconds * 1000);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
}

/** 登记的获准服务与运行时官方认证身份独立；不从管理员登录身份补默认值。 */
function parseCaller(sourceId: string, subjectId: string, required: boolean): ActivationCallerBinding | undefined {
  if (!sourceId && !subjectId && !required) return undefined;
  if (!sourceId || !subjectId) throw new Error('请填写获准服务的身份来源与主体编号；在线或混合授权不能缺少绑定。');
  if ([sourceId, subjectId].some(value => value !== value.trim() || new TextEncoder().encode(value).length > 128)) throw new Error('服务主体信息不能含首尾空白，且每项不能超过 128 字节。');
  return { sourceId, subjectId };
}

function openCreate(): void {
  if (!canApi('license.activation.manage')) return;
  createErrorMessage.value = '';
  Object.assign(form, { deploymentCode: '', sourceId: '', subjectId: '' });
  allocations.value = [];
  createSession = captureLicenseSession();
  showCreate.value = true;
}

function newAllocation(): AllocationForm {
  return { metric: '', quantity: '', retention: 'PERPETUAL', retainUntil: '' };
}

function addAllocation(): void {
  allocations.value.push(newAllocation());
}

function removeAllocation(index: number): void {
  allocations.value.splice(index, 1);
}

function parseAllocations(): ActivationAllocationInput[] | undefined {
  if (!allocations.value.length) return undefined;
  if (allocations.value.length > 128) throw new Error('额度分配最多 128 项。');
  const metrics = new Set<string>();
  return allocations.value.map((item, index) => {
    const metric = item.metric.trim();
    if (!metric) throw new Error(`请填写第 ${index + 1} 项额度指标。`);
    if (metric.length > 128 || new TextEncoder().encode(metric).length > 128) throw new Error(`第 ${index + 1} 项额度指标不能超过 128 字节。`);
    if (metrics.has(metric)) throw new Error(`额度指标「${metric}」重复，请合并为一项当前分配。`);
    metrics.add(metric);
    const quantity = Number(item.quantity);
    if (!item.quantity.trim() || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error(`第 ${index + 1} 项额度数量必须是正整数。`);
    if (item.retention === 'FIXED') {
      if (!item.retainUntil) throw new Error(`第 ${index + 1} 项固定保留额度必须填写保留截止日期。`);
      const retainUntil = Date.parse(`${item.retainUntil}T00:00:00Z`) / 1000;
      if (!Number.isSafeInteger(retainUntil) || retainUntil <= 0) throw new Error(`第 ${index + 1} 项保留截止日期无效。`);
      return { metric, quantity, retention: item.retention, retainUntil };
    }
    if (item.retainUntil) throw new Error(`第 ${index + 1} 项永久额度不能填写保留截止日期。`);
    return { metric, quantity, retention: item.retention };
  });
}

function openReplace(row: ActivationView): void {
  if (!canApi('license.activation.manage')) return;
  replaceTarget.value = row;
  replaceErrorMessage.value = '';
  replaceSession = captureLicenseSession();
  Object.assign(replaceForm, { changeBinding: !row.callerBinding && grantMode.value !== 'OFFLINE', sourceId: row.callerBinding?.sourceId || '', subjectId: row.callerBinding?.subjectId || '', acknowledged: false });
}

function openBinding(row: ActivationView) {
  if (!canApi('license.activation.manage') || submitting.value) return;
  bindingTarget.value = row; bindingSession = captureLicenseSession(); bindingErrorMessage.value = '';
  Object.assign(bindingForm, { sourceId: row.callerBinding?.sourceId || '', subjectId: row.callerBinding?.subjectId || '', acknowledged: false });
}
async function submitBinding() {
  if (!canApi('license.activation.manage') || !bindingTarget.value || submitting.value || !bindingSession()) return;
  const row = bindingTarget.value; bindingErrorMessage.value = '';
  try {
    if (!bindingForm.acknowledged) throw new Error('请确认服务主体绑定的处理影响。');
    const callerBinding = parseCaller(bindingForm.sourceId, bindingForm.subjectId, true)!;
    submitting.value = true;
    await patchActivationCallerBinding(row.activationId, { expectedRowVersion: row.rowVersion, callerBinding });
    if (!active || !bindingSession() || props.grantId !== row.grantId) return;
    bindingTarget.value = null; message.value = '获准服务主体已更新；运行时仍须通过官方服务认证。'; await loadPage();
  } catch (error) { if (active && bindingSession() && props.grantId === row.grantId) bindingErrorMessage.value = error instanceof Error ? error.message : '绑定未完成'; }
  finally { if (active && bindingSession()) submitting.value = false; }
}

async function loadPage() {
  if (!canApi('license.activation.read')) return;
  const sequence = ++loadSequence;
  const session = captureLicenseSession();
  const grantId = props.grantId;
  if (!grantId) { loading.value = false; errorMessage.value = '缺少授权上下文，请返回授权列表重新进入。'; return; }
  errorMessage.value = ''; loading.value = true;
  try {
    const response = await listActivations(grantId, page.value) as LicensePage<ActivationView> as ActivationPage;
    if (!active || sequence !== loadSequence || !session()) return;
    result.value = response;
    grantMode.value = null;
    if (canApi('license.grant.read')) {
      try { const grant = await getGrant(grantId); if (active && sequence === loadSequence && session()) grantMode.value = grant.mode; }
      catch { /* 运行模式未知时只允许填写完整主体绑定，不能默认认作离线授权。 */ }
    }
  } catch (error) {
    if (!active || sequence !== loadSequence || !session()) return;
    errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    if (active && sequence === loadSequence && session()) loading.value = false;
  }
}

async function submitCreate() {
  if (!canApi('license.activation.manage') || !createSession()) return;
  const grantId = props.grantId;
  if (!grantId || submitting.value) return;
  createErrorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    if (!form.deploymentCode.trim()) throw new Error('请填写部署编码。');
    const callerBinding = parseCaller(form.sourceId, form.subjectId, grantMode.value !== 'OFFLINE');
    const requestedAllocations = parseAllocations();
    await createActivation(grantId, {
      deploymentCode: form.deploymentCode.trim(), ...(callerBinding ? { callerBinding } : {}),
      ...(requestedAllocations ? { requestedAllocations } : {})
    });
    if (!active || !createSession() || props.grantId !== grantId) return;
    message.value = '激活已登记，可在授权列表中为该激活签发凭据。';
    showCreate.value = false;
    Object.assign(form, { deploymentCode: '', sourceId: '', subjectId: '' });
    allocations.value = [];
    await loadPage();
  } catch (error) {
    if (!active || !createSession() || props.grantId !== grantId) return;
    createErrorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    if (active && createSession()) submitting.value = false;
  }
}

async function submitReplace() {
  if (!canApi('license.activation.manage') || !replaceSession()) return;
  if (!replaceTarget.value || submitting.value) return;
  const row = replaceTarget.value;
  replaceErrorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    if (!replaceForm.acknowledged) throw new Error('请核对换机影响并确认。');
    const callerBinding = replaceForm.changeBinding ? parseCaller(replaceForm.sourceId, replaceForm.subjectId, true) : undefined;
    if (!callerBinding && !row.callerBinding && grantMode.value !== 'OFFLINE') throw new Error('当前激活未绑定获准服务，请在换机时补齐绑定。');
    await replaceActivation(row.activationId, { expectedRowVersion: row.rowVersion,
      ...(callerBinding ? { callerBinding } : {}), reasonCategory: 'NORMAL_REPLACEMENT' });
    if (!active || !replaceSession() || props.grantId !== row.grantId) return;
    message.value = '换机完成（旧激活已替代，新激活可签发）。';
    replaceTarget.value = null;
    await loadPage();
  } catch (error) {
    if (!active || !replaceSession() || props.grantId !== row.grantId) return;
    replaceErrorMessage.value = error instanceof Error ? error.message : '换机未完成';
  } finally {
    if (active && replaceSession()) submitting.value = false;
  }
}

async function downloadCredential(activationId: string) {
  if (!canApi('license.grant.read') || !canApi('license.grant.deliver')) return;
  if (downloading.value) return;
  const grantId = props.grantId;
  const session = captureLicenseSession();
  if (!grantId) return;
  errorMessage.value = ''; downloading.value = true;
  try {
    // 凭据编号不同于激活编号；同时按授权与当前激活筛选，防止交付另一台设备的凭据。
    const page = await listCredentials(1, { grantId, activationId });
    if (!active || !session() || props.grantId !== grantId) return;
    const ready = page.data.find(item => item.status === 'READY');
    if (!ready) {
      errorMessage.value = '当前激活尚无已就绪凭据，请先签发该激活的凭据。';
      return;
    }
    const content = await getCredentialContent(ready.credentialId);
    if (!active || !session() || props.grantId !== grantId) return;
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([content.compactJws], { type: 'application/jose' }));
    link.href = url;
    link.download = `${ready.credentialId}.license`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    if (!active || !session() || props.grantId !== grantId) return;
    errorMessage.value = error instanceof Error ? error.message : '下载未完成';
  } finally {
    if (active && session()) downloading.value = false;
  }
}

async function suspendOrResume(row: ActivationView) {
  if (!canApi('license.activation.manage')) return;
  if (submitting.value) return;
  errorMessage.value = ''; submitting.value = true;
  const session = captureLicenseSession();
  try {
    await patchActivationState(row.activationId,
      { state: row.state === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }, row.rowVersion);
    if (!active || !session() || props.grantId !== row.grantId) return;
    message.value = row.state === 'ACTIVE' ? '激活已停止新签发（旧离线文件不因此失效）。' : '激活已恢复。';
    await loadPage();
  } catch (error) {
    if (!active || !session() || props.grantId !== row.grantId) return;
    errorMessage.value = error instanceof Error ? error.message : '操作未完成';
  } finally {
    if (active && session()) submitting.value = false;
  }
}

onMounted(() => void loadPage());
watch(() => props.grantId, () => {
  page.value = 1;
  result.value = { data: [], total: 0, page: 1, size: 20, totalPages: 0 };
  showCreate.value = false; allocations.value = []; replaceTarget.value = null; bindingTarget.value = null; grantMode.value = null;
  errorMessage.value = ''; message.value = '';
  void loadPage();
});
watch(() => [permissionState.ready, licenseState.apiBase], () => {
  loadSequence++; result.value.data = []; showCreate.value = false; allocations.value = []; replaceTarget.value = null; bindingTarget.value = null;
  message.value = ''; errorMessage.value = ''; loading.value = false; submitting.value = false; downloading.value = false;
});
onBeforeUnmount(() => { active = false; loadSequence++; });
</script>

<template>
  <section class="license-page">
  <PageHeader
      :title="title"
      description="部署型授权的部署实例与激活代数"
    >
      <template #actions>
        <button v-if="canApi('license.activation.manage')" class="button-primary" type="button" :disabled="loading || submitting" @click="openCreate">新建激活申请</button>
      </template>
    </PageHeader>
  <p v-if="errorMessage" class="license-message danger" role="alert"><span>{{ errorMessage }}</span><button class="button-secondary" type="button" :disabled="loading || submitting" @click="() => void loadPage()">重试</button></p>
  <p v-if="message" class="license-message success" role="status">{{ message }}</p>
  <p v-if="loading" class="license-message">正在加载...</p>
  <section class="panel license-data-surface">
    <header class="data-toolbar">
      <div>
        <h2>部署激活<span>{{ result.total }} 项</span></h2>
        <p>部署型授权的部署实例与激活代数</p>
      </div>
    </header>
    <div>
      <DataTable
        :columns="activationColumns"
        :rows="result.data"
        row-key="activationId"
        :loading="loading"
        empty-text="暂无激活"
      >
        <template #cell-activationGeneration="{ row }">{{ row.activationGeneration }}</template>
        <template #cell-requestedAllocations="{ row }">
          <span v-if="!row.requestedAllocations.length" class="license-hint">未分配</span>
          <span v-else class="license-allocation-summary">
            <span v-for="allocation in row.requestedAllocations" :key="allocation.allocationId || `${allocation.metric}-${allocation.quantity}`">
              {{ allocation.metric }} {{ allocation.quantity }}<template v-if="allocation.retention === 'FIXED'"> · 至 {{ formatEpochDate(allocation.retainUntil) }}</template>
            </span>
          </span>
        </template>
        <template #cell-state="{ row }"><span class="status-badge" :class="row.state === 'ACTIVE' ? 'success' : row.state === 'SUSPENDED' ? 'warning' : 'neutral'">{{ stateText(row.state) }}</span></template>
        <template #cell-callerBinding="{ row }"><span v-if="row.callerBinding">{{ row.callerBinding.sourceId }} / {{ row.callerBinding.subjectId }}</span><span v-else class="license-hint">未绑定，禁止在线使用</span></template>
        <template #cell-deviceBindingMode="{ row }">{{ row.deviceBindingMode === 'NONE' ? '未启用' : '未知模式' }}</template>
        <template #cell-actions="{ row }">
          <span class="license-table-actions">
          <button v-if="canDownloadCredential" class="table-action" type="button" :disabled="downloading" @click="() => void downloadCredential(row.activationId)">下载凭据</button>
          <button v-if="canApi('license.activation.manage') && ['ACTIVE', 'SUSPENDED'].includes(row.state)" class="table-action" type="button" :disabled="submitting || loading" @click="() => void suspendOrResume(row)">{{ row.state === 'ACTIVE' ? '停止新签发' : '恢复' }}</button>
          <button v-if="canApi('license.activation.manage') && ['ACTIVE', 'SUSPENDED'].includes(row.state)" class="table-action" type="button" :disabled="submitting || loading"
            @click="openReplace(row)">换机</button>
          <button v-if="canApi('license.activation.manage') && ['ACTIVE', 'SUSPENDED'].includes(row.state)" class="table-action" type="button" :disabled="submitting || loading" @click="openBinding(row)">编辑服务绑定</button>
          </span>
        </template>
      </DataTable>
    </div>
    <Pagination
      v-if="result.totalPages > 1"
      :current="page"
      :total="result.total"
      :page-size="20"
      :page-size-options="[20]"
      @update:current="value => { page = value; void loadPage(); }"
    />
  </section>

  <Drawer :open="showCreate" title="新建激活申请" description="登记部署实例、获准服务主体和本地额度。当前未启用设备指纹。" :pending="submitting" @close="showCreate = false">
    <form class="drawer-form license-form license-activation-create" @submit.prevent="() => void submitCreate()">
      <p v-if="createErrorMessage" class="license-message danger" role="alert">{{ createErrorMessage }}</p>
      <label>部署编码<input v-model.trim="form.deploymentCode" required :disabled="submitting" /></label>
      <p class="license-hint">{{ grantMode === 'OFFLINE' ? '离线授权可以不登记服务主体；未绑定的激活不能在线使用。' : '在线、混合授权必须登记获准服务主体；模式未知时也须填写完整绑定。' }}</p>
      <label>服务身份来源<input v-model="form.sourceId" aria-label="服务身份来源" :disabled="submitting" :required="grantMode !== 'OFFLINE'" /></label>
      <label>服务主体编号<input v-model="form.subjectId" aria-label="服务主体编号" :disabled="submitting" :required="grantMode !== 'OFFLINE'" /></label>
      <p class="license-message">登记的是允许调用此激活的服务。填写编号不会赋予认证能力，运行时仍须通过官方服务认证并与绑定一致。</p>
      <fieldset class="license-allocation-fieldset">
        <legend>本地额度分配（可选）</legend>
        <p class="license-hint">LOCAL 指标必须在激活时登记额度；签发时服务端只会使用这份部署快照。每个指标只能有一项当前分配。</p>
        <section v-for="(allocation, index) in allocations" :key="index" class="license-allocation-row">
          <header><strong>额度 {{ index + 1 }}</strong><button type="button" class="icon-button" :aria-label="`移除额度 ${index + 1}`" :disabled="submitting" @click="removeAllocation(index)"><X :size="16" /></button></header>
          <label>指标<input v-model="allocation.metric" :aria-label="`额度指标 ${index + 1}`" :disabled="submitting" required /></label>
          <div class="license-allocation-grid">
            <label>数量<input v-model="allocation.quantity" :aria-label="`额度数量 ${index + 1}`" :disabled="submitting" inputmode="numeric" required /></label>
            <div class="license-field"><span>保留策略</span><FormSelect :model-value="allocation.retention" :options="[{ value: 'PERPETUAL', label: '永久' }, { value: 'FIXED', label: '固定截止' }]" :aria-label="`额度保留策略 ${index + 1}`" :disabled="submitting" @update:model-value="value => { allocation.retention = value as AllocationForm['retention']; if (allocation.retention === 'PERPETUAL') allocation.retainUntil = ''; }" /></div>
          </div>
          <label v-if="allocation.retention === 'FIXED'">保留截止日期<input v-model="allocation.retainUntil" :aria-label="`额度截止日期 ${index + 1}`" :disabled="submitting" type="date" required /></label>
          <p class="license-hint">分配编号和授权修订由服务端按当前授权生成并回读。</p>
        </section>
        <button type="button" class="button-secondary license-allocation-add" :disabled="submitting" @click="addAllocation"><Plus :size="16" />添加额度</button>
      </fieldset>
      <div class="drawer-actions">
        <button class="button-secondary" type="button" :disabled="submitting" @click="showCreate = false">取消</button>
        <button v-if="canApi('license.activation.manage')" class="button-primary" type="submit" :disabled="submitting || !form.deploymentCode.trim()">{{ submitting ? '提交中' : '提交申请' }}</button>
      </div>
    </form>
  </Drawer>
  <Drawer :open="replaceTarget !== null" title="换机" :description="`为部署 ${replaceTarget?.deploymentCode ?? ''} 生成下一次激活；旧离线凭据不会因此即时失效。`" :pending="submitting" @close="replaceTarget = null">
    <form class="drawer-form license-form license-activation-replace" @submit.prevent="() => void submitReplace()">
      <p v-if="replaceErrorMessage" class="license-message danger" role="alert">{{ replaceErrorMessage }}</p>
      <p class="license-message">当前未启用设备指纹。换机将提升激活批次并替代旧激活，默认继承获准服务主体。</p>
      <p class="license-hint">现有绑定：{{ replaceTarget?.callerBinding ? `${replaceTarget.callerBinding.sourceId} / ${replaceTarget.callerBinding.subjectId}` : '未绑定' }}</p>
      <label class="check-option"><input v-model="replaceForm.changeBinding" type="checkbox" aria-label="换机时更新服务绑定" :disabled="submitting || (!replaceTarget?.callerBinding && grantMode !== 'OFFLINE')" />换机时更新获准服务主体</label>
      <template v-if="replaceForm.changeBinding"><label>服务身份来源<input v-model="replaceForm.sourceId" aria-label="换机服务身份来源" :disabled="submitting" required /></label><label>服务主体编号<input v-model="replaceForm.subjectId" aria-label="换机服务主体编号" :disabled="submitting" required /></label></template>
      <label class="check-option"><input v-model="replaceForm.acknowledged" type="checkbox" aria-label="换机影响确认" :disabled="submitting" />已核对旧激活、服务主体和换机影响。</label>
      <div class="drawer-actions">
        <button class="button-secondary" type="button" :disabled="submitting" @click="replaceTarget = null">取消</button>
        <button v-if="canApi('license.activation.manage')" class="button-primary" type="submit" :disabled="submitting || !replaceForm.acknowledged">{{ submitting ? '换机中' : '确认换机' }}</button>
      </div>
    </form>
  </Drawer>
  <Drawer :open="bindingTarget !== null" title="编辑获准服务主体" description="更新此部署允许调用的服务身份；不创建凭据、不改变认证方式。" :pending="submitting" @close="bindingTarget = null">
    <form class="drawer-form license-form license-activation-binding" @submit.prevent="() => void submitBinding()">
      <p v-if="bindingErrorMessage" class="license-message danger" role="alert">{{ bindingErrorMessage }}</p>
      <p class="license-hint">部署：{{ bindingTarget?.deploymentCode }} · 当前版本 {{ bindingTarget?.rowVersion }}</p>
      <label>服务身份来源<input v-model="bindingForm.sourceId" aria-label="绑定服务身份来源" :disabled="submitting" required /></label>
      <label>服务主体编号<input v-model="bindingForm.subjectId" aria-label="绑定服务主体编号" :disabled="submitting" required /></label>
      <p class="license-message">更新后在线调用须匹配新的获准服务；旧离线文件不因此即时失效。运行时仍由官方认证链验证真实服务身份。</p>
      <label class="check-option"><input v-model="bindingForm.acknowledged" type="checkbox" aria-label="服务绑定影响确认" :disabled="submitting" />已核对服务主体及对后续在线调用的影响。</label>
      <div class="drawer-actions"><button type="button" class="button-secondary" :disabled="submitting" @click="bindingTarget = null">取消</button><button v-if="canApi('license.activation.manage')" type="submit" class="button-primary" :disabled="submitting || !bindingForm.acknowledged">{{ submitting ? '更新中…' : '确认更新' }}</button></div>
    </form>
  </Drawer>
  </section>
</template>
