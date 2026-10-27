import { createRouter, type RouterHistory, type RouteRecordRaw } from 'vue-router';
import App from './App.vue';
import { canPage, firstAccessibleRoute, loadPermissions, permissionState, resetPermissions, sectionPages } from './auth/permissions';
import { cancelPendingAuthorization } from './auth/pkce';

export function createLicenseRouter(history: RouterHistory) {
  const page = (path: string, section: string, key?: 'customerId' | 'productId' | 'grantId'): RouteRecordRaw => ({
    path, component: App,
    props: key ? route => ({ section, [key]: route.params[key] as string }) : { section },
    meta: { pagePermission: sectionPages[section] }
  });
  const router = createRouter({ history, routes: [
    { path: '/', component: App, props: { section: 'entry' } },
    { path: '/index.html', component: App, props: { section: 'entry' } },
    page('/issuers', 'issuers'), page('/customers', 'customers'),
    page('/customers/:customerId/organization-binding', 'organization-binding', 'customerId'),
    page('/products', 'products'), page('/products/:productId/application-bindings', 'application-bindings', 'productId'),
    page('/products/:productId/models', 'models', 'productId'), page('/plans', 'plans'), page('/grants', 'grants'),
    page('/grants/:grantId/subject-assignments', 'subject-assignments', 'grantId'),
    page('/grants/:grantId/activations', 'activations', 'grantId'), page('/credentials', 'credentials'),
    page('/operations', 'operations'), page('/revocations', 'revocations'), page('/signing-profiles', 'signing-profiles'),
    page('/integration-commands', 'integration-commands'),
    { path: '/oauth-callback', component: App, props: { section: 'oauth-callback' } },
    { path: '/403', component: App, props: { section: 'forbidden' } },
    { path: '/access-error', component: App, props: { section: 'access-error' } },
    { path: '/:pathMatch(.*)*', component: App, props: { section: 'not-found' } }
  ] });
  let navigation = 0;
  let active = true;
  const releaseGuard = router.beforeEach(async (to, from) => {
    const current = ++navigation;
    if (from.path === '/oauth-callback' && to.path !== '/oauth-callback') cancelPendingAuthorization();
    const permission = to.meta.pagePermission as string | undefined;
    const entry = to.path === '/' || to.path === '/index.html';
    if (!active) return false;
    if (!permission && !entry) { if (permissionState.loading || to.path === '/oauth-callback') resetPermissions(); return true; }
    try {
      await loadPermissions();
      if (!active || current !== navigation) return false;
      if (entry) return firstAccessibleRoute() ?? '/403';
      return canPage(permission!) ? true : '/403';
    } catch (error) {
      if (!active || current !== navigation || (error instanceof Error && error.name === 'AbortError')) return false;
      return '/access-error';
    }
  });
  function dispose() {
    active = false;
    ++navigation;
    releaseGuard();
    resetPermissions();
  }
  return { router, dispose };
}
