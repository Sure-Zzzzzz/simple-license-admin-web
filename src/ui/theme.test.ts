import { describe, expect, it, vi } from 'vitest';
import { createDefaultCustomThemeTokens, type ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';
import { bindLicenseTheme } from './theme';

describe('License 挂载容器主题', () => {
  it('业务根异步出现前，容器已经接收门户主题及后续更新', () => {
    const root = document.createElement('div');
    let update!: (value: ThemeSnapshot) => void;
    const unsubscribe = vi.fn();
    const release = bindLicenseTheme(root, { current: () => ({ contractVersion: 1, mode: 'dark', customTokens: {} }), subscribe: listener => { update = listener; return unsubscribe; } });
    expect(root.dataset.iamTheme).toBe('dark');
    update({ contractVersion: 1, mode: 'custom', customTokens: createDefaultCustomThemeTokens() });
    expect(root.style.getPropertyValue('--iam-color-primary')).toBe('#1D4ED8');
    release();
    expect(unsubscribe).toHaveBeenCalledOnce();
    update({ contractVersion: 1, mode: 'dark', customTokens: {} });
    expect(root.hasAttribute('data-iam-theme')).toBe(false);
  });
  it('卸载恢复原主题值与priority，保留宿主的其他样式', () => {
    const root = document.createElement('div');
    root.setAttribute('data-iam-theme', 'dark');
    root.style.setProperty('--iam-color-primary', '#abcdef', 'important');
    root.style.setProperty('padding', '10px');
    // jsdom 的 cssstyle 不保存自定义变量 priority；检查传给浏览器的原始恢复参数。
    vi.spyOn(root.style, 'getPropertyPriority').mockImplementation(name => name === '--iam-color-primary' ? 'important' : '');
    const setProperty = vi.spyOn(root.style, 'setProperty');
    const release = bindLicenseTheme(root);
    root.style.setProperty('padding', '12px');
    release();
    expect(root.dataset.iamTheme).toBe('dark');
    expect(root.style.getPropertyValue('--iam-color-primary')).toBe('#abcdef');
    expect(setProperty).toHaveBeenCalledWith('--iam-color-primary', '#abcdef', 'important');
    expect(root.style.padding).toBe('12px');
  });
});
