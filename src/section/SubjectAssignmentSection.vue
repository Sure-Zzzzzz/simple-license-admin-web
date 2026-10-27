<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, X } from 'lucide-vue-next';
import {
  addNamedSeatAllocations, createSubjectAssignment, listSubjectAssignments,
  patchSubjectAssignmentState, replaceSubjectAssignment,
  type SubjectAssignmentView
} from '../api/domain';
import type { LicensePage } from '../api/http';
import { canApi } from '../auth/permissions';

import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';

const props = defineProps<{ section: string; grantId?: string }>();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const showCreate = ref(false);
const page = ref(1);
type AssignmentPage = { data: SubjectAssignmentView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as AssignmentPage);

const createForm = reactive({
  subjectKind: 'PERSON', sourceId: '', subjectId: '',
  grantRevision: 1, requestedNamedMetrics: ''
});
const metricForm = reactive({ expectedRowVersion: 1, grantRevision: 1, metrics: '' });

const title = computed(() => `固定资格名单：${props.grantId ?? ''}`);

const subjectKindOptions = [
  { value: 'PERSON', label: '人员' },
  { value: 'SERVICE', label: '服务' }
];

// 表格列声明（契约 DataTable：特殊单元格走 #cell-{key} 插槽）
const assignmentColumns: DataTableColumn[] = [
  { key: 'assignmentId', label: '资格编号', nowrap: true },
  { key: 'subject', label: '对象', nowrap: true },
  { key: 'assignmentGeneration', label: '代数' },
  { key: 'state', label: '状态' },
  { key: 'metrics', label: '实名指标' },
  { key: 'actions', label: '操作' }
];

function stateText(state: string): string {
  return state === 'ACTIVE' ? '有效' : state === 'SUSPENDED' ? '暂停（占席）' : state;
}

function metricsList(text: string): string[] {
  return text.split(',').map(value => value.trim()).filter(Boolean);
}

async function loadPage() {
  if (!props.grantId) return;
  errorMessage.value = ''; loading.value = true;
  try {
    result.value = await listSubjectAssignments(props.grantId, page.value) as AssignmentPage;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    loading.value = false;
  }
}

async function submitCreate() {
  if (!canApi('license.subject-assignment.manage')) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    await createSubjectAssignment(props.grantId ?? '', {
      grantRevision: createForm.grantRevision,
      subjectKind: createForm.subjectKind, sourceId: createForm.sourceId, subjectId: createForm.subjectId,
      requestedNamedMetrics: metricsList(createForm.requestedNamedMetrics)
    });
    message.value = '资格已分配。';
    showCreate.value = false;
    createForm.sourceId = ''; createForm.subjectId = ''; createForm.requestedNamedMetrics = '';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    submitting.value = false;
  }
}

async function suspendOrResume(row: SubjectAssignmentView) {
  if (!canApi('license.subject-assignment.manage')) return;
  errorMessage.value = ''; submitting.value = true;
  try {
    await patchSubjectAssignmentState(row.assignmentId,
      { state: row.state === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }, row.rowVersion);
    message.value = row.state === 'ACTIVE' ? '资格已暂停（席位仍保留）。' : '资格已恢复。';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '操作未完成';
  } finally {
    submitting.value = false;
  }
}

const replaceOpen = ref(false);
const replaceTarget = ref<SubjectAssignmentView | null>(null);
const replaceForm = reactive({ sourceId: '', subjectId: '' });

function promptReplace(row: SubjectAssignmentView) {
  if (!canApi('license.subject-assignment.manage')) return;
  replaceTarget.value = row;
  replaceForm.sourceId = row.subjectRef.sourceId;
  replaceForm.subjectId = '';
  replaceOpen.value = true;
}

async function submitReplace() {
  if (!canApi('license.subject-assignment.manage')) return;
  if (!replaceTarget.value) return;
  errorMessage.value = ''; submitting.value = true;
  try {
    await replaceSubjectAssignment(replaceTarget.value.assignmentId, {
      expectedRowVersion: replaceTarget.value.rowVersion,
      sourceId: replaceForm.sourceId,
      subjectId: replaceForm.subjectId
    });
    message.value = '换人完成（旧行已替代，历史保留）。';
    replaceOpen.value = false;
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '换人未完成';
  } finally {
    submitting.value = false;
  }
}

async function appendMetrics(row: SubjectAssignmentView) {
  if (!canApi('license.subject-assignment.manage')) return;
  errorMessage.value = ''; submitting.value = true;
  try {
    await addNamedSeatAllocations(row.assignmentId, {
      expectedRowVersion: row.rowVersion, grantRevision: 1, requestedNamedMetrics: metricsList(metricForm.metrics)
    });
    message.value = '实名指标已追加（原指标与占用不变）。';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '追加未完成';
  } finally {
    submitting.value = false;
  }
}

function openCreate() {
  if (!canApi('license.subject-assignment.manage')) return;
  showCreate.value = true;
}

onMounted(() => void loadPage());
watch(() => props.grantId, () => { page.value = 1; void loadPage(); });
</script>

<template>
  <section class="license-page">
  <PageHeader
      :title="title"
      description="授权下人员/服务的实名资格与席位"
    >
      <template #actions>
        <button v-if="canApi('license.subject-assignment.manage')" class="button-primary" type="button" @click="openCreate"><Plus :size="17" />分配资格</button>
      </template>
    </PageHeader>
  <p v-if="errorMessage" class="license-message danger" role="alert">{{ errorMessage }}</p>
  <p v-if="message" class="license-message success" role="status">{{ message }}</p>
  <p v-if="loading" class="license-message">正在加载...</p>
  <section class="panel license-data-surface">
    <header class="data-toolbar">
      <div>
        <h2>资格名单<span>{{ result.total }} 项</span></h2>
        <p>授权下人员/服务的实名资格与席位</p>
      </div>
    </header>
    <div>
      <DataTable
        :columns="assignmentColumns"
        :rows="result.data"
        row-key="assignmentId"
        :loading="loading"
        empty-text="暂无分配"
      >
        <template #cell-subject="{ row }">{{ row.subjectRef.kind }}:{{ row.subjectRef.sourceId }}/{{ row.subjectRef.subjectId }}</template>
        <template #cell-assignmentGeneration="{ row }">gen {{ row.assignmentGeneration }}</template>
        <template #cell-state="{ row }">{{ stateText(row.state) }}</template>
        <template #cell-metrics="{ row }">{{ row.metrics.join(', ') || '—' }}</template>
        <template #cell-actions="{ row }">
          <span class="license-table-actions">
          <button v-if="canApi('license.subject-assignment.manage')" class="button-secondary" type="button" @click="() => void suspendOrResume(row)">{{ row.state === 'ACTIVE' ? '暂停' : '恢复' }}</button>
          <button v-if="canApi('license.subject-assignment.manage')" class="button-secondary" type="button" :disabled="submitting"
            @click="() => void promptReplace(row)">换人</button>
          <button v-if="canApi('license.subject-assignment.manage')" class="button-secondary" type="button" :disabled="submitting"
            @click="() => void appendMetrics(row)">追加指标</button>
          </span>
        </template>
      </DataTable>
    </div>
    <Pagination
      :current="page"
      :total="result.total"
      :page-size="20"
      :page-size-options="[20]"
      @update:current="value => { page = value; void loadPage(); }"
    />
  </section>

  <div v-if="replaceOpen" class="dialog-backdrop" @click.self="replaceOpen = false">
  <section class="confirm-dialog license-form-dialog" role="dialog" aria-modal="true" aria-label="换人" tabindex="-1">
    <form class="license-form" @submit.prevent="() => void submitReplace()">
      <h2>换人（撤旧建新）</h2>
      <label>身份来源<input v-model.trim="replaceForm.sourceId" :disabled="submitting" required /></label>
      <label>新主体编号<input v-model.trim="replaceForm.subjectId" :disabled="submitting" required /></label>
      <p class="license-hint">旧行转已替代保留历史；新行代数+1。</p>
      <footer>
        <button type="button" class="button-secondary" :disabled="submitting" @click="replaceOpen = false">取消</button>
        <button v-if="canApi('license.subject-assignment.manage')" type="submit" class="button-primary" :disabled="submitting || !replaceForm.sourceId || !replaceForm.subjectId">{{ submitting ? '提交中…' : '确认换人' }}</button>
      </footer>
    </form>
  </section>
</div>
<div v-if="showCreate" class="dialog-backdrop">
    <section class="confirm-dialog license-form-dialog" role="dialog" aria-modal="true" aria-label="分配资格">
      <header><h2>分配资格</h2><button type="button" class="icon-button" aria-label="关闭" @click="showCreate = false"><X :size="18" /></button></header>
      <div class="license-form">
        <div class="license-field">
          <span>对象种类</span>
          <FormSelect v-model="createForm.subjectKind" :options="subjectKindOptions" aria-label="对象种类" />
        </div>
        <label>身份来源<input v-model="createForm.sourceId" required /></label>
        <label>主体编号<input v-model="createForm.subjectId" required /></label>
        <label>授权修订号<input v-model.number="createForm.grantRevision" type="number" min="1" /></label>
        <label>实名指标（逗号分隔，可空）<input v-model="createForm.requestedNamedMetrics" placeholder="named_seats" /></label>
        <p class="license-message">换人必须撤旧建新；暂停不释放席位。</p>
      </div>
      <footer>
        <button class="button-secondary" type="button" @click="showCreate = false">取消</button>
        <button v-if="canApi('license.subject-assignment.manage')" class="button-primary" type="button" :disabled="submitting || !createForm.sourceId || !createForm.subjectId" @click="() => void submitCreate()">{{ submitting ? '提交中' : '提交' }}</button>
      </footer>
    </section>
  </div>
  </section>
</template>
