import { encryptSecret } from '../crypto/secretCipher.js';
import { maskAppKey } from '../crypto/mask.js';
import * as repository from '../repositories/kisCredentialsRepository.js';
import { clearTokenCache } from './kisAuthService.js';

export function getSettings(userId) {
  return toSafeSettings(repository.getByUserId(userId));
}

export function saveSettings(userId, input) {
  const appKey = String(input.appKey || '').trim();
  const appSecret = String(input.appSecret || input.secretKey || '').trim();
  const accountNumber = String(input.accountNumber || '').trim();
  const accountProductCode = String(input.accountProductCode || '').trim();

  if (!appKey || !appSecret) {
    const error = new Error('App Key와 App Secret을 입력하세요.');
    error.status = 400;
    throw error;
  }

  const credential = repository.upsertCredential({
    userId,
    appKeyMasked: maskAppKey(appKey),
    appKeyEncrypted: encryptSecret(appKey),
    appSecretEncrypted: encryptSecret(appSecret),
    accountNumberEncrypted: accountNumber ? encryptSecret(accountNumber) : null,
    accountProductCodeEncrypted: accountProductCode ? encryptSecret(accountProductCode) : null
  });

  clearTokenCache(userId);
  return toSafeSettings(credential);
}

export function deleteSettings(userId) {
  repository.deleteByUserId(userId);
  clearTokenCache(userId);
}

export function toSafeSettings(credential) {
  return {
    configured: Boolean(credential),
    status: credential?.status || 'NOT_CONFIGURED',
    appKeyMasked: credential?.appKeyMasked || '',
    accountConfigured: Boolean(credential?.accountNumberEncrypted),
    lastTokenIssuedAt: credential?.lastTokenIssuedAt || '',
    lastTokenErrorMessage: credential?.lastTokenErrorMessage || ''
  };
}
