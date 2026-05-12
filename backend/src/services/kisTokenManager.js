import { env } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../crypto/secretCipher.js';
import * as repository from '../repositories/kisCredentialsRepository.js';

const tokenCache = new Map();
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_FAILURE_MESSAGE = 'KIS access token 발급에 실패했습니다. App Key, App Secret, 계좌 설정을 확인하세요';

export async function getValidAccessToken(userId) {
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

  const appKey = decryptSecret(credential.appKeyEncrypted);
  const appSecret = decryptSecret(credential.appSecretEncrypted);
  const accountNumber = credential.accountNumberEncrypted ? decryptSecret(credential.accountNumberEncrypted) : '';
  const accountProductCode = credential.accountProductCodeEncrypted ? decryptSecret(credential.accountProductCodeEncrypted) : '';
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + REFRESH_MARGIN_MS) {
    return {
      accessToken: cached.token,
      appKey,
      appSecret,
      accountNumber,
      accountProductCode,
      baseUrl: env.kisApiBaseUrl
    };
  }

  if (credential.accessTokenEncrypted && credential.tokenExpiresAt) {
    const expiresAt = Date.parse(credential.tokenExpiresAt);
    if (expiresAt > Date.now() + REFRESH_MARGIN_MS) {
      const token = decryptSecret(credential.accessTokenEncrypted);
      tokenCache.set(userId, { token, expiresAt });
      return {
        accessToken: token,
        appKey,
        appSecret,
        accountNumber,
        accountProductCode,
        baseUrl: env.kisApiBaseUrl
      };
    }
  }

  const { token, expiresAt } = await issueToken(userId, appKey, appSecret);
  return {
    accessToken: token,
    appKey,
    appSecret,
    accountNumber,
    accountProductCode,
    baseUrl: env.kisApiBaseUrl
  };
}

export function clearTokenCache(userId) {
  if (userId) tokenCache.delete(userId);
  else tokenCache.clear();
}

async function issueToken(userId, appKey, appSecret) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.kisTimeoutMs);
  try {
    const response = await fetch(`${env.kisApiBaseUrl}/oauth2/tokenP`, {
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
    if (!response.ok || isFailure(data)) {
      throw withDetail(TOKEN_FAILURE_MESSAGE, data, response.status);
    }
    const token = data.access_token || data.token;
    if (!token) throw withDetail(TOKEN_FAILURE_MESSAGE, data, response.status);
    const expiresIn = Number(data.expires_in || 86_400);
    const expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    repository.saveToken(userId, {
      accessTokenEncrypted: encryptSecret(token),
      tokenExpiresAt: new Date(expiresAt).toISOString()
    });
    tokenCache.set(userId, { token, expiresAt });
    return { token, expiresAt };
  } catch (err) {
    const message = err && err.message ? err.message : TOKEN_FAILURE_MESSAGE;
    repository.saveTokenError(userId, message);
    tokenCache.delete(userId);
    const error = new Error(message);
    error.status = 502;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function withDetail(base, data, httpStatus) {
  const code = data && (data.error_code ?? data.msg_cd ?? data.rt_cd);
  const message = data && (data.error_description ?? data.msg1 ?? data.message);
  const codeStr = code != null ? String(code).trim() : '';
  const msgStr = message != null ? String(message).trim() : '';
  const status = httpStatus ? `HTTP ${httpStatus}` : '';
  const parts = [codeStr, msgStr, status].filter(Boolean);
  if (parts.length === 0) return new Error(base);
  return new Error(`${base} (${parts.join(' / ')})`);
}

function isFailure(data) {
  const rtCd = data?.rt_cd ?? data?.rtCd;
  return rtCd != null && String(rtCd) !== '0';
}
