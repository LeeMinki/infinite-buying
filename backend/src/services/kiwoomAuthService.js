import { env } from '../config/env.js';
import { decryptSecret, encryptSecret } from '../crypto/secretCipher.js';
import * as repository from '../repositories/kiwoomCredentialsRepository.js';

const tokenCache = new Map();

export async function getAccessToken(userId) {
  const credential = repository.getByUserId(userId);
  if (!credential) {
    const error = new Error('Kiwoom credential is not configured');
    error.status = 400;
    throw error;
  }

  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  if (credential.accessTokenEncrypted && credential.tokenExpiresAt) {
    const expiresAt = Date.parse(credential.tokenExpiresAt);
    if (expiresAt > Date.now() + 60_000) {
      const token = decryptSecret(credential.accessTokenEncrypted);
      tokenCache.set(userId, { token, expiresAt });
      return token;
    }
  }

  return issueToken(userId, credential);
}

export async function testConnection(userId) {
  const credential = repository.getByUserId(userId);
  if (!credential) {
    return {
      ok: false,
      status: 'TOKEN_ERROR',
      ec2ElasticIp: env.ec2ElasticIp,
      message: '키움 자격증명이 등록되어 있지 않습니다. App Key와 Secret Key를 먼저 저장해 주세요.'
    };
  }
  // The connection test must verify the saved keys against Kiwoom every time —
  // never serve a cached token, otherwise stale tokens from previous keys can
  // mask invalid credentials.
  tokenCache.delete(userId);
  try {
    await issueToken(userId, credential);
    const refreshed = repository.getByUserId(userId);
    return {
      ok: true,
      status: 'TOKEN_VALID',
      appKeyMasked: refreshed.appKeyMasked,
      ec2ElasticIp: env.ec2ElasticIp,
      message: '키움 access token 발급에 성공했습니다.'
    };
  } catch (error) {
    const message = buildTokenFailureMessage(error);
    repository.saveTokenError(userId, message);
    return {
      ok: false,
      status: 'TOKEN_ERROR',
      ec2ElasticIp: env.ec2ElasticIp,
      message
    };
  }
}

export function clearTokenCache(userId) {
  tokenCache.delete(userId);
}

async function issueToken(userId, credential) {
  const appKey = decryptSecret(credential.appKeyEncrypted);
  const secretKey = decryptSecret(credential.secretKeyEncrypted);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.kiwoomTimeoutMs);
  try {
    const response = await fetch(`${baseUrl(credential)}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        appkey: appKey,
        secretkey: secretKey
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.return_msg || data.message || `Kiwoom OAuth failed with ${response.status}`);
    }
    const token = data.token || data.access_token;
    if (!token) throw new Error('Kiwoom OAuth response did not include a token');
    const expiresIn = Number(data.expires_in || 3600);
    const expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    repository.saveToken(userId, {
      accessTokenEncrypted: encryptSecret(token),
      tokenExpiresAt: new Date(expiresAt).toISOString()
    });
    tokenCache.set(userId, { token, expiresAt });
    return token;
  } catch (error) {
    const message = buildTokenFailureMessage(error);
    repository.saveTokenError(userId, message);
    tokenCache.delete(userId);
    const wrapped = new Error(message);
    wrapped.status = 502;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
}

export function baseUrl(credential) {
  return env.kiwoomApiBaseUrl;
}

function buildTokenFailureMessage(error) {
  const detail = String(error?.message || 'token request failed').replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  return `키움 access token 발급에 실패했습니다. 키움 사이트에서 EC2 Elastic IP 등록 여부를 확인하세요. 등록해야 할 IP: ${env.ec2ElasticIp || '(EC2_ELASTIC_IP 미설정)'}. 브라우저 사용자 PC IP가 아니라 backend EC2 서버 IP를 등록해야 합니다. (${detail})`;
}
