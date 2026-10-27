import { applyTheme, createLightThemePreference, CUSTOM_THEME_TOKEN_KEYS, type ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';
import type { LicenseMountProps } from '../licenseState';

/** 在常驻挂载容器应用主题，权限路由异步加载时仍可继承；卸载仅恢复本应用管理的属性。 */
export function bindLicenseTheme(root: HTMLElement, theme?: LicenseMountProps['theme']): () => void {
  const themeAttribute = root.getAttribute('data-iam-theme');
  const variables = CUSTOM_THEME_TOKEN_KEYS.map(token => `--iam-color-${token.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`);
  const previous = variables.map(name => ({ name, value: root.style.getPropertyValue(name), priority: root.style.getPropertyPriority(name) }));
  let active = true;
  const apply = (snapshot: ThemeSnapshot) => { if (active) applyTheme(root, snapshot); };
  apply(theme?.current() ?? createLightThemePreference());
  const unsubscribe = theme?.subscribe(apply) ?? (() => undefined);
  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
    for (const { name, value, priority } of previous) {
      if (value) root.style.setProperty(name, value, priority);
      else root.style.removeProperty(name);
    }
    if (themeAttribute === null) root.removeAttribute('data-iam-theme');
    else root.setAttribute('data-iam-theme', themeAttribute);
  };
}
