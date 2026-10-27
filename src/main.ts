import { createApp, type App as VueApp } from 'vue';
import { createWebHistory, RouterView, type Router } from 'vue-router';
import { qiankunWindow, renderWithQiankun } from 'vite-plugin-qiankun/dist/helper';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import { createLicenseRouter } from './router';
import { cancelPendingAuthorization } from './auth/pkce';
import { applyLicenseProps, licenseState, type LicenseMountProps } from './licenseState';
import { bindLicenseTheme } from './ui/theme';
import './style.css';
import './extra.css';

let app: VueApp<Element> | null = null;
let router: Router | null = null;
let releaseRouter: () => void = () => undefined;

let releaseTheme: () => void = () => undefined;
function render(props: LicenseMountProps = {}) {
  const container = props.container ? props.container.querySelector<HTMLElement>('#app') : document.querySelector<HTMLElement>('#app');
  if (!container) throw new Error('未找到 License 应用挂载容器');
  applyLicenseProps(props);
  releaseRouter();
  const routing = createLicenseRouter(createWebHistory(`${licenseState.routePrefix}/`));
  router = routing.router;
  releaseRouter = routing.dispose;
  app = createApp(RouterView);
  app.use(router);
  app.mount(container);
  // 路由先异步读取权限，初次挂载时业务根尚不存在；主题落在常驻挂载容器，由节面继承。
  releaseTheme();
  releaseTheme = bindLicenseTheme(container, props.theme);
}

if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  render();
}

renderWithQiankun({
  mount(props) { render(props as LicenseMountProps); },
  bootstrap() { return Promise.resolve(); },
  update() { return Promise.resolve(); },
  unmount() { cancelPendingAuthorization(); releaseTheme(); releaseTheme = () => undefined; releaseRouter(); releaseRouter = () => undefined; app?.unmount(); app = null; router = null; applyLicenseProps(); }
});
