import { reactive } from 'vue';
import { request } from '../api/http';
import { licenseState } from '../licenseState';
import { getAccessToken, getAuthorizationGeneration } from './pkce';

export interface LicenseMe {
  principalId: string;
  pagePermissions: string[];
  apiPermissions: string[];
}

/** 仅消费 License 服务器提供的授权快照；不从角色名、门户菜单或管理员名字推导权限。 */
export const permissionState = reactive({
  ready: false, loading: false, errorMessage: '',
  pagePermissions: [] as string[], apiPermissions: [] as string[]
});
let loadedToken: string | null = null;
let loadedBase = '';
let loadedAuthorizationGeneration = -1;
let generation = 0;
let pendingController: AbortController | null = null;

export const sectionPages: Record<string, string> = {
  issuers: 'license.page.issuers', customers: 'license.page.customers',
  'organization-binding': 'license.page.customers', products: 'license.page.products',
  'application-bindings': 'license.page.products', models: 'license.page.models', plans: 'license.page.plans',
  grants: 'license.page.grants', 'subject-assignments': 'license.page.subject-assignments',
  activations: 'license.page.activations', credentials: 'license.page.credentials',
  operations: 'license.page.operations', revocations: 'license.page.revocations',
  'signing-profiles': 'license.page.signing-profiles', 'integration-commands': 'license.page.integrations'
};

function currentSnapshot(): boolean {
  return permissionState.ready && loadedToken !== null && loadedToken === getAccessToken() && loadedBase === licenseState.apiBase && loadedAuthorizationGeneration === getAuthorizationGeneration();
}
export function canPage(code: string): boolean { return currentSnapshot() && permissionState.pagePermissions.includes(code); }
export function canApi(code: string): boolean { return currentSnapshot() && permissionState.apiPermissions.includes(code); }
export function canSection(section: string): boolean {
  const permission = sectionPages[section];
  return Boolean(permission && canPage(permission));
}

export function resetPermissions() {
  ++generation;
  pendingController?.abort();
  pendingController = null;
  loadedToken = null;
  Object.assign(permissionState, { ready: false, loading: false, errorMessage: '', pagePermissions: [], apiPermissions: [] });
}

export async function loadPermissions(): Promise<void> {
  resetPermissions();
  const expectedGeneration = generation;
  const token = getAccessToken();
  const authorizationGeneration = getAuthorizationGeneration();
  const apiBase = licenseState.apiBase;
  const controller = new AbortController();
  pendingController = controller;
  permissionState.loading = true;
  try {
    const me = await request<LicenseMe>('/api/license/v1/me', { signal: controller.signal });
    if (expectedGeneration !== generation || controller.signal.aborted || token !== getAccessToken() || apiBase !== licenseState.apiBase || authorizationGeneration !== getAuthorizationGeneration()) throw new DOMException('权限读取已取消', 'AbortError');
    if (!me || !Array.isArray(me.pagePermissions) || !Array.isArray(me.apiPermissions)
      || !me.pagePermissions.every(code => typeof code === 'string') || !me.apiPermissions.every(code => typeof code === 'string')) {
      throw new Error('权限快照不完整，请检查 License 服务的 /me 契约。');
    }
    loadedToken = token;
    loadedBase = apiBase;
    loadedAuthorizationGeneration = authorizationGeneration;
    permissionState.pagePermissions = [...me.pagePermissions];
    permissionState.apiPermissions = [...me.apiPermissions];
    permissionState.ready = true;
  } catch (error) {
    if (expectedGeneration === generation && !controller.signal.aborted) {
      permissionState.errorMessage = error instanceof Error ? error.message : '权限读取未完成';
    }
    throw error;
  } finally {
    if (expectedGeneration === generation) {
      pendingController = null;
      permissionState.loading = false;
    }
  }
}

export function firstAccessibleRoute(): string | null {
  const entries = ['issuers', 'customers', 'products', 'plans', 'grants', 'credentials', 'operations', 'revocations', 'signing-profiles', 'integration-commands'];
  const section = entries.find(canSection);
  return section ? `/${section}` : null;
}
