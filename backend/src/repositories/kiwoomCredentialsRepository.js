import { getDb } from '../db/connection.js';

export function getByUserId(userId) {
  const row = getDb().prepare('SELECT * FROM kiwoom_credentials WHERE user_id = ?').get(userId);
  return row ? toCredential(row) : null;
}

export function upsertCredential(input) {
  getDb().prepare(`
    INSERT INTO kiwoom_credentials (
      user_id, environment, app_key_masked, app_key_encrypted, secret_key_encrypted,
      access_token_encrypted, token_expires_at, status, last_token_error_message
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'NOT_TESTED', NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      environment = excluded.environment,
      app_key_masked = excluded.app_key_masked,
      app_key_encrypted = excluded.app_key_encrypted,
      secret_key_encrypted = excluded.secret_key_encrypted,
      access_token_encrypted = NULL,
      token_expires_at = NULL,
      status = 'NOT_TESTED',
      last_token_error_message = NULL,
      updated_at = datetime('now')
  `).run(
    input.userId,
    input.environment,
    input.appKeyMasked,
    input.appKeyEncrypted,
    input.secretKeyEncrypted
  );
  return getByUserId(input.userId);
}

export function saveToken(userId, { accessTokenEncrypted, tokenExpiresAt }) {
  getDb().prepare(`
    UPDATE kiwoom_credentials
    SET access_token_encrypted = ?, token_expires_at = ?, status = 'TOKEN_VALID',
        last_token_error_message = NULL, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(accessTokenEncrypted, tokenExpiresAt, userId);
  return getByUserId(userId);
}

export function saveTokenError(userId, message) {
  getDb().prepare(`
    UPDATE kiwoom_credentials
    SET access_token_encrypted = NULL, token_expires_at = NULL, status = 'TOKEN_ERROR',
        last_token_error_message = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(message, userId);
  return getByUserId(userId);
}

export function deleteByUserId(userId) {
  return getDb().prepare('DELETE FROM kiwoom_credentials WHERE user_id = ?').run(userId).changes > 0;
}

function toCredential(row) {
  return {
    id: row.id,
    userId: row.user_id,
    environment: row.environment,
    appKeyMasked: row.app_key_masked,
    appKeyEncrypted: row.app_key_encrypted,
    secretKeyEncrypted: row.secret_key_encrypted,
    accessTokenEncrypted: row.access_token_encrypted,
    tokenExpiresAt: row.token_expires_at,
    status: row.status,
    lastTokenErrorMessage: row.last_token_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
