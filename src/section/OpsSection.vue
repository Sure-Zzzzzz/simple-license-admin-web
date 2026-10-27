<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Search, X } from 'lucide-vue-next';
import {
  createRevocation, getCredentialContent, listCredentials, listRevocations,
  type CredentialMetaView, type RevocationView
} from '../api/domain';
import type { LicensePage } from '../api/http';
import { canApi } from '../auth/permissions';

import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';

const props = defineProps<{ section: string }>();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const showCreate = ref(false);
const page = ref(1);
type RevocationPage = { data: RevocationView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as RevocationPage);
const filters = reactive({ targetKind: '', targetId: '' });
const form = reactive({ targetKind: 'CREDENTIAL', targetId: '', reasonCategory: 'PIRACY', expectedRowVersion: 1 });

const title = computed(() => props.section === 'revocations' ? '吊销管理' : '凭据交付');

const targetKindOptions = [
  { value: 'CREDENTIAL', label: '凭据' },
  { value: 'GRANT', label: '授权' },
  { value: 'ACTIVATION', label: '激活' },
  { value: 'ASSIGNMENT', label: '资格' },
  { value: 'SIGNING_KEY', label: '签名钥' }
];
const filterKindOptions = [{ value: '', label: '全部' }, ...targetKindOptions];
const reasonOptions = [
  { value: 'PIRACY', label: '盗用' },
  { value: 'CONTRACT_END', label: '合同终止' },
  { value: 'SECURITY', label: '安全事件' },
  { value: 'OTHER', label: '其他' }
];

// 表格列声明（契约 DataTable：吊销/凭据双形态各自列集）
const revocationColumns: DataTableColumn[] = [
  { key: 'target', label: '目标类型 / 编号', nowrap: true },
  { key: 'reasonCategory', label: '原因分类' },
  { key: 'revokedAt', label: '发生时间' }
];
const credentialColumns: DataTableColumn[] = [
  { key: 'credentialId', label: '凭据编号', nowrap: true },
  { key: 'grantScope', label: '授权 / 操作', nowrap: true },
  { key: 'status', label: '状态' },
  { key: 'lastKmsCallAt', label: '最近 KMS 调用' },
  { key: 'actions', label: '操作' }
];

// 吊销视图行：rowKey 用目标复合键（同目标跨类型/时间不撞行键）
const revocationRows = computed(() => result.value.data.map(row => ({
  key: `${row.targetKind}:${row.targetId}:${row.revokedAt}`,
  ...row
})));

async function loadPage() {
  errorMessage.value = ''; loading.value = true;
  try {
    if (props.section === 'revocations') {
      result.value = await listRevocations(page.value, {
        targetKind: filters.targetKind || undefined, targetId: filters.targetId || undefined
      }) as RevocationPage;
    } else {
      const credentials = await listCredentials(page.value);
      // 凭据列表以吊销表结构复用展示壳
      result.value = credentials as unknown as RevocationPage;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    loading.value = false;
  }
}

async function submitCreate() {
  if (!canApi('license.revocation.manage')) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    await createRevocation({
      targetKind: form.targetKind, targetId: form.targetId,
      reasonCategory: form.reasonCategory, expectedRowVersion: form.expectedRowVersion
    });
    message.value = '吊销已生效（不可撤回）。';
    showCreate.value = false;
    form.targetId = '';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => void loadPage());
watch(() => props.section, () => { page.value = 1; void loadPage(); });

const hasFilter = computed(() => !!(filters.targetKind || filters.targetId));

const downloading = ref(false);

async function download(credentialId: string) {
  if (!canApi('license.grant.deliver')) return;
  errorMessage.value = ''; downloading.value = true;
  try {
    const content = await getCredentialContent(credentialId);
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([content.compactJws], { type: 'application/jose' }));
    link.href = url; link.download = credentialId + '.license'; link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '下载未完成';
  } finally {
    downloading.value = false;
  }
}

function resetFilters() {
  filters.targetKind = '';
  filters.targetId = '';
  page.value = 1;
  void loadPage();
}

function openCreate() {
  if (!canApi('license.revocation.manage')) return;
  showCreate.value = true;
}
</script>

<template>
  <section class="license-page">
  <PageHeader
      :title="title"
      description="凭据交付与吊销台账"
    >
      <template #actions>
        <button v-if="props.section === 'revocations' && canApi('license.revocation.manage')" class="button-primary" type="button" @click="openCreate">新建吊销</button>
      </template>
    </PageHeader>
  <p v-if="errorMessage" class="license-message danger" role="alert">{{ errorMessage }}</p>
  <p v-if="message" class="license-message success" role="status">{{ message }}</p>
  <section class="panel license-data-surface" :aria-label="props.section === 'revocations' ? '吊销台账' : '凭据交付'">
    <header class="data-toolbar">
      <div>
        <h2>{{ props.section === 'revocations' ? '吊销记录' : '凭据交付' }}<span>{{ result.total }} 项</span></h2>
        <p>{{ props.section === 'revocations' ? '只增不减的吊销台账，不可撤回' : '凭据元数据（原文仅部署端交付）' }}</p>
      </div>
    </header>
    <div v-if="props.section === 'revocations'" class="data-toolbar license-filter-bar">
      <FormSelect
        :model-value="filters.targetKind"
        :options="filterKindOptions"
        aria-label="目标类型筛选"
        @update:model-value="value => { filters.targetKind = String(value); page = 1; void loadPage(); }"
      />
      <label class="search-field">
        <span class="sr-only">搜索目标编号</span>
        <Search :size="16" aria-hidden="true" />
        <input v-model="filters.targetId" type="search" placeholder="搜索目标编号" @keyup.enter="() => { page = 1; void loadPage(); }">
      </label>
      <button class="button-secondary" type="button" @click="resetFilters">重置</button>
    </div>
    <p v-if="loading" class="license-message">正在加载...</p>
    <div>
      <DataTable
        v-if="props.section === 'revocations'"
        :columns="revocationColumns"
        :rows="revocationRows"
        row-key="key"
        :loading="loading"
        :empty-text="hasFilter ? '没有匹配的吊销记录，调整筛选后重试' : '暂无吊销记录'"
      >
        <template #cell-target="{ row }">{{ row.targetKind }} / {{ row.targetId }}</template>
        <template #cell-revokedAt="{ row }">{{ new Date(row.revokedAt * 1000).toLocaleString() }}</template>
      </DataTable>
      <DataTable
        v-else
        :columns="credentialColumns"
        :rows="(result.data as unknown as CredentialMetaView[])"
        row-key="credentialId"
        :loading="loading"
        empty-text="暂无凭据"
      >
        <template #cell-grantScope="{ row }">{{ row.grantId }} / {{ row.operationId }}</template>
        <template #cell-lastKmsCallAt="{ row }">{{ row.lastKmsCallAt ? new Date(row.lastKmsCallAt * 1000).toLocaleString() : '—' }}</template>
        <template #cell-actions="{ row }">
          <button v-if="row.status === 'READY' && canApi('license.grant.deliver')" class="button-secondary" type="button" :disabled="downloading" @click="() => void download(row.credentialId)">下载</button>
          <span v-if="row.status !== 'READY'" class="license-hint">未就绪</span>
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

  <div v-if="showCreate" class="dialog-backdrop">
    <section class="confirm-dialog license-form-dialog" role="dialog" aria-modal="true" aria-label="新建吊销">
      <header><h2>新建吊销</h2><button type="button" class="icon-button" aria-label="关闭" @click="showCreate = false"><X :size="18" /></button></header>
      <div class="license-form">
        <div class="license-field">
          <span>目标类型</span>
          <FormSelect v-model="form.targetKind" :options="targetKindOptions" aria-label="目标类型" />
        </div>
        <label>目标编号<input v-model="form.targetId" required /></label>
        <div class="license-field">
          <span>原因分类</span>
          <FormSelect v-model="form.reasonCategory" :options="reasonOptions" aria-label="原因分类" />
        </div>
        <label>目标行版本<input v-model.number="form.expectedRowVersion" type="number" min="1" /></label>
        <p class="license-message">吊销不可撤回；暂停可恢复。请确认目标编号。</p>
      </div>
      <footer>
        <button class="button-secondary" type="button" @click="showCreate = false">取消</button>
        <button v-if="canApi('license.revocation.manage')" class="button-primary" type="button" :disabled="submitting || !form.targetId" @click="() => void submitCreate()">{{ submitting ? '提交中' : '确认吊销' }}</button>
      </footer>
    </section>
  </div>
  </section>
</template>
