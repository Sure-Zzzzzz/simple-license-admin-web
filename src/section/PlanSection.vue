<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import {
  createPlan, getModelVersion, getPlanVersion, listModels, listPlans, listProducts,
  patchPlanPrefill, publishPlanVersion,
  type ModelVersionView, type PlanVersionView
} from '../api/domain';
import RightsFieldsEditor from './RightsFieldsEditor.vue';
import { createRightsFields, serializeRightsFields, type RightsFieldInput } from '../ui/rightsFields';
import { canApi } from '../auth/permissions';

/**
 * 授权方案节面：方案=引用已发布模型精确版本+权益预填（开授权时的默认权益）。
 * 预填键集来自模型快照的 rights 声明——编辑时回读详情，创建时从所选模型读取。
 */
const props = defineProps<{ section: string }>();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
type PlanPage = { data: PlanVersionView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as PlanPage);

const productOptions = ref<Array<{ value: string; label: string }>>([]);
const filterProductId = ref('');
const editorProductId = ref('');
const publishedModels = ref<ModelVersionView[]>([]);
const modelsLoading = ref(false);
let pageRequest = 0;
let modelsRequest = 0;
let editorRequest = 0;

const planColumns: DataTableColumn[] = [
  { key: 'planVersionId', label: '方案版本编号', nowrap: true },
  { key: 'productCode', label: '产品' },
  { key: 'modelVersionId', label: '引用模型', nowrap: true },
  { key: 'version', label: '版本' },
  { key: 'status', label: '状态' },
  { key: 'actions', label: '操作' }
];

// 视图行：产品显示名经产品清单映射（模型版本编号截断展示）
const productNameOf = computed(() => {
  const map: Record<string, string> = {};
  for (const item of productOptions.value) map[item.value] = item.label;
  return map;
});

const planRows = computed(() => result.value.data.map(row => ({
  ...row,
  productCode: productNameOf.value[row.productId] ?? row.productId
})));

function stateLabel(state: string): string {
  return state === 'DRAFT' ? '草稿' : state === 'PUBLISHED' ? '已发布' : state;
}
function stateBadge(state: string): string {
  return state === 'PUBLISHED' ? 'success' : state === 'DRAFT' ? 'warning' : 'neutral';
}

async function loadProducts() {
  if (!canApi('license.product.read')) return;
  try {
    const products = await listProducts(1, 100);
    productOptions.value = products.data.map(item => ({ value: item.productId, label: item.displayName || item.code }));
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '产品候选读取失败，请重试。';
  }
}

async function loadModels() {
  const request = ++modelsRequest;
  const productId = editorProductId.value;
  publishedModels.value = [];
  modelsLoading.value = false;
  if (!productId) return;
  modelsLoading.value = true;
  try {
    const models = await listModels(productId);
    if (request !== modelsRequest || !editorOpen.value) return;
    publishedModels.value = models.data.filter(item => item.status === 'PUBLISHED');
  } catch (error) {
    if (request === modelsRequest && editorOpen.value) editorErrorMessage.value = error instanceof Error ? error.message : '模型候选读取失败，请重试。';
  } finally {
    if (request === modelsRequest) modelsLoading.value = false;
  }
}

async function loadPage() {
  const request = ++pageRequest;
  errorMessage.value = ''; loading.value = true;
  try {
    const response = await listPlans(filterProductId.value || undefined);
    if (request === pageRequest) result.value = response;
  } catch (error) {
    if (request === pageRequest) errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    if (request === pageRequest) loading.value = false;
  }
}

onMounted(() => { void loadProducts(); void loadPage(); });

// ===== 编辑态（建方案 / 草稿预填编辑共用） =====

const editorOpen = ref(false);
const editingVersionId = ref('');
const editingRowVersion = ref<number | null>(null);
const editorModelId = ref('');
const prefillFields = ref<RightsFieldInput[]>([]);
const editorErrorMessage = ref('');
const editorLoading = ref(false);
const modelReady = ref(false);

const modelOptions = computed(() => publishedModels.value.map(model => ({
  value: model.modelVersionId,
  label: `${model.modelVersionId.slice(0, 12)}… (v${model.version})`
})));

async function openCreate() {
  if (!canApi('license.plan.manage')) return;
  ++editorRequest;
  editingVersionId.value = '';
  editingRowVersion.value = null;
  editorModelId.value = '';
  editorErrorMessage.value = '';
  editorLoading.value = false;
  modelReady.value = false;
  prefillFields.value = [];
  editorProductId.value = filterProductId.value || productOptions.value[0]?.value || '';
  editorOpen.value = true;
  await loadModels();
}

async function onModelChange(value: string | number) {
  const request = ++editorRequest;
  editorModelId.value = String(value);
  modelReady.value = false;
  editorErrorMessage.value = '';
  prefillFields.value = [];
  editorLoading.value = false;
  if (!editorModelId.value) return;
  editorLoading.value = true;
  try {
    const detail = await getModelVersion(editorModelId.value);
    if (request !== editorRequest || !editorOpen.value) return;
    if (detail.productId !== editorProductId.value || detail.status !== 'PUBLISHED') throw new Error('请选择当前产品的已发布模型。');
    prefillFields.value = createRightsFields(detail.snapshot.fields.rights ?? {});
    modelReady.value = true;
  } catch (error) {
    if (request === editorRequest && editorOpen.value) editorErrorMessage.value = error instanceof Error ? error.message : '模型详情读取失败，请重新选择。';
  } finally {
    if (request === editorRequest) editorLoading.value = false;
  }
}

function onProductChange(value: string | number) {
  ++editorRequest;
  editorProductId.value = String(value);
  editorModelId.value = '';
  modelReady.value = false;
  editorLoading.value = false;
  editorErrorMessage.value = '';
  prefillFields.value = [];
  void loadModels();
}

function closeEditor() {
  if (submitting.value) return;
  ++editorRequest;
  ++modelsRequest;
  editorOpen.value = false;
  editorLoading.value = false;
  modelsLoading.value = false;
}

async function openDraftEdit(row: PlanVersionView) {
  if (!canApi('license.plan.manage') || !canApi('license.plan.read') || !canApi('license.model.read')) return;
  const request = ++editorRequest;
  ++modelsRequest;
  editingVersionId.value = row.planVersionId;
  editingRowVersion.value = null;
  editorProductId.value = row.productId;
  editorModelId.value = row.modelVersionId;
  editorErrorMessage.value = '';
  prefillFields.value = [];
  modelReady.value = false;
  editorLoading.value = true;
  editorOpen.value = true;
  try {
    const detail = await getPlanVersion(row.planVersionId);
    if (request !== editorRequest || !editorOpen.value) return;
    if (detail.status !== 'DRAFT') throw new Error('方案已发布，不能继续编辑预填。');
    const model = await getModelVersion(detail.modelVersionId);
    if (request !== editorRequest || !editorOpen.value) return;
    if (model.productId !== detail.productId) throw new Error('方案引用模型与产品不一致。');
    editingRowVersion.value = detail.rowVersion;
    editorProductId.value = detail.productId;
    editorModelId.value = detail.modelVersionId;
    prefillFields.value = createRightsFields(model.snapshot.fields.rights ?? {}, detail.prefillRights ?? {});
    modelReady.value = true;
  } catch (error) {
    if (request === editorRequest && editorOpen.value) editorErrorMessage.value = error instanceof Error ? error.message : '详情读取未完成';
  } finally {
    if (request === editorRequest) editorLoading.value = false;
  }
}

async function submitEditor() {
  if (!canApi('license.plan.manage')) return;
  if (submitting.value || !modelReady.value || editorLoading.value || !editorProductId.value || !editorModelId.value) {
    editorErrorMessage.value = '请先完整读取引用模型，再填写方案预填。';
    return;
  }
  submitting.value = true; editorErrorMessage.value = '';
  try {
    const rights = serializeRightsFields(prefillFields.value);
    if (editingVersionId.value) {
      if (editingRowVersion.value === null) throw new Error('请重新读取方案当前版本。');
      await patchPlanPrefill(editingVersionId.value, rights, editingRowVersion.value);
      message.value = '方案权益预填已保存。';
    } else {
      const created = await createPlan(editorProductId.value, editorModelId.value, rights);
      message.value = `方案已创建（草稿）：${created.planVersionId.slice(0, 12)}…`;
    }
    editorOpen.value = false;
    await loadPage();
  } catch (error) {
    editorErrorMessage.value = error instanceof Error ? error.message : '提交未完成';
  } finally {
    submitting.value = false;
  }
}

async function publish(row: PlanVersionView) {
  if (!canApi('license.plan.manage')) return;
  submitting.value = true; errorMessage.value = ''; message.value = '';
  try {
    await publishPlanVersion(row.planVersionId, row.rowVersion);
    message.value = '方案已发布（预填固化，开授权时作为默认权益）。';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '发布未完成';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="license-page">
    <PageHeader title="授权方案" description="引用已发布模型的权益预填组合（草稿→发布固化）">
      <template #actions>
        <button v-if="canApi('license.plan.manage') && canApi('license.model.read') && canApi('license.product.read')" class="button-primary" type="button" :disabled="submitting" @click="() => void openCreate()"><Plus :size="15" aria-hidden="true" />新建方案</button>
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
          <h2>方案版本<span>{{ result.total }} 项</span></h2>
          <p>产品维度的方案版本族（预填来源=模型 rights 声明）</p>
        </div>
      </header>
      <div class="data-toolbar license-filter-bar">
        <FormSelect :model-value="filterProductId" :options="[{ value: '', label: '全部产品' }, ...productOptions]" aria-label="产品筛选" @update:model-value="value => { filterProductId = String(value); void loadPage(); }" />
        <button class="button-secondary" type="button" @click="filterProductId = ''; void loadPage()">重置</button>
      </div>
      <div :aria-busy="loading">
        <DataTable
          :columns="planColumns"
          :rows="planRows"
          row-key="planVersionId"
          :loading="loading"
          empty-text="暂无方案（新建后选择已发布模型并预填权益）"
        >
          <template #cell-planVersionId="{ row }"><code>{{ row.planVersionId }}</code></template>
          <template #cell-modelVersionId="{ row }"><code>{{ row.modelVersionId.slice(0, 12) }}…</code></template>
          <template #cell-version="{ row }">v{{ row.version }}</template>
          <template #cell-status="{ row }">
            <span class="status-badge" :class="stateBadge(row.status)">{{ stateLabel(row.status) }}</span>
          </template>
          <template #cell-actions="{ row }">
            <span class="license-table-actions">
              <button v-if="row.status === 'DRAFT' && canApi('license.plan.manage') && canApi('license.plan.read') && canApi('license.model.read')" class="button-secondary" type="button" :disabled="submitting" @click="() => void openDraftEdit(row)">编辑预填</button>
              <button v-if="row.status === 'DRAFT' && canApi('license.plan.manage')" class="button-primary" type="button" :disabled="submitting" @click="() => void publish(row)">发布</button>
            </span>
          </template>
        </DataTable>
      </div>
    </section>

    <!-- 方案编辑（建方案 / 草稿预填编辑共用） -->
    <Drawer :open="editorOpen" :title="editingVersionId ? '编辑方案预填' : '新建授权方案'" description="方案预填保持模型声明的权益类型，创建授权时仍可调整。" :pending="submitting" @close="closeEditor">
        <form class="drawer-form license-plan-editor" @submit.prevent="() => void submitEditor()">
          <p v-if="editorErrorMessage" class="license-message danger" role="alert">{{ editorErrorMessage }}</p>
          <p v-if="editorLoading || modelsLoading" class="license-hint" role="status">正在读取模型与权益…</p>
          <p v-if="!editingVersionId" class="license-hint">方案只能引用当前产品的<b>已发布</b>模型版本。</p>
          <template v-if="!editingVersionId">
            <div class="license-field">
              <span>产品</span>
              <FormSelect
                :model-value="editorProductId"
                :options="[{ value: '', label: '选择产品…' }, ...productOptions]"
                aria-label="产品"
                :disabled="submitting"
                @update:model-value="onProductChange"
              />
            </div>
            <div class="license-field">
              <span>已发布模型版本</span>
              <FormSelect
                :model-value="editorModelId"
                :options="[{ value: '', label: '选择模型版本…' }, ...modelOptions]"
                aria-label="已发布模型版本"
                :disabled="submitting || modelsLoading || !editorProductId"
                @update:model-value="value => void onModelChange(value)"
              />
            </div>
          </template>
          <div v-else class="license-hint">引用模型：<code>{{ editorModelId }}</code>（发布后不可改引用）</div>
          <RightsFieldsEditor :fields="prefillFields" :disabled="submitting || editorLoading" />
          <p v-if="modelReady && prefillFields.length === 0" class="license-hint">所选模型未声明权益字段，可创建空预填方案。</p>
          <div class="drawer-actions">
            <button type="button" class="button-secondary" :disabled="submitting" @click="closeEditor">取消</button>
            <button v-if="canApi('license.plan.manage')" type="submit" class="button-primary" :disabled="submitting || editorLoading || modelsLoading || !modelReady">
              {{ submitting ? '提交中…' : editingVersionId ? '保存预填' : '创建方案' }}
            </button>
          </div>
        </form>
    </Drawer>
  </section>
</template>
