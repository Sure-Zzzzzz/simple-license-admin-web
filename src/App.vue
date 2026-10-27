<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { finishAuthorization } from './auth/pkce';
import { licenseState } from './licenseState';
import { canSection, firstAccessibleRoute, permissionState, sectionPages } from './auth/permissions';
import IdentitySection from './section/IdentitySection.vue';
import ProductSection from './section/ProductSection.vue';
import GrantSection from './section/GrantSection.vue';
import SubjectAssignmentSection from './section/SubjectAssignmentSection.vue';
import ActivationSection from './section/ActivationSection.vue';
import OpsSection from './section/OpsSection.vue';
import IntegrationSection from './section/IntegrationSection.vue';
import SigningProfileSection from './section/SigningProfileSection.vue';
import ModelSection from './section/ModelSection.vue';
import PlanSection from './section/PlanSection.vue';
import OrganizationBindingSection from './section/OrganizationBindingSection.vue';
import OperationsSection from './section/OperationsSection.vue';

const props = defineProps<{ section: string; customerId?: string; productId?: string; grantId?: string }>();
const route = useRoute();
const router = useRouter();

const standalone = computed(() => !licenseState.bridge);
const allowedSection = computed(() => !sectionPages[props.section] || canSection(props.section));

const parentLink = computed(() => {
  if (props.section === 'organization-binding' && canSection('customers')) return { label: '返回客户列表', to: '/customers' };
  if ((props.section === 'application-bindings' || props.section === 'models') && canSection('products')) return { label: '返回产品列表', to: '/products' };
  if ((props.section === 'subject-assignments' || props.section === 'activations') && canSection('grants')) return { label: '返回授权列表', to: '/grants' };
  return null;
});

const errorMessage = ref('');
const message = ref('');
let callbackRequest = 0;
let active = true;

function backToPortal(): void {
  window.location.assign('/app/');
}

function openAllowedPage() {
  const path = firstAccessibleRoute();
  if (path) void router.push(path);
  else backToPortal();
}

async function callback() {
  const request = ++callbackRequest;
  try {
    const target = await finishAuthorization() ?? '/issuers';
    if (!active || request !== callbackRequest || props.section !== 'oauth-callback') return;
    // 乾坤宿主内直接写 history 会被宿主 reroute 吞掉；整页回到门户壳，
    // 让已落入 sessionStorage 的令牌由新的子应用实例稳定读取。
    if (licenseState.bridge) {
      window.location.replace(`.${target}`);
      return;
    }
    await router.replace(target);
  } catch (error) {
    if (active && request === callbackRequest && props.section === 'oauth-callback') errorMessage.value = error instanceof Error ? error.message : '授权未完成';
  }
}

onMounted(() => { if (props.section === 'oauth-callback') void callback(); });
watch(() => props.section, () => {
  if (props.section === 'oauth-callback') void callback();
  else ++callbackRequest;
});
watch(() => route.fullPath, () => { errorMessage.value = ''; message.value = ''; });
onBeforeUnmount(() => { active = false; ++callbackRequest; });
</script>

<template>
  <!-- 门户菜单由宿主承载；独立打开时仅提供标题和返回门户出口（CRM 同构）。 -->
  <main class="license-admin-app" :class="{ 'license-admin-app--standalone': standalone }">
    <template v-if="props.section !== 'oauth-callback'">
      <header v-if="standalone" class="license-standalone-header">
        <h1>License 管理台</h1>
        <button class="button-secondary" type="button" @click="backToPortal">返回门户</button>
      </header>
      <section class="content">
        <div v-if="allowedSection && parentLink" class="license-back-bar">
          <button class="button-secondary" type="button" @click="router.push(parentLink.to)">← {{ parentLink.label }}</button>
        </div>
        <p v-if="errorMessage" class="license-message danger" role="alert">{{ errorMessage }}</p>
        <p v-if="message" class="license-message success" role="status">{{ message }}</p>
        <section v-if="!allowedSection || props.section === 'forbidden'" class="panel" role="alert">
          <h2>{{ permissionState.loading ? '正在读取页面权限…' : '暂无此页面权限' }}</h2>
          <p class="license-hint">{{ permissionState.loading ? '权限确认后再加载业务数据。' : '请联系管理员授权，或进入已获授权的页面。' }}</p>
          <button v-if="!permissionState.loading" class="button-secondary" type="button" @click="openAllowedPage">{{ firstAccessibleRoute() ? '进入已授权页面' : '返回门户' }}</button>
        </section>
        <section v-else-if="props.section === 'access-error'" class="panel" role="alert">
          <h2>权限读取未完成</h2>
          <p class="license-hint">{{ permissionState.errorMessage || '请重新进入 License，确认身份与服务可用。' }}</p>
          <button class="button-secondary" type="button" @click="router.replace('/')">重新读取权限</button>
        </section>
        <IdentitySection v-else-if="['issuers', 'customers'].includes(props.section)" :section="props.section" />
        <ProductSection v-else-if="['products', 'application-bindings'].includes(props.section)" :key="props.productId ?? 'products'" :section="props.section" :product-id="props.productId" />
        <GrantSection v-else-if="props.section === 'grants'" :section="props.section" />
        <SubjectAssignmentSection v-else-if="props.section === 'subject-assignments'" :key="props.grantId" :section="props.section" :grant-id="props.grantId" />
        <ActivationSection v-else-if="props.section === 'activations'" :key="props.grantId" :section="props.section" :grant-id="props.grantId" />
        <OpsSection v-else-if="['credentials', 'revocations'].includes(props.section)" :section="props.section" />
        <IntegrationSection v-else-if="props.section === 'integration-commands'" :section="props.section" />
        <SigningProfileSection v-else-if="props.section === 'signing-profiles'" :section="props.section" />
        <ModelSection v-else-if="props.section === 'models'" :key="props.productId" :section="props.section" :product-id="props.productId ?? ''" />
        <PlanSection v-else-if="props.section === 'plans'" :section="props.section" />
        <OperationsSection v-else-if="props.section === 'operations'" :section="props.section" />
        <OrganizationBindingSection v-else-if="props.section === 'organization-binding'" :key="props.customerId" :section="props.section" :customer-id="props.customerId ?? ''" />
        <section v-else class="panel" role="alert">
          <p class="license-empty">页面不存在：{{ route.fullPath }}</p>
          <button class="button-secondary" type="button" @click="openAllowedPage">{{ firstAccessibleRoute() ? '进入已授权页面' : '返回门户' }}</button>
        </section>
      </section>
    </template>
    <section v-else class="panel">
      <p class="license-message danger" v-if="errorMessage" role="alert">{{ errorMessage }}</p>
      <p v-else class="license-empty">正在完成授权…</p>
    </section>
  </main>
</template>
