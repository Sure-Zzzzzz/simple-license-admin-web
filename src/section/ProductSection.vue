<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, X } from 'lucide-vue-next';
import {
  createProduct, getApplicationBindings, getProduct, listProducts,
  putApplicationBindings, type ApplicationBindingView, type ProductView
} from '../api/domain';
import { LicenseApiError } from '../api/http';
import { canApi, canPage } from '../auth/permissions';

import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';

const props = defineProps<{ section: string; productId?: string }>();
const router = useRouter();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const showCreate = ref(false);
const page = ref(1);
type ProductPage = { data: ProductView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as ProductPage);
const form = reactive({ issuerId: '', code: '', displayName: '', declaredActions: '', supportedCapabilities: '' });

const isDetail = computed(() => props.section === 'application-bindings');
const title = computed(() => isDetail.value ? `产品应用绑定：${props.productId ?? ''}` : '产品与应用绑定');

// 表格列声明（契约 DataTable：特殊单元格走 #cell-{key} 插槽）
const productColumns: DataTableColumn[] = [
  { key: 'code', label: '产品编码' },
  { key: 'issuerId', label: '签发方' },
  { key: 'declaredActions', label: '声明动作' },
  { key: 'actions', label: '应用绑定' },
  { key: 'models', label: '条件模型' }
];

const bindingColumns: DataTableColumn[] = [
  { key: 'applicationId', label: '应用编号' },
  { key: 'basePermissionSnapshotVersion', label: '权限快照版本' }
];

// 绑定项与并发版本一并从绑定接口回读，产品名称通过点查取得，不依赖列表分页。
const bindings = ref([] as ApplicationBindingView[]);
const bindingEdit = reactive<{ applicationId: string; snapshotVersion: number }>({ applicationId: '', snapshotVersion: 1 });
const productRowVersion = ref<number | null>(null);
const bindingProductName = ref('');
let loadSequence = 0;

function declaredActionsList(): string[] {
  return form.declaredActions.split(',').map(value => value.trim()).filter(Boolean);
}

function openCreate() {
  if (!canApi('license.product.manage')) return;
  showCreate.value = true;
}

function openApplicationBindings(productId: string) {
  if (!canPage('license.page.products') || !canApi('license.product.read')) return;
  void router.push(`/products/${productId}/application-bindings`);
}

function openModels(productId: string) {
  if (!canPage('license.page.models') || !canApi('license.model.read')) return;
  void router.push(`/products/${productId}/models`);
}

async function loadPage() {
  if (isDetail.value) {
    await loadBindings();
    return;
  }
  const sequence = ++loadSequence;
  errorMessage.value = ''; loading.value = true;
  try {
    const response = await listProducts(page.value) as ProductPage;
    if (sequence !== loadSequence) return;
    result.value = response;
  } catch (error) {
    if (sequence !== loadSequence) return;
    errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function loadBindings() {
  const sequence = ++loadSequence;
  const productId = props.productId ?? '';
  productRowVersion.value = null;
  errorMessage.value = ''; loading.value = true;
  try {
    const [response, product] = await Promise.all([
      getApplicationBindings(productId),
      getProduct(productId)
    ]);
    if (sequence !== loadSequence) return false;
    bindings.value = response.items;
    bindingProductName.value = product.displayName || product.code;
    // 绑定项与版本来自同一响应，避免并行产品点查时的版本变化污染编辑围栏。
    productRowVersion.value = response.rowVersion;
    return true;
  } catch (error) {
    if (sequence !== loadSequence) return false;
    errorMessage.value = error instanceof Error ? error.message : '请求未完成';
    return false;
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function submitCreate() {
  if (!canApi('license.product.manage')) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    await createProduct({
      issuerId: form.issuerId, code: form.code, displayName: form.displayName || form.code,
      supportedCapabilities: form.supportedCapabilities.split(',').map(v => v.trim()).filter(Boolean),
      declaredActions: declaredActionsList()
    });
    message.value = '产品已创建。';
    showCreate.value = false;
    form.issuerId = ''; form.code = ''; form.displayName = ''; form.declaredActions = ''; form.supportedCapabilities = '';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    submitting.value = false;
  }
}

async function addBinding() {
  if (!canApi('license.product.manage')) return;
  const productId = props.productId;
  if (!productId) return;
  if (submitting.value || loading.value || productRowVersion.value === null) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    const applicationId = Number(bindingEdit.applicationId);
    if (!Number.isSafeInteger(applicationId) || applicationId < 1
        || !Number.isSafeInteger(bindingEdit.snapshotVersion) || bindingEdit.snapshotVersion < 1) {
      throw new Error('应用编号与基础权限快照版本须为正整数。');
    }
    if (bindings.value.some(item => item.applicationId === applicationId)) {
      throw new Error('该应用已绑定，不能重复添加。');
    }
    // 全量替换须保留既有绑定的批准三权快照，新增应用不能抹掉其他应用的批准依据。
    const items = bindings.value.map(item => ({ ...item }));
    items.push({ applicationId, basePermissionSnapshotVersion: bindingEdit.snapshotVersion });
    const response = await putApplicationBindings(productId,
      { items }, productRowVersion.value);
    if (props.productId !== productId) return;
    bindings.value = response.items;
    // 保存响应携带新版本；再次回读项与版本，后续保存使用最新围栏。
    productRowVersion.value = response.rowVersion;
    const reloaded = await loadBindings();
    if (props.productId !== productId) return;
    message.value = reloaded ? '应用绑定已保存。' : '应用绑定已保存；回读未完成，请重试后再继续编辑。';
    Object.assign(bindingEdit, { applicationId: '', snapshotVersion: 1 });
  } catch (error) {
    if (props.productId !== productId) return;
    errorMessage.value = error instanceof Error
      ? (error instanceof LicenseApiError && error.status === 409 ? '版本已变化，请重试读取后再提交（不会自动覆盖）' : error.message)
      : '提交未完成';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => void loadPage());
watch(() => [props.section, props.productId], () => {
  page.value = 1;
  bindings.value = []; bindingProductName.value = ''; productRowVersion.value = null;
  showCreate.value = false; message.value = '';
  void loadPage();
});
onBeforeUnmount(() => { loadSequence++; });
</script>

<template>
  <section class="license-page">
  <PageHeader
      :title="title"
      description="产品声明动作总集与门户应用绑定"
    >
      <template #actions>
        <button v-if="!isDetail && canApi('license.product.manage')" class="button-primary" type="button" @click="openCreate"><Plus :size="17" />新建</button>
      </template>
    </PageHeader>
  <p v-if="errorMessage" class="license-message danger" role="alert"><span>{{ errorMessage }}</span><button class="button-secondary" type="button" :disabled="loading || submitting" @click="() => void loadPage()">重试</button></p>
  <p v-if="message" class="license-message success" role="status">{{ message }}</p>
  <p v-if="loading" class="license-message">正在加载...</p>

  <section v-if="!isDetail" class="panel license-data-surface">
    <header class="data-toolbar">
      <div>
        <h2>产品列表<span>{{ result.total }} 项</span></h2>
        <p>产品声明动作总集与门户应用绑定</p>
      </div>
    </header>
    <div>
      <DataTable
        :columns="productColumns"
        :rows="result.data"
        row-key="productId"
        :loading="loading"
        empty-text="暂无记录"
      >
        <template #cell-code="{ row }"><code>{{ row.code }}</code></template>
        <template #cell-declaredActions="{ row }">{{ row.declaredActions.join(', ') }}</template>
        <template #cell-actions="{ row }">
          <button v-if="canPage('license.page.products') && canApi('license.product.read')" class="button-secondary" type="button"
            @click="openApplicationBindings(row.productId)">应用绑定</button>
        </template>
        <template #cell-models="{ row }">
          <button v-if="canPage('license.page.models') && canApi('license.model.read')" class="button-secondary" type="button"
            @click="openModels(row.productId)">条件模型</button>
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

  <section v-else class="panel license-data-surface">
    <header class="data-toolbar"><h2>{{ bindingProductName || '产品' }}的应用绑定</h2></header>
    <div>
      <DataTable
        :columns="bindingColumns"
        :rows="bindings"
        row-key="applicationId"
        :loading="loading"
        empty-text="暂无绑定"
      />
    </div>
    <div class="license-form">
      <label>目标应用编号<input v-model="bindingEdit.applicationId" type="number" min="1" step="1" :disabled="submitting || loading || productRowVersion === null" /></label>
      <label>基础权限快照版本<input v-model.number="bindingEdit.snapshotVersion" type="number" min="1" step="1" :disabled="submitting || loading || productRowVersion === null" /></label>
      <button v-if="canApi('license.product.manage')" class="button-primary" type="button" :disabled="submitting || loading || productRowVersion === null || !bindingEdit.applicationId" @click="() => void addBinding()">
        {{ submitting ? '保存中' : '保存绑定' }}</button>
    </div>
  </section>

  <div v-if="showCreate" class="dialog-backdrop">
    <section class="confirm-dialog license-form-dialog" role="dialog" aria-modal="true" aria-label="新建产品">
      <header><h2>新建产品</h2><button type="button" class="icon-button" aria-label="关闭" @click="showCreate = false"><X :size="18" /></button></header>
      <div class="license-form">
        <label>签发方编号<input v-model="form.issuerId" required /></label>
        <label>产品编码<input v-model="form.code" required maxlength="64" /></label>
        <label>显示名称<input v-model="form.displayName" maxlength="128" placeholder="默认同编码" /></label>
        <label>声明动作（逗号分隔）<input v-model="form.declaredActions" placeholder="product.enter, resource.read" /></label>
        <label>支持能力（逗号分隔，可空）<input v-model="form.supportedCapabilities" placeholder="license-condition/1" /></label>
      </div>
      <footer>
        <button class="button-secondary" type="button" @click="showCreate = false">取消</button>
        <button v-if="canApi('license.product.manage')" class="button-primary" type="button" :disabled="submitting || !form.issuerId || !form.code" @click="() => void submitCreate()">{{ submitting ? '提交中' : '提交' }}</button>
      </footer>
    </section>
  </div>
  </section>
</template>
