import { getAccessToken, getAuthorizationGeneration } from '../auth/pkce';
import { licenseState } from '../licenseState';

/** 异步界面回写与后续操作共同核对授权实例，防止迟到的旧身份结果留在当前抽屉。 */
export function captureLicenseSession(): () => boolean {
  const token = getAccessToken();
  const generation = getAuthorizationGeneration();
  const apiBase = licenseState.apiBase;
  return () => token === getAccessToken() && generation === getAuthorizationGeneration() && apiBase === licenseState.apiBase;
}
