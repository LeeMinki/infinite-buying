import { env } from '../config/env.js';
import { encryptSecret } from '../crypto/secretCipher.js';
import { maskAppKey } from '../crypto/mask.js';
import * as repository from '../repositories/kiwoomCredentialsRepository.js';

export function getSettings(userId) {
  const credential = repository.getByUserId(userId);
  return {
    configured: Boolean(credential),
    ec2ElasticIp: env.ec2ElasticIp,
    status: credential?.status || 'NOT_CONFIGURED',
    appKeyMasked: credential?.appKeyMasked || '',
    environment: credential?.environment || 'production',
    lastTokenErrorMessage: credential?.lastTokenErrorMessage || ''
  };
}

export function saveSettings(userId, input) {
  const appKey = String(input.appKey || '').trim();
  const secretKey = String(input.secretKey || '').trim();
  if (!appKey || !secretKey) {
    const error = new Error('App Key and Secret Key are required');
    error.status = 400;
    throw error;
  }
  const environment = input.environment === 'mock' ? 'mock' : 'production';
  const credential = repository.upsertCredential({
    userId,
    environment,
    appKeyMasked: maskAppKey(appKey),
    appKeyEncrypted: encryptSecret(appKey),
    secretKeyEncrypted: encryptSecret(secretKey)
  });
  return toSafeSettings(credential);
}

export function deleteSettings(userId) {
  repository.deleteByUserId(userId);
}

export function toSafeSettings(credential) {
  return {
    configured: Boolean(credential),
    ec2ElasticIp: env.ec2ElasticIp,
    status: credential?.status || 'NOT_CONFIGURED',
    appKeyMasked: credential?.appKeyMasked || '',
    environment: credential?.environment || 'production',
    lastTokenErrorMessage: credential?.lastTokenErrorMessage || ''
  };
}
