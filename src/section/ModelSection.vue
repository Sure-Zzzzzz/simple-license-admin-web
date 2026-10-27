<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Plus, X } from 'lucide-vue-next';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import Drawer from '@sure-zzzzzz/simple-iam-theme-contract/Drawer';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import FormSelect from '@sure-zzzzzz/simple-iam-theme-contract/FormSelect';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import ConditionTreeEditor from './ConditionTreeEditor.vue';
import RightsFieldsEditor from './RightsFieldsEditor.vue';
import ModelPolicyEditor from './ModelPolicyEditor.vue';
import { createRightsFields, serializeRightsFields, type RightsFieldInput } from '../ui/rightsFields';
import { createModelPolicies, policiesFromSnapshot, policiesToSnapshot, policySummary, validateModelPolicies } from '../ui/modelPolicies';
import { canApi } from '../auth/permissions';
import {
  createModel, evaluateModelAction, getModelVersion, getProduct, listModels,
  patchDraftSnapshot, publishModelVersion, retireModelVersion,
  type ModelFieldDef, type ModelPolicies, type ModelSnapshot, type ModelVersionDetail, type ModelVersionView, type ProductView, type TreeNode
} from '../api/domain';
import { LicenseApiError } from '../api/http';

const props = defineProps<{ section: string; productId: string }>();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
type VersionPage = { data: ModelVersionView[]; total: number; page: number; size: number; totalPages: number };
const result = ref({ data: [], total: 0, page: 1, size: 20, totalPages: 0 } as VersionPage);

// 产品动作总集（建模型时的动作候选来源）
const productActions = ref<string[]>([]);
const productView = ref<Partial<ProductView> | null>(null);
const productLoading = ref(false);
const productErrorMessage = ref('');
let active = true;
let pageRequest = 0;
let productRequest = 0;

const modelColumns: DataTableColumn[] = [
  { key: 'modelVersionId', label: '版本编号', nowrap: true },
  { key: 'version', label: '版本' },
  { key: 'status', label: '状态' },
  { key: 'fieldsSummary', label: '字段' },
  { key: 'actionsSummary', label: '动作' },
  { key: 'actions', label: '操作' }
];

function stateLabel(state: string): string {
  return state === 'DRAFT' ? '草稿' : state === 'PUBLISHED' ? '已发布' : state === 'RETIRED' ? '已退役' : state;
}
function stateBadge(state: string): string {
  return state === 'PUBLISHED' ? 'success' : state === 'DRAFT' ? 'warning' : 'neutral';
}

async function loadPage() {
  const request = ++pageRequest;
  const productId = props.productId;
  errorMessage.value = ''; loading.value = true;
  try {
    const loaded = await listModels(productId) as VersionPage;
    if (!active || request !== pageRequest || productId !== props.productId) return;
    result.value = loaded;
  } catch (error) {
    if (active && request === pageRequest && productId === props.productId) errorMessage.value = error instanceof Error ? error.message : '请求未完成';
  } finally {
    if (active && request === pageRequest) loading.value = false;
  }
}

async function loadProduct() {
  if (!canApi('license.product.read')) return;
  const request = ++productRequest;
  const productId = props.productId;
  productLoading.value = true;
  productErrorMessage.value = '';
  productView.value = null;
  try {
    const loaded = await getProduct(productId);
    if (!active || request !== productRequest || productId !== props.productId) return;
    productView.value = loaded;
    productActions.value = loaded.declaredActions ?? [];
  } catch (error) {
    if (active && request === productRequest && productId === props.productId) {
      productActions.value = [];
      productErrorMessage.value = error instanceof Error ? error.message : '产品动作读取失败，请重试。';
    }
  } finally { if (active && request === productRequest) productLoading.value = false; }
}

onMounted(() => { void loadPage(); void loadProduct(); });
watch(() => props.productId, () => { void loadPage(); void loadProduct(); });
onBeforeUnmount(() => { active = false; ++pageRequest; ++productRequest; });

// ===== 快照编辑态（建模型与草稿编辑共用） =====

const editorOpen = ref(false);
const editingVersionId = ref('');
const editingRowVersion = ref(1);
const rightsDefs = reactive<Record<string, ModelFieldDef>>({});
const factsDefs = reactive<Record<string, ModelFieldDef>>({});
const actionTrees = reactive<Record<string, TreeNode>>({});
const policies = ref<ModelPolicies>(createModelPolicies());
const legacyPolicy = ref(false);
const policyErrors = ref<string[]>([]);
let editRequest = 0;
const currentAction = ref('');
const draftName = ref('');

const typeOptions = [
  { value: 'INTEGER', label: '整数' },
  { value: 'BOOLEAN', label: '布尔' },
  { value: 'STRING', label: '文本' },
  { value: 'STRING_SET', label: '文本集合' }
];

const declaredFields = computed(() => [
  ...Object.keys(rightsDefs).map(name => `rights.${name}`),
  ...Object.keys(factsDefs).map(name => `facts.${name}`)
]);

const actionOptions = computed(() => productActions.value.map(action => ({ value: action, label: action })));

function fieldDefs(defs: Record<string, ModelFieldDef>, namespace: 'rights' | 'facts') {
  return Object.entries(defs).map(([name, def]) => ({ name, def, namespace }));
}

function addField(defs: Record<string, ModelFieldDef>, namespace: 'rights' | 'facts') {
  const base = namespace === 'rights' ? 'rightField' : 'factField';
  let index = 1;
  while (defs[`${base}${index}`]) index += 1;
  // INTEGER 字段发布级校验强制声明范围——默认给安全宽区间（0..1000000），表单可改
  defs[`${base}${index}`] = namespace === 'facts'
    ? { type: 'INTEGER', required: true, minimum: 0, maximum: 1000000, source: 'PRODUCT' }
    : { type: 'INTEGER', required: true, minimum: 0, maximum: 1000000 };
}

function removeField(defs: Record<string, ModelFieldDef>, name: string) {
  delete defs[name];
}

/** 字段重命名（失焦提交）：空名或冲突回退原名。 */
function renameField(defs: Record<string, ModelFieldDef>, oldName: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const next = input.value.trim();
  if (!next || next === oldName || next in defs) {
    input.value = oldName;
    return;
  }
  const def = defs[oldName];
  delete defs[oldName];
  defs[next] = def;
}

function addAction() {
  const candidate = productActions.value.find(action => !(action in actionTrees));
  if (!candidate) {
    errorMessage.value = '产品声明的动作都已配置条件树。';
    return;
  }
  actionTrees[candidate] = { all: [{ bool: true }] };
  currentAction.value = candidate;
}

function removeAction(action: string) {
  delete actionTrees[action];
  if (currentAction.value === action) {
    currentAction.value = Object.keys(actionTrees)[0] ?? '';
  }
}

function resetEditor(snapshot?: ModelSnapshot) {
  for (const key of Object.keys(rightsDefs)) delete rightsDefs[key];
  for (const key of Object.keys(factsDefs)) delete factsDefs[key];
  for (const key of Object.keys(actionTrees)) delete actionTrees[key];
  errorMessage.value = '';
  if (snapshot) {
    Object.assign(rightsDefs, JSON.parse(JSON.stringify(snapshot.fields.rights ?? {})));
    Object.assign(factsDefs, JSON.parse(JSON.stringify(snapshot.fields.facts ?? {})));
    Object.assign(actionTrees, JSON.parse(JSON.stringify(snapshot.actions ?? {})));
    const policyState = policiesFromSnapshot(snapshot, productActions.value);
    policies.value = policyState.policies;
    legacyPolicy.value = policyState.legacy;
    currentAction.value = Object.keys(actionTrees)[0] ?? '';
  } else {
    addField(rightsDefs, 'rights');
    addField(factsDefs, 'facts');
    policies.value = createModelPolicies(productActions.value);
    legacyPolicy.value = false;
    currentAction.value = '';
  }
}

function openCreate() {
  if (!canApi('license.model.manage')) return;
  editingVersionId.value = '';
  editingRowVersion.value = 1;
  draftName.value = '';
  resetEditor();
  editorOpen.value = true;
}

async function openDraftEdit(row: ModelVersionView) {
  if (!canApi('license.model.manage') || !canApi('license.model.read')) return;
  const request = ++editRequest;
  const productId = props.productId;
  try {
    const detail = await getModelVersion(row.modelVersionId) as ModelVersionDetail;
    if (!active || request !== editRequest || productId !== props.productId) return;
    if (detail.productId !== productId || detail.status !== 'DRAFT') throw new Error('请选择当前产品的草稿模型。');
    editingVersionId.value = row.modelVersionId;
    editingRowVersion.value = detail.rowVersion;
    resetEditor(detail.snapshot);
    editorOpen.value = true;
  } catch (error) {
    if (active && request === editRequest && productId === props.productId) errorMessage.value = error instanceof Error ? error.message : '详情读取未完成';
  }
}

function snapshotOf(): ModelSnapshot {
  return policiesToSnapshot({ fields: { rights: { ...rightsDefs }, facts: { ...factsDefs } }, actions: { ...actionTrees } }, policies.value);
}

async function submitEditor() {
  if (!canApi('license.model.manage')) return;
  if (Object.keys(actionTrees).length === 0) {
    errorMessage.value = '至少为一个动作配置条件树。';
    return;
  }
  const policyProduct = productView.value && Array.isArray(productView.value.supportedCapabilities) && Array.isArray(productView.value.declaredActions)
    ? productView.value as ProductView : undefined;
  policyErrors.value = validateModelPolicies(policies.value, policyProduct);
  if (policyErrors.value.length) {
    errorMessage.value = `政策校验未通过：${policyErrors.value[0]}`;
    return;
  }
  submitting.value = true; errorMessage.value = '';
  try {
    if (editingVersionId.value) {
      await patchDraftSnapshot(editingVersionId.value, snapshotOf(), editingRowVersion.value);
      message.value = '草稿快照已保存。';
    } else {
      const created = await createModel(props.productId, snapshotOf());
      message.value = `模型已创建（草稿）：${created.modelVersionId.slice(0, 12)}…`;
    }
    editorOpen.value = false;
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof LicenseApiError && error.status === 422
      ? `快照校验未通过：${error.message}`
      : error instanceof Error ? error.message : '提交未完成';
  } finally {
    submitting.value = false;
  }
}

async function publish(row: ModelVersionView) {
  if (!canApi('license.model.publish')) return;
  submitting.value = true; errorMessage.value = ''; message.value = '';
  try {
    await publishModelVersion(row.modelVersionId, row.rowVersion);
    message.value = '模型已发布（快照固化，不可再编辑）。';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '发布未完成';
  } finally {
    submitting.value = false;
  }
}

async function retire(row: ModelVersionView) {
  if (!canApi('license.model.publish')) return;
  submitting.value = true; errorMessage.value = ''; message.value = '';
  try {
    await retireModelVersion(row.modelVersionId, row.rowVersion);
    message.value = '模型已退役（禁止新引用，历史凭据不受影响）。';
    await loadPage();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '退役未完成';
  } finally {
    submitting.value = false;
  }
}

// ===== 完整模型详情（已发布也只读） =====
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
const detail = ref<ModelVersionDetail | null>(null);
const detailPolicies = ref<ModelPolicies>(createModelPolicies());
const detailLegacyPolicy = ref(false);
let detailRequest = 0;
async function openDetail(row: ModelVersionView) {
  if (!canApi('license.model.read')) return;
  const request = ++detailRequest;
  detailOpen.value = true; detailLoading.value = true; detailError.value = ''; detail.value = null;
  try {
    const loaded = await getModelVersion(row.modelVersionId);
    if (request !== detailRequest || !detailOpen.value) return;
    if (loaded.productId !== props.productId) throw new Error('模型不属于当前产品，请重新读取。');
    detail.value = loaded;
    const policyState = policiesFromSnapshot(loaded.snapshot, productActions.value);
    detailPolicies.value = policyState.policies;
    detailLegacyPolicy.value = policyState.legacy;
  } catch (error) {
    if (request === detailRequest && detailOpen.value) detailError.value = error instanceof Error ? error.message : '模型详情读取失败，请重试。';
  } finally { if (request === detailRequest) detailLoading.value = false; }
}
function closeDetail() { ++detailRequest; detailOpen.value = false; detail.value = null; }

// ===== 受限试算 =====

const evalOpen = ref(false);
const evalVersionId = ref('');
const evalAction = ref('');
const evalActions = ref<string[]>([]);
const evalRights = ref<RightsFieldInput[]>([]);
const evalFacts = ref<RightsFieldInput[]>([]);
const evalResult = ref('');
const evalErrorMessage = ref('');
const evalLoading = ref(false);
const evalReady = ref(false);
const evalPassed = ref(false);
let evalRequest = 0;

const evalActionOptions = computed(() => evalActions.value.map(action => ({ value: action, label: action })));

async function openEvaluate(row: ModelVersionView) {
  if (!canApi('license.model.read')) return;
  const request = ++evalRequest;
  evalVersionId.value = row.modelVersionId;
  evalAction.value = '';
  evalActions.value = [];
  evalRights.value = [];
  evalFacts.value = [];
  evalResult.value = '';
  evalErrorMessage.value = '';
  evalReady.value = false;
  evalLoading.value = true;
  evalOpen.value = true;
  try {
    const detail = await getModelVersion(row.modelVersionId);
    if (request !== evalRequest || !evalOpen.value) return;
    if (detail.productId !== props.productId) throw new Error('模型不属于当前产品，请重新读取。');
    evalRights.value = createRightsFields(detail.snapshot.fields.rights ?? {});
    evalFacts.value = createRightsFields(detail.snapshot.fields.facts ?? {});
    evalActions.value = Object.keys(detail.snapshot.actions ?? {});
    evalAction.value = evalActions.value[0] ?? '';
    evalReady.value = true;
  } catch (error) {
    if (request === evalRequest && evalOpen.value) evalErrorMessage.value = error instanceof Error ? error.message : '模型详情读取失败，请重试。';
  } finally {
    if (request === evalRequest) evalLoading.value = false;
  }
}

function closeEvaluate() {
  if (submitting.value) return;
  ++evalRequest;
  evalOpen.value = false;
  evalLoading.value = false;
}

async function submitEvaluate() {
  if (!canApi('license.model.read')) return;
  if (submitting.value || evalLoading.value || !evalReady.value || !evalAction.value) return;
  const request = evalRequest;
  submitting.value = true; evalResult.value = '';
  evalErrorMessage.value = '';
  try {
    const rights = serializeRightsFields(evalRights.value, true);
    const facts = serializeRightsFields(evalFacts.value, true);
    const outcome = await evaluateModelAction(evalVersionId.value, evalAction.value, rights, facts);
    if (request !== evalRequest || !evalOpen.value) return;
    evalPassed.value = outcome.declared;
    evalResult.value = outcome.declared ? '动作已声明（试算通过）' : '动作未声明（试算不通过）';
  } catch (error) {
    if (request === evalRequest && evalOpen.value) evalErrorMessage.value = error instanceof Error ? error.message : '试算未完成';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="license-page">
    <PageHeader
      :title="draftName || '条件模型'"
      description="字段声明与动作条件树的版本化模型（草稿→发布固化→退役）"
    >
      <template #actions>
        <button v-if="canApi('license.model.manage') && canApi('license.product.read')" class="button-primary" type="button" :disabled="productLoading || submitting" @click="openCreate"><Plus :size="15" aria-hidden="true" />新建模型</button>
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
          <h2>模型版本<span>{{ result.total }} 项</span></h2>
          <p>当前产品的条件模型版本族</p>
        </div>
      </header>
      <div :aria-busy="loading">
        <DataTable
          :columns="modelColumns"
          :rows="result.data"
          row-key="modelVersionId"
          :loading="loading"
          empty-text="暂无模型（新建后进入草稿编辑）"
        >
          <template #cell-modelVersionId="{ row }"><code>{{ row.modelVersionId }}</code></template>
          <template #cell-version="{ row }">v{{ row.version }}</template>
          <template #cell-status="{ row }">
            <span class="status-badge" :class="stateBadge(row.status)">{{ stateLabel(row.status) }}</span>
          </template>
          <template #cell-actions="{ row }">
            <span class="license-table-actions">
              <button v-if="canApi('license.model.read')" class="button-secondary" type="button" :disabled="submitting" @click="() => void openDetail(row)">查看详情</button>
              <button v-if="row.status === 'DRAFT' && canApi('license.model.manage') && canApi('license.model.read')" class="button-secondary" type="button" :disabled="submitting" @click="() => void openDraftEdit(row)">编辑草稿</button>
              <button v-if="row.status === 'DRAFT' && canApi('license.model.publish')" class="button-primary" type="button" :disabled="submitting" @click="() => void publish(row)">发布</button>
              <button v-if="canApi('license.model.read')" class="button-secondary" type="button" :disabled="submitting" @click="() => void openEvaluate(row)">试算</button>
              <button v-if="row.status === 'PUBLISHED' && canApi('license.model.publish')" class="button-secondary" type="button" :disabled="submitting" @click="() => void retire(row)">退役</button>
            </span>
          </template>
        </DataTable>
        <Pagination
          v-if="result.totalPages > 1"
          :current="1"
          :total="result.total"
          :page-size="20"
          :page-size-options="[20]"
        />
      </div>
    </section>

    <!-- 快照编辑（建模型 / 草稿编辑共用） -->
    <div v-if="editorOpen" class="dialog-backdrop" @click.self="editorOpen = false">
      <section class="confirm-dialog license-model-dialog" role="dialog" aria-modal="true"
               :aria-label="editingVersionId ? '编辑模型草稿' : '新建条件模型'" tabindex="-1">
        <header><h2>{{ editingVersionId ? '编辑模型草稿' : '新建条件模型' }}</h2><button type="button" class="icon-button" aria-label="关闭" @click="editorOpen = false"><X :size="18" /></button></header>
        <form class="license-form" @submit.prevent="() => void submitEditor()">
          <p v-if="productErrorMessage" class="license-message danger" role="alert"><span>{{ productErrorMessage }}</span><button class="button-secondary" type="button" :disabled="productLoading" @click="() => void loadProduct()">重读产品动作</button></p>
          <p v-if="legacyPolicy" class="license-message danger" role="alert">该模型是旧快照，只含字段与动作。保存前请确认下方完整政策；页面会显式写入政策，不会暗补服务端默认值。</p>
          <p v-if="policyErrors.length" class="license-hint">政策校验提示：{{ policyErrors[0] }}</p>
          <div class="license-field-defs">
            <strong>权益字段（rights）</strong>
            <div v-for="item in fieldDefs(rightsDefs, 'rights')" :key="item.name" class="license-field-defs-row">
              <input :value="item.name" aria-label="字段名" @change="renameField(rightsDefs, item.name, $event)" />
              <FormSelect v-model="item.def.type" :options="typeOptions" :aria-label="`${item.name} 类型`" />
              <label class="license-form-check"><input v-model="item.def.required" type="checkbox" />必填</label>
              <input v-model.number="item.def.minimum" type="number" aria-label="最小值" placeholder="min" />
              <input v-model.number="item.def.maximum" type="number" aria-label="最大值" placeholder="max" />
              <button type="button" class="button-secondary" :aria-label="`删除 ${item.name}`" @click="removeField(rightsDefs, item.name)"><X :size="14" /></button>
            </div>
            <button type="button" class="button-secondary license-tree-add" @click="addField(rightsDefs, 'rights')">+ 添加权益字段</button>
          </div>
          <div class="license-field-defs">
            <strong>事实字段（facts）</strong>
            <div v-for="item in fieldDefs(factsDefs, 'facts')" :key="item.name" class="license-field-defs-row">
              <input :value="item.name" aria-label="字段名" @change="renameField(factsDefs, item.name, $event)" />
              <FormSelect v-model="item.def.type" :options="typeOptions" :aria-label="`${item.name} 类型`" />
              <label class="license-form-check"><input v-model="item.def.required" type="checkbox" />必填</label>
              <input v-model.number="item.def.minimum" type="number" aria-label="最小值" placeholder="min" />
              <input v-model.number="item.def.maximum" type="number" aria-label="最大值" placeholder="max" />
              <button type="button" class="button-secondary" :aria-label="`删除 ${item.name}`" @click="removeField(factsDefs, item.name)"><X :size="14" /></button>
            </div>
            <button type="button" class="button-secondary license-tree-add" @click="addField(factsDefs, 'facts')">+ 添加事实字段</button>
          </div>
          <div class="license-field-defs">
            <strong>动作条件树</strong>
            <div v-for="(tree, action) in actionTrees" :key="action" class="license-tree-row">
              <code>{{ action }}</code>
              <button type="button" class="button-secondary license-tree-remove" :aria-label="`删除动作 ${action}`" @click="removeAction(action)"><X :size="14" /></button>
              <button v-if="currentAction !== action" type="button" class="button-secondary" @click="currentAction = action">编辑此树</button>
            </div>
            <button type="button" class="button-secondary license-tree-add" @click="addAction">+ 从产品声明动作添加</button>
            <p v-if="productActions.length === 0" class="license-hint">产品未登记声明动作，无法配置条件树（先在产品节面登记）。</p>
          </div>
          <ConditionTreeEditor
            v-if="currentAction && currentAction in actionTrees"
            :model-value="actionTrees[currentAction]!"
            :fields="declaredFields"
            @update:model-value="value => { actionTrees[currentAction] = value; }"
          />
          <ModelPolicyEditor
            v-model="policies"
            :product="productView && Array.isArray(productView.supportedCapabilities) && Array.isArray(productView.declaredActions) ? productView as ProductView : undefined"
            :disabled="submitting"
            @validity-change="value => { policyErrors = value; }"
          />
          <footer>
            <button type="button" class="button-secondary" :disabled="submitting" @click="editorOpen = false">取消</button>
            <button v-if="canApi('license.model.manage')" type="submit" class="button-primary" :disabled="submitting || Object.keys(actionTrees).length === 0">
              {{ submitting ? '提交中…' : editingVersionId ? '保存草稿' : '创建模型' }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <Drawer :open="detailOpen" title="模型详情" description="完整展示字段、动作与发布政策；已发布版本不可在此修改。" :pending="detailLoading" @close="closeDetail">
      <div class="license-detail-stack">
        <p v-if="detailLoading" class="license-hint" role="status">正在读取模型详情…</p>
        <p v-if="detailError" class="license-message danger" role="alert">{{ detailError }}</p>
        <template v-if="detail">
          <dl class="license-detail-grid"><div><dt>版本</dt><dd>v{{ detail.version }}</dd></div><div><dt>状态</dt><dd>{{ stateLabel(detail.status) }}</dd></div><div><dt>模型编号</dt><dd><code>{{ detail.modelVersionId }}</code></dd></div><div><dt>行版本</dt><dd>{{ detail.rowVersion }}</dd></div></dl>
          <section><h3>字段与动作</h3><p class="license-hint">字段 {{ Object.keys(detail.snapshot.fields.rights ?? {}).length + Object.keys(detail.snapshot.fields.facts ?? {}).length }} 项；动作 {{ Object.keys(detail.snapshot.actions ?? {}).length }} 项。</p><pre class="license-policy-json">{{ JSON.stringify({ fields: detail.snapshot.fields, actions: detail.snapshot.actions }, null, 2) }}</pre></section>
          <section v-if="!detailLegacyPolicy"><h3>完整政策</h3><ul class="license-policy-summary"><li v-for="line in policySummary(detailPolicies)" :key="line">{{ line }}</li></ul><ModelPolicyEditor v-model="detailPolicies" :product="productView && Array.isArray(productView.supportedCapabilities) && Array.isArray(productView.declaredActions) ? productView as ProductView : undefined" disabled /></section>
          <p v-else class="license-message danger">该版本是旧快照，未声明完整政策。它可以读取与试算，但不能将缺失政策当作已支持能力。</p>
        </template>
      </div>
    </Drawer>

    <!-- 受限试算 -->
    <Drawer :open="evalOpen" title="受限试算" description="按模型声明的真实类型填写权益与事实，只判定动作条件，不签发凭据。" :pending="submitting" @close="closeEvaluate">
        <form class="drawer-form license-model-evaluation" @submit.prevent="() => void submitEvaluate()">
          <p v-if="evalLoading" class="license-hint" role="status">正在读取模型…</p>
          <p v-if="evalErrorMessage" class="license-message danger" role="alert">{{ evalErrorMessage }}</p>
          <div class="license-field">
            <span>动作</span>
            <FormSelect v-model="evalAction" :options="evalActionOptions" aria-label="试算动作" :disabled="submitting || evalLoading" />
          </div>
          <RightsFieldsEditor :fields="evalRights" :disabled="submitting || evalLoading" />
          <RightsFieldsEditor :fields="evalFacts" label="事实" :disabled="submitting || evalLoading" />
          <p v-if="evalResult" class="license-message" :class="evalPassed ? 'success' : ''" role="status">{{ evalResult }}</p>
          <div class="drawer-actions">
            <button type="button" class="button-secondary" :disabled="submitting" @click="closeEvaluate">关闭</button>
            <button v-if="canApi('license.model.read')" type="submit" class="button-primary" :disabled="submitting || evalLoading || !evalReady || !evalAction">{{ submitting ? '试算中…' : '试算' }}</button>
          </div>
        </form>
    </Drawer>
  </section>
</template>
