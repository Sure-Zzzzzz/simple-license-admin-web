import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import SigningProfileSection from './SigningProfileSection.vue';
import type { SigningProfileView } from '../api/domain';
vi.mock('../auth/permissions', () => ({ canApi: vi.fn(() => true) }));
vi.mock('../api/domain', () => ({ createSigningProfile: vi.fn(), listSigningProfiles: vi.fn() }));
import { canApi } from '../auth/permissions';
import { createSigningProfile, listSigningProfiles } from '../api/domain';
enableAutoUnmount(afterEach);

const row: SigningProfileView = { profileId: 'profile-current', productId: 'product-1', purpose: 'CREDENTIAL', kid: 'kid-current',
  status: 'ACTIVE', rowVersion: 8, publicKeyFingerprint: 'mock-fingerprint', createdAt: null, retiredAt: null };

async function openRotation() {
  const wrapper = mount(SigningProfileSection, { props: { section: 'signing-profiles' } });
  await flushPromises();
  await wrapper.find('tbody button').trigger('click');
  return wrapper;
}

describe('签名档案真实编号与轮换契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canApi).mockReturnValue(true);
    vi.mocked(listSigningProfiles).mockResolvedValue({ data: [row], total: 1, page: 1, size: 20, totalPages: 1 });
    vi.mocked(createSigningProfile).mockResolvedValue({ ...row, profileId: 'profile-new', kid: 'kid-new', rowVersion: 1 });
  });

  it('列表承接profileId，轮换提交真实编号及服务端行版本', async () => {
    const wrapper = await openRotation();
    expect(wrapper.find('tbody').text()).toContain('profile-current');
    expect((wrapper.find('[aria-label="期望在用档案"]').element as HTMLInputElement).value).toBe('profile-current');
    expect(wrapper.find('[aria-label="期望在用档案"]').attributes('readonly')).toBeDefined();
    expect(wrapper.find('[aria-label="期望档案版本"]').attributes('readonly')).toBeDefined();
    await wrapper.find('[aria-label="业务 kid"]').setValue('kid-new');
    await wrapper.find('[aria-label="KMS 逻辑钥引用"]').setValue('kms-key-next');
    await wrapper.find('[aria-label="精确钥版本"]').setValue('5');
    await wrapper.find('.confirm-dialog footer button.button-primary').trigger('click');
    await flushPromises();
    expect(createSigningProfile).toHaveBeenCalledWith({ productId: 'product-1', purpose: 'CREDENTIAL', kid: 'kid-new',
      keyRef: 'kms-key-next', keyVersion: 5, expectedProfileId: 'profile-current', expectedRowVersion: 8 });
  });

  it('取消轮换后打开新建，不把旧档案围栏带入另一产品', async () => {
    const wrapper = await openRotation();
    await wrapper.find('.confirm-dialog button[aria-label="关闭"]').trigger('click');
    await wrapper.find('header button.button-primary').trigger('click');
    expect(wrapper.find('[aria-label="期望在用档案"]').exists()).toBe(false);
    expect((wrapper.find('[aria-label="产品编号"]').element as HTMLInputElement).value).toBe('');
    await wrapper.find('[aria-label="产品编号"]').setValue('product-2');
    await wrapper.find('[aria-label="业务 kid"]').setValue('kid-2');
    await wrapper.find('[aria-label="KMS 逻辑钥引用"]').setValue('kms-key-2');
    await wrapper.find('.confirm-dialog footer button.button-primary').trigger('click');
    await flushPromises();
    expect(createSigningProfile).toHaveBeenCalledWith({ productId: 'product-2', purpose: 'CREDENTIAL', kid: 'kid-2', keyRef: 'kms-key-2', keyVersion: 1 });
  });

  it('轮换冲突保留回读围栏，权限撤销后不能再提交', async () => {
    vi.mocked(createSigningProfile).mockRejectedValue(new Error('档案已变化，请回读'));
    const wrapper = await openRotation();
    await wrapper.find('[aria-label="业务 kid"]').setValue('kid-new');
    await wrapper.find('[aria-label="KMS 逻辑钥引用"]').setValue('kms-key-next');
    await wrapper.find('.confirm-dialog footer button.button-primary').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('档案已变化，请回读');
    expect((wrapper.find('[aria-label="期望在用档案"]').element as HTMLInputElement).value).toBe('profile-current');
    vi.mocked(canApi).mockReturnValue(false);
    await wrapper.find('.confirm-dialog footer button.button-primary').trigger('click');
    expect(createSigningProfile).toHaveBeenCalledTimes(1);
  });
});
