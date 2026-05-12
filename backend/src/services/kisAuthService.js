import { env } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../crypto/secretCipher.js';
import * as repository from '../repositories/kisCredentialsRepository.js';

const tokenCache = new Map();
const TOKEN_FAILURE_MESSAGE = 'KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요';

export async function getAccessToken(userId) {
  const context = await getAuthContext(userId);
  return context.accessToken;
}

export async function getAuthContext(userId) {
  const credential = repository.getByUserId(userId);
  if (!credential) {
    const error = new Error('KIS API 설정을 먼저 완료하세요');
    error.status = 400;
    throw error;
  }

  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return {
      accessToken: cached.token,
      appKey: cached.appKey,
      appSecret: cached.appSecret,
      baseUrl: baseUrl()
    };
  }

  const appKey = decryptSecret(credential.appKeyEncrypted);
  const appSecret = decryptSecret(credential.appSecretEncrypted);

  if (credential.accessTokenEncrypted && credential.tokenExpiresAt) {
    const expiresAt = Date.parse(credential.tokenExpiresAt);
    if (expiresAt > Date.now() + 60_000) {
      const token = decryptSecret(credential.accessTokenEncrypted);
      tokenCache.set(userId, { token, appKey, appSecret, expiresAt });
      return {
        accessToken: token,
        appKey,
        appSecret,
        baseUrl: baseUrl()
      };
    }
  }

  const accessToken = await issueToken(userId, credential, appKey, appSecret);
  return {
    accessToken,
    appKey,
    appSecret,
    baseUrl: baseUrl()
  };
}

export async function testConnection(userId) {
  const credential = repository.getByUserId(userId);
  if (!credential) {
    return {
      ok: false,
      status: 'TOKEN_ERROR',
      message: 'KIS API 설정을 먼저 완료하세요'
    };
  }

  tokenCache.delete(userId);
  try {
    const appKey = decryptSecret(credential.appKeyEncrypted);
    const appSecret = decryptSecret(credential.appSecretEncrypted);
    await issueToken(userId, credential, appKey, appSecret);
    const refreshed = repository.getByUserId(userId);
    return {
      ok: true,
      status: 'TOKEN_VALID',
      appKeyMasked: refreshed.appKeyMasked,
      message: 'KIS access token 발급에 성공했습니다.'
    };
  } catch (error) {
    const message = TOKEN_FAILURE_MESSAGE;
    repository.saveTokenError(userId, message);
    return {
      ok: false,
      status: 'TOKEN_ERROR',
      message
    };
  }
}

export function clearTokenCache(userId) {
  tokenCache.delete(userId);
}

async function issueToken(userId, credential, appKey, appSecret) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.kisTimeoutMs);
  try {
    const response = await fetch(`${baseUrl()}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: appKey,
        appsecret: appSecret
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(redact(data.msg1 || data.message || `KIS OAuth failed with ${response.status}`));
    }
    const token = data.access_token || data.token;
    if (!token) throw new Error('KIS OAuth response did not include an access token');
    const expiresIn = Number(data.expires_in || 86_400);
    const expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    repository.saveToken(userId, {
      accessTokenEncrypted: encryptSecret(token),
      tokenExpiresAt: new Date(expiresAt).toISOString()
    });
    tokenCache.set(userId, { token, appKey, appSecret, expiresAt });
    return token;
  } catch (error) {
    repository.saveTokenError(userId, TOKEN_FAILURE_MESSAGE);
    tokenCache.delete(userId);
    const wrapped = new Error(TOKEN_FAILURE_MESSAGE);
    wrapped.status = 502;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
}

export function baseUrl() {
  return env.kisApiBaseUrl;
}

function redact(value) {
  return String(value || '').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}
