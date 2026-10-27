<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import {
  createCustomer, createIssuer, listCustomers, listIssuers,
  type CustomerView, type IssuerView
} from '../api/domain';
import { canApi, canPage } from '../auth/permissions';

const props = defineProps<{ section: string }>();
const router = useRouter();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const createOpen = ref(false);
const createErrorMessage = ref('');
const page = ref(1);
const pageSize = ref(20);
type IdentityRow = IssuerView | CustomerView;
type IdentityPage = { data: IdentityRow[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as IdentityPage);
const form = reactive({ code: '', displayName: '' });

const isIssuerSection = computed(() => props.section === 'issuers');
const canManageIdentity = computed(() => canApi(isIssuerSection.value ? 'license.issuer.manage' : 'license.customer.manage'));
const canViewCustomerBinding = computed(() => canPage('license.page.customers') && canApi('license.customer.read'));

// 视图行：签发方/客户联合行拍平（rowKey 稳定——签发方=issuerId、客户=customerId）
const identityRows = computed(() => result.value.data.map(row => ({
  key: String((row as CustomerView).customerId ?? (row as IssuerView).issuerId),
  code: row.code,
  displayName: row.displayName,
  status: row.status,
  customerId: (row as CustomerView).customerId
})));

const identityColumns = computed<DataTableColumn[]>(() => {
  const base: DataTableColumn[] = [
    { key: 'code', label: '编码' },
    { key: 'displayName', label: '名称' },
    { key: 'status', label: '状态' }
  ];
  if (!isIssuerSection.value) base.push({ key: 'actions', label: '操作' });
  return base;
});

function statusBadge(status: string): string {
  return status === 'ACTIVE' ? 'success' : 'neutral';
}
function statusText(status: string): string {
  return status === 'ACTIVE' ? '生效' : '停用';
}

async function loadPage() {
  errorMessage.value = ''; loading.value = true;
  try {
    result.value = isIssuerSection.value
      ? await listIssuers(page.value, pageSize.value)
      : await listCustomers(page.value, pageSize.value);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  if (!canApi(isIssuerSection.value ? 'license.issuer.manage' : 'license.customer.manage')) return;
  createErrorMessage.value = '';
  form.code = ''; form.displayName = '';
  createOpen.value = true;
}

async function submitCreate() {
  if (!canApi(isIssuerSection.value ? 'license.issuer.manage' : 'license.customer.manage')) return;
  createErrorMessage.value = ''; submitting.value = true;
  try {
    if (isIssuerSection.value) {
      await createIssuer({ code: form.code, displayName: form.displayName });
      message.value = '签发方已创建。';
    } else {
      await createCustomer({ code: form.code, displayName: form.displayName });
      message.value = '客户已创建。';
    }
    createOpen.value = false;
    await loadPage();
  } catch (error) {
    createErrorMessage.value = error instanceof Error ? error.message : '创建未完成';
  } finally {
    submitting.value = false;
  }
}

function openCustomerBinding(customerId: string) {
  if (!canPage('license.page.customers') || !canApi('license.customer.read')) return;
  void router.push(`/customers/${customerId}/organization-binding`);
}

onMounted(() => void loadPage());
watch(() => props.section, () => { page.value = 1; void loadPage(); });
</script>

<template>
  <section class="license-page">
    <PageHeader
      :title="isIssuerSection ? '签发方' : '客户与组织绑定'"
      :description="isIssuerSection ? '产品线与信任域的归属主体' : '买方企业与 IAM 组织绑定的客户主体'"
    >
      <template #actions>
        <button v-if="canManageIdentity" class="button-primary" type="button" @click="openCreate">
          <Plus :size="15" aria-hidden="true" />新建{{ isIssuerSection ? '签发方' : '客户' }}
        </button>
      </template>
    </PageHeader>
    <p v-if="errorMessage" class="license-message danger" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" class="button-secondary" :disabled="loading" @click="() => void loadPage()">重试</button>
    </p>
    <p v-if="message" class="license-message success" role="status">{{ message }}</p>
    <section class="panel license-data-surface">
      <header class="data-toolbar">
        <div>
          <h2>{{ isIssuerSection ? '签发方列表' : '客户列表' }}<span>{{ result.total }} 项</span></h2>
          <p>{{ isIssuerSection ? '当前授权范围内的签发方' : '当前授权范围内的客户' }}</p>
        </div>
      </header>
      <div :aria-busy="loading">
        <DataTable
          :columns="identityColumns"
          :rows="identityRows"
          row-key="key"
          :loading="loading"
          empty-text="暂无记录"
        >
          <template #cell-code="{ row }"><code>{{ row.code }}</code></template>
          <template #cell-status="{ row }">
            <span class="status-badge" :class="statusBadge(row.status)">{{ statusText(row.status) }}</span>
          </template>
          <template v-if="!isIssuerSection" #cell-actions="{ row }">
            <button v-if="canViewCustomerBinding" class="button-secondary" type="button" @click="openCustomerBinding(row.customerId!)">绑定组织</button>
          </template>
        </DataTable>
        <Pagination
          v-if="result.totalPages > 1"
          :current="page"
          :total="result.total"
          :page-size="pageSize"
          :page-size-options="[20, 50, 100]"
          @update:current="value => { page = value; void loadPage(); }"
          @update:page-size="value => { pageSize = value; page = 1; void loadPage(); }"
        />
      </div>
    </section>
    <div v-if="createOpen" class="dialog-backdrop" @click.self="createOpen = false">
      <section class="confirm-dialog license-form-dialog" role="dialog" aria-modal="true"
               :aria-label="`新建${isIssuerSection ? '签发方' : '客户'}`" tabindex="-1">
        <form class="license-form" @submit.prevent="() => void submitCreate()">
          <h2>新建{{ isIssuerSection ? '签发方' : '客户' }}</h2>
          <p v-if="createErrorMessage" class="license-message danger" role="alert">{{ createErrorMessage }}</p>
          <label>业务编码<input v-model.trim="form.code" :disabled="submitting" required maxlength="64" /></label>
          <label>显示名称<input v-model.trim="form.displayName" :disabled="submitting" required maxlength="128" /></label>
          <footer>
            <button type="button" class="button-secondary" :disabled="submitting" @click="createOpen = false">取消</button>
            <button v-if="canManageIdentity" type="submit" class="button-primary" :disabled="submitting || !form.code || !form.displayName">
              {{ submitting ? '提交中…' : '提交' }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </section>
</template>
