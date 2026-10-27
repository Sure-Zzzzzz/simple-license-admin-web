<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '@sure-zzzzzz/simple-iam-theme-contract/PageHeader';
import { getOrganizationBinding, putOrganizationBinding, type OrganizationBindingView } from '../api/domain';
import { canApi } from '../auth/permissions';

/**
 * 客户组织绑定（IAM 部门准入事实源）：读绑/重绑（重绑递增代数）。
 * 绑定存在即启用目录准入——CUSTOMER_MEMBERS 在线判定按此回查部门子树。
 */
const props = defineProps<{ section: string; customerId: string }>();

const loading = ref(false);
const submitting = ref(false);
const errorMessage = ref('');
const message = ref('');
const bound = ref<OrganizationBindingView | null>(null);
const form = reactive({ organizationInstanceId: '', rootDepartmentId: '' });

async function load() {
  errorMessage.value = ''; loading.value = true;
  try {
    bound.value = await getOrganizationBinding(props.customerId);
    form.organizationInstanceId = bound.value.organizationInstanceId ?? '';
    form.rootDepartmentId = bound.value.rootDepartmentId != null ? String(bound.value.rootDepartmentId) : '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取未完成';
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!canApi('license.customer.manage')) return;
  errorMessage.value = ''; message.value = ''; submitting.value = true;
  try {
    const rootDepartmentId = Number(form.rootDepartmentId);
    if (!Number.isInteger(rootDepartmentId) || rootDepartmentId <= 0) {
      errorMessage.value = '授权根部门必须为正整数';
      return;
    }
    await putOrganizationBinding(props.customerId, {
      organizationInstanceId: form.organizationInstanceId, rootDepartmentId
    });
    message.value = '组织绑定已保存（绑定代数已更新，联动清单按代数识别过期差异）。';
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存未完成';
  } finally {
    submitting.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="license-page">
    <PageHeader
      title="客户组织绑定"
      description="绑定 IAM 组织实例与授权根部门——绑定后客户成员判定按部门子树准入"
    />
    <p v-if="errorMessage" class="license-message danger" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" class="button-secondary" :disabled="loading" @click="() => void load()">重试</button>
    </p>
    <p v-if="message" class="license-message success" role="status">{{ message }}</p>
    <section class="panel">
      <header class="data-toolbar">
        <div>
          <h2>当前绑定<span v-if="bound?.bindingGeneration">第 {{ bound.bindingGeneration }} 代</span></h2>
          <p>{{ bound?.organizationInstanceId ? '已绑定——部门准入已启用' : '未绑定——不启用目录准入' }}</p>
        </div>
      </header>
      <form class="license-form" @submit.prevent="() => void submit()">
        <label>组织实例标识<input v-model.trim="form.organizationInstanceId" :disabled="submitting" required maxlength="128" /></label>
        <label>授权根部门编号<input v-model.trim="form.rootDepartmentId" :disabled="submitting" required inputmode="numeric" placeholder="IAM 部门 ID（正整数）" /></label>
        <p class="license-hint">重绑会递增绑定代数；基于旧代数生成的角色联动清单将整体过期，需重新生成。</p>
        <footer>
          <button v-if="canApi('license.customer.manage')" type="submit" class="button-primary" :disabled="submitting || !form.organizationInstanceId || !form.rootDepartmentId">
            {{ submitting ? '保存中…' : '保存绑定' }}
          </button>
        </footer>
      </form>
    </section>
  </section>
</template>
