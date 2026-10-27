<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { Plus, X } from 'lucide-vue-next';
import { createSigningProfile, listSigningProfiles, type SigningProfileView } from '../api/domain';
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
const statusFilter = ref('ACTIVE');
type ProfilePage = { data: SigningProfileView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as ProfilePage);
const form = reactive({
  productId: '', purpose: 'CREDENTIAL', kid: '', keyRef: '', keyVersion: 1,
  expectedProfileId: '', expectedRowVersion: '' as number | ''
});

const purposes = [
  { value: 'CREDENTIAL', label: '凭据签名' },
  { value: 'REVOCATION', label: '吊销签名' },
  { value: 'STATE_RECOVERY', label: '状态恢复' }
];
const statusOptions = [
  { value: 'ACTIVE', label: '在用' },
  { value: 'RETIRED', label: '已退役' },
  { value: 'ALL', label: '全部历史' }
];

// 表格列声明（契约 DataTable：特殊单元格走 #cell-{key} 插槽）
const profileColumns: DataTableColumn[] = [
  { key: 'profileId', label: '档案编号', nowrap: true },
  { key: 'purpose', label: '用途' },
  { key: 'kid', label: 'kid' },
  { key: 'status', label: '状态' },
  { key: 'createdAt', label: '登记时间', nowrap: true },
  { key: 'actions', label: '操作' }
];

async function loadPage() {
  errorMessage.value = ''; loading.value = true;
  try {
    result.value = await listSigningProfiles(page.value, statusFilter.value) as ProfilePage;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    loading.value = false;
  }
}

async function submitCreate() {
  if (!canApi('license.signing-profile.manage') || submitting.value) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    const input: Record<string, unknown> = {
      productId: form.productId, purpose: form.purpose, kid: form.kid,
      keyRef: form.keyRef, keyVersion: form.keyVersion
    };
    // 轮换：已有在用档案必须带期望档案双匹配（身份+版本），否则后端 409
    if (form.expectedProfileId) {
      input.expectedProfileId = form.expectedProfileId;
      input.expectedRowVersion = Number(form.expectedRowVersion);
    }
    await createSigningProfile(input as Parameters<typeof createSigningProfile>[0]);
    message.value = form.expectedProfileId
      ? '轮换完成：旧档案已退役保留（历史凭据验签不受影响），新档案即刻生效。'
      : '档案已登记（不可改绑；轮换登记新档案并带期望档案匹配）。';
    showCreate.value = false;
    form.kid = ''; form.keyRef = '';
    form.expectedProfileId = ''; form.expectedRowVersion = '';
    statusFilter.value = 'ACTIVE';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    submitting.value = false;
  }
}

/** 从在用档案发起轮换：预填产品/用途与期望档案（身份+版本），新钥信息人工补全。 */
function rotateFrom(row: SigningProfileView) {
  if (!canApi('license.signing-profile.manage') || row.status !== 'ACTIVE' || !row.profileId) return;
  errorMessage.value = ''; message.value = '';
  form.productId = row.productId;
  form.purpose = row.purpose;
  form.expectedProfileId = row.profileId;
  form.expectedRowVersion = row.rowVersion;
  form.kid = ''; form.keyRef = ''; form.keyVersion = 1;
  showCreate.value = true;
}

function openCreate() {
  if (!canApi('license.signing-profile.manage')) return;
  Object.assign(form, { productId: '', purpose: 'CREDENTIAL', kid: '', keyRef: '', keyVersion: 1, expectedProfileId: '', expectedRowVersion: '' });
  errorMessage.value = ''; message.value = '';
  showCreate.value = true;
}

onMounted(() => void loadPage());
watch(() => props.section, () => { page.value = 1; void loadPage(); });
watch(statusFilter, () => { page.value = 1; void loadPage(); });
</script>

<template>
  <section class="license-page">
  <PageHeader
      title="签名档案"
      description="产品×用途×kid 的签名钥映射；档案为不可变历史，轮换=旧档案退役留验+新档案生效"
    >
      <template #actions>
        <button v-if="canApi('license.signing-profile.manage')" class="button-primary" type="button" @click="openCreate"><Plus :size="17" />登记档案</button>
      </template>

    </PageHeader>
  <p v-if="errorMessage" class="license-message danger" role="alert">{{ errorMessage }}</p>
  <p v-if="message" class="license-message success" role="status">{{ message }}</p>
  <p v-if="loading" class="license-message">正在加载...</p>
  <section class="panel license-data-surface">
    <header class="data-toolbar">
      <div>
        <h2>签名档案<span>{{ result.total }} 项</span></h2>
        <p>退役档案的公钥快照永久保留，供历史凭据验签与销毁保护判定</p>
      </div>
      <div class="license-field">
        <span>状态</span>
        <FormSelect v-model="statusFilter" :options="statusOptions" aria-label="状态筛选" />
      </div>
    </header>
    <div>
      <DataTable
        :columns="profileColumns"
        :rows="result.data"
        row-key="profileId"
        :loading="loading"
        empty-text="暂无档案"
      >
        <template #cell-status="{ row }">
          <span :class="row.status === 'ACTIVE' ? 'status-badge success' : 'status-badge neutral'">{{ row.status === 'ACTIVE' ? '在用' : '已退役' }}</span>
        </template>
        <template #cell-actions="{ row }">
          <button v-if="row.status === 'ACTIVE' && canApi('license.signing-profile.manage')" class="button-secondary" type="button" :disabled="submitting" @click="rotateFrom(row)">轮换登记</button>
          <span v-if="row.status !== 'ACTIVE'" class="table-hint">保留至凭据窗口结束</span>
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
    <section class="confirm-dialog license-form-dialog" role="dialog" aria-modal="true" aria-label="登记签名档案">
      <header><h2>{{ form.expectedProfileId ? '轮换登记' : '登记签名档案' }}</h2><button type="button" class="icon-button" aria-label="关闭" @click="showCreate = false"><X :size="18" /></button></header>
      <div class="license-form">
        <label>产品编号<input v-model="form.productId" aria-label="产品编号" :readonly="!!form.expectedProfileId" required /></label>
        <div class="license-field">
          <span>用途</span>
          <FormSelect v-model="form.purpose" :options="purposes" aria-label="用途" :disabled="!!form.expectedProfileId" />
        </div>
        <label>业务 kid<input v-model="form.kid" aria-label="业务 kid" required /></label>
        <label>KMS 逻辑钥引用<input v-model="form.keyRef" aria-label="KMS 逻辑钥引用" required /></label>
        <label>精确钥版本<input v-model.number="form.keyVersion" aria-label="精确钥版本" type="number" min="1" /></label>
        <template v-if="form.expectedProfileId">
          <label>期望在用档案（轮换匹配）<input :value="form.expectedProfileId" aria-label="期望在用档案" readonly /></label>
          <label>期望档案版本<input :value="form.expectedRowVersion" aria-label="期望档案版本" readonly /></label>
        </template>
        <p class="license-message">建档读取公钥并严格校验 ES256/P-256 与钥状态；档案不可改绑，轮换登记新档案。</p>
      </div>
      <footer>
        <button class="button-secondary" type="button" @click="showCreate = false">取消</button>
        <button v-if="canApi('license.signing-profile.manage')" class="button-primary" type="button" :disabled="submitting || !form.productId || !form.kid || !form.keyRef" @click="() => void submitCreate()">{{ submitting ? '提交中' : '提交' }}</button>
      </footer>
    </section>
  </div>
  </section>
</template>
