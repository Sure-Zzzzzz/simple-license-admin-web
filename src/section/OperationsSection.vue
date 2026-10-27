<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import { abandonOperation, getOperation, listOperations, recoverOperation, type OperationRow } from '../api/domain';
import type { LicensePage } from '../api/http';
import { canApi, permissionState } from '../auth/permissions';
import { licenseState } from '../licenseState';
import { captureLicenseSession } from '../ui/sessionFence';

/** 管理操作先回读当前事实，再由用户确认；状态和版本一并提交，迟到结果不得跨身份回写。 */
const props = defineProps<{ section: string }>();
const loading = ref(false), submitting = ref(false), detailLoading = ref(false);
const errorMessage = ref(''), message = ref(''), detailError = ref('');
const page = ref(1), drawerOpen = ref(false), selected = ref<OperationRow | null>(null);
const detailOperationId = ref('');
const action = ref<'recover' | 'abandon' | null>(null), acknowledged = ref(false), reasonCategory = ref('');
const result = ref<LicensePage<OperationRow>>({ data: [], total: 0, page: 1, size: 20, totalPages: 0 });
let active = true, listRequest = 0, detailRequest = 0, drawerSession = captureLicenseSession();
const opColumns: DataTableColumn[] = [
  { key: 'operationId', label: '任务编号', nowrap: true }, { key: 'grantId', label: '授权编号' },
  { key: 'state', label: '状态' }, { key: 'executionGeneration', label: '执行批次' },
  { key: 'reasonCategory', label: '处理原因' }, { key: 'actions', label: '操作' }
];
const title = computed(() => action.value === 'recover' ? selected.value?.state === 'SIGNING' ? '接管失联签名任务' : '恢复签发任务' : action.value === 'abandon' ? '安全放弃签发任务' : '签发任务详情');
function stateLabel(state: string) {
  return ({ PENDING_SIGN: '待签名', SIGNING: '签名中', READY: '已就绪', UNCERTAIN: '结果不明', REJECTED: '已拒绝', ABANDONED: '已放弃' } as Record<string, string>)[state] || state;
}
function stateBadge(state: string) { return state === 'READY' ? 'success' : state === 'UNCERTAIN' ? 'danger' : ['ABANDONED', 'REJECTED'].includes(state) ? 'neutral' : 'warning'; }
function reasonLabel(reason: string | null) {
  if (!reason) return '—';
  return ({ MANUAL_ABANDON: '人工安全放弃', MANUAL_RECOVERY: '人工核对后恢复', STALE_SIGNING_TAKEOVER: '失联签名接管',
    KMS_CALL_FAILED: '签名调用未确认', SIGNATURE_BUDGET_EXCEEDED: '签名结果超出允许规模', PAYLOAD_BUDGET_EXCEEDED: '凭据内容超出允许规模' } as Record<string, string>)[reason] || reason;
}
function current(request: number, session: () => boolean) { return active && detailRequest === request && session(); }
function resetDrawer() { ++detailRequest; drawerOpen.value = false; selected.value = null; detailOperationId.value = ''; action.value = null; detailError.value = ''; detailLoading.value = false; acknowledged.value = false; }
function closeDrawer() { if (!submitting.value) resetDrawer(); }
function invalidate() { ++listRequest; resetDrawer(); result.value.data = []; result.value.total = 0; loading.value = false; submitting.value = false; errorMessage.value = ''; message.value = ''; }
onBeforeUnmount(() => { active = false; invalidate(); });
watch(() => [permissionState.ready, licenseState.apiBase], invalidate);
async function loadPage() {
  if (!canApi('license.operation.read')) return;
  const request = ++listRequest, session = captureLicenseSession(); loading.value = true; errorMessage.value = '';
  try { const next = await listOperations(page.value); if (active && request === listRequest && session()) result.value = next; }
  catch (error) { if (active && request === listRequest && session()) errorMessage.value = error instanceof Error ? error.message : '任务读取未完成'; }
  finally { if (active && request === listRequest && session()) loading.value = false; }
}
async function openDetail(operationId: string) {
  if (!canApi('license.operation.read') || submitting.value) return;
  resetDrawer(); drawerOpen.value = true; drawerSession = captureLicenseSession();
  detailOperationId.value = operationId;
  const request = detailRequest, session = drawerSession; detailLoading.value = true;
  try { const row = await getOperation(operationId); if (current(request, session)) selected.value = row; }
  catch (error) { if (current(request, session)) detailError.value = error instanceof Error ? error.message : '详情读取未完成'; }
  finally { if (current(request, session)) detailLoading.value = false; }
}
async function prepareAction(next: 'recover' | 'abandon') {
  if (!canApi('license.operation.recover') || !canApi('license.operation.read') || !selected.value || submitting.value || !drawerSession()) return;
  const request = ++detailRequest, session = drawerSession, id = selected.value.operationId;
  action.value = null; acknowledged.value = false; detailError.value = ''; detailLoading.value = true;
  try {
    const row = await getOperation(id); if (!current(request, session)) return;
    selected.value = row;
    if (next === 'recover' && !['UNCERTAIN', 'SIGNING'].includes(row.state)) throw new Error('当前任务不能恢复，请核对最新状态。');
    if (next === 'abandon' && row.state !== 'UNCERTAIN') throw new Error('只有结果不明的任务可以安全放弃。');
    if (!Number.isSafeInteger(row.rowVersion) || row.rowVersion < 0 || !Number.isSafeInteger(row.executionGeneration) || row.executionGeneration < 1) throw new Error('任务版本不完整，不能执行管理操作。');
    reasonCategory.value = next === 'abandon' ? 'MANUAL_ABANDON' : row.state === 'SIGNING' ? 'STALE_SIGNING_TAKEOVER' : 'MANUAL_RECOVERY';
    action.value = next;
  } catch (error) { if (current(request, session)) detailError.value = error instanceof Error ? error.message : '操作准备未完成'; }
  finally { if (current(request, session)) detailLoading.value = false; }
}
async function submitAction() {
  if (!canApi('license.operation.recover') || !selected.value || !action.value || submitting.value || detailLoading.value || !drawerSession()) return;
  const row = selected.value, next = action.value, request = detailRequest, session = drawerSession;
  detailError.value = '';
  if (!acknowledged.value) { detailError.value = '请先核对处理影响并确认。'; return; }
  if (!reasonCategory.value.trim() || reasonCategory.value.length > 64) { detailError.value = '请选择有效的处理原因。'; return; }
  submitting.value = true;
  try {
    const updated = next === 'recover'
      ? await recoverOperation(row.operationId, { expectedRowVersion: row.rowVersion, expectedExecutionGeneration: row.executionGeneration, reasonCategory: reasonCategory.value })
      : await abandonOperation(row.operationId, { expectedRowVersion: row.rowVersion, reasonCategory: reasonCategory.value });
    if (!current(request, session)) return;
    selected.value = updated; action.value = null;
    message.value = next === 'recover' ? `恢复结果：${stateLabel(updated.state)}${updated.state === 'READY' ? '，凭据已可交付。' : '，请继续核对任务状态。'}` : `放弃结果：${stateLabel(updated.state)}。历史有效文件保持原状态。`;
    await loadPage();
  } catch (error) {
    if (!current(request, session)) return;
    detailError.value = `${error instanceof Error ? error.message : '操作未完成'}。请核对当前任务状态后再处理。`;
    action.value = null;
    try { const latest = await getOperation(row.operationId); if (current(request, session)) selected.value = latest; }
    catch { if (current(request, session)) selected.value = null; }
  } finally { if (current(request, session)) submitting.value = false; }
}
onMounted(() => void loadPage());
watch(() => props.section, () => { page.value = 1; invalidate(); void loadPage(); });
</script>

<template>
  <section class="license-page">
    <PageHeader title="签发任务" description="查看签发进度，核对未知结果，受控恢复或安全放弃任务" />
    <p v-if="errorMessage" class="license-message danger" role="alert">{{ errorMessage }}</p><p v-if="message" class="license-message" role="status">{{ message }}</p>
    <section class="panel license-data-surface">
      <header class="data-toolbar"><div><h2>任务列表<span>{{ result.total }} 项</span></h2><p>签名结果未知时先核对任务；已就绪凭据不会退回重新签名。</p></div><button type="button" class="button-secondary" :disabled="loading" @click="() => void loadPage()"><RefreshCw :size="15" aria-hidden="true" />刷新</button></header>
      <DataTable :columns="opColumns" :rows="result.data" row-key="operationId" :loading="loading" empty-text="暂无签发任务">
        <template #cell-operationId="{ row }"><button type="button" class="table-primary-action" @click="() => void openDetail(row.operationId)"><strong>{{ row.operationId }}</strong><span>{{ row.credentialId }}</span></button></template>
        <template #cell-state="{ row }"><span class="status-badge" :class="stateBadge(row.state)">{{ stateLabel(row.state) }}</span></template>
        <template #cell-reasonCategory="{ row }">{{ reasonLabel(row.reasonCategory) }}</template>
        <template #cell-actions="{ row }"><button type="button" class="button-secondary" :disabled="submitting" @click="() => void openDetail(row.operationId)">查看详情</button></template>
      </DataTable>
      <Pagination :current="page" :total="result.total" :page-size="20" :page-size-options="[20]" @update:current="value => { page = value; void loadPage(); }" />
    </section>
    <Drawer :open="drawerOpen" :title="title" description="处理前回读当前任务，保留原签发输入和凭据编号。" :pending="submitting" @close="closeDrawer">
      <p v-if="detailError" class="license-message danger" role="alert"><span>{{ detailError }}</span><button v-if="detailOperationId" type="button" class="button-secondary" :disabled="submitting || detailLoading" @click="() => void openDetail(detailOperationId)">回读任务</button></p><p v-if="detailLoading" class="license-hint" role="status">正在读取当前任务…</p>
      <section v-if="selected" class="license-detail-stack">
        <dl class="license-detail-grid"><div><dt>任务编号</dt><dd>{{ selected.operationId }}</dd></div><div><dt>授权编号</dt><dd>{{ selected.grantId }}</dd></div><div><dt>凭据编号</dt><dd>{{ selected.credentialId }}</dd></div><div><dt>状态</dt><dd><span class="status-badge" :class="stateBadge(selected.state)">{{ stateLabel(selected.state) }}</span></dd></div><div><dt>执行批次</dt><dd>{{ selected.executionGeneration }}</dd></div><div><dt>任务版本</dt><dd>{{ selected.rowVersion }}</dd></div><div><dt>最近签名调用</dt><dd>{{ selected.lastKmsCallAt ? new Date(selected.lastKmsCallAt).toLocaleString() : '—' }}</dd></div><div><dt>处理原因</dt><dd>{{ reasonLabel(selected.reasonCategory) }}</dd></div></dl>
        <p v-if="selected.state === 'READY'" class="license-message">凭据已就绪，可在凭据交付页下载。此任务不能恢复或放弃。</p>
        <div v-if="!action && canApi('license.operation.recover') && !detailLoading" class="license-table-actions"><button v-if="['UNCERTAIN', 'SIGNING'].includes(selected.state)" type="button" class="button-primary" :disabled="submitting" @click="() => void prepareAction('recover')">{{ selected.state === 'SIGNING' ? '接管失联签名' : '恢复任务' }}</button><button v-if="selected.state === 'UNCERTAIN'" type="button" class="button-secondary" :disabled="submitting" @click="() => void prepareAction('abandon')">安全放弃</button></div>
        <form v-if="action" class="drawer-form license-form license-operation-action" @submit.prevent="() => void submitAction()">
          <p v-if="action === 'abandon'" class="license-message danger">放弃后本任务不再交付凭据，不能通过恢复重新执行。此操作不会撤回历史有效文件。</p>
          <p v-else-if="selected.state === 'SIGNING'" class="license-message danger">仅在已核实任务失联时接管。服务端会检查宿主允许的接管窗口及最近调用时间；尚在正常签名的任务会拒绝接管。</p>
          <p v-else class="license-message">使用原冻结内容重新签名，提升执行批次并阻止旧结果提交。请先核对是否已有有效签发结果。</p>
          <div class="license-field"><span>处理原因</span><FormSelect v-model="reasonCategory" :options="action === 'abandon' ? [{ value: 'MANUAL_ABANDON', label: '经核对后安全放弃' }] : selected.state === 'SIGNING' ? [{ value: 'STALE_SIGNING_TAKEOVER', label: '签名任务失联，人工接管' }] : [{ value: 'MANUAL_RECOVERY', label: '签发结果不明，经核对后恢复' }]" aria-label="处理原因" :disabled="submitting" /></div>
          <label class="check-option"><input v-model="acknowledged" aria-label="任务处理确认" type="checkbox" :disabled="submitting" />已核对当前任务与处理影响，确认继续。</label>
          <div class="drawer-actions"><button type="button" class="button-secondary" :disabled="submitting" @click="action = null">返回详情</button><button v-if="canApi('license.operation.recover')" type="submit" class="button-primary" :disabled="submitting || !acknowledged">{{ submitting ? '处理中…' : action === 'abandon' ? '确认放弃' : '确认恢复' }}</button></div>
        </form>
      </section>
    </Drawer>
  </section>
</template>
