import { reactive } from 'vue';
import type { ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';

export interface LicenseMountProps {
  container?: Element | Document;
  routePrefix?: string;
  apiBase?: string | null;
  onUnauthorized?: () => void;
  theme?: { current(): ThemeSnapshot; subscribe(listener: (value: ThemeSnapshot) => void): () => void };
}

/** bridge 为真表示当前由乾坤宿主挂载；该环境下直接写 history 会被宿主 reroute 吞掉。 */
export const licenseState = reactive({
  apiBase: '',
  routePrefix: '/app/license',
  bridge: false,
  onUnauthorized: undefined as (() => void) | undefined
});

export function applyLicenseProps(props: LicenseMountProps = {}) {
  licenseState.apiBase = typeof props.apiBase === 'string' ? props.apiBase.replace(/\/+$/, '') : '';
  const prefix = props.routePrefix?.replace(/\/+$/, '') || '/app/license';
  licenseState.routePrefix = /^\/[a-zA-Z0-9/_-]+$/.test(prefix) && !prefix.includes('//') ? prefix : '/app/license';
  licenseState.bridge = Boolean(props.container);
  licenseState.onUnauthorized = props.onUnauthorized;
}
