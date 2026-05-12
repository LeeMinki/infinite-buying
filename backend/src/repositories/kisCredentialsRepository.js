import { getDb } from '../db/connection.js';

export function getByUserId(userId) {
  const row = getDb().prepare('SELECT * FROM kis_credentials WHERE user_id = ?').get(userId);
  return row ? toCredential(row) : null;
}

export function upsertCredential(input) {
  getDb().prepare(`
    INSERT INTO kis_credentials (
      user_id, app_key_masked, app_key_encrypted, app_secret_encrypted,
      account_number_encrypted, account_product_code_encrypted, access_token_encrypted,
      token_expires_at, status, last_token_issued_at, last_token_error_message
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'CONFIGURED', NULL, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      app_key_masked = excluded.app_key_masked,
      app_key_encrypted = excluded.app_key_encrypted,
      app_secret_encrypted = excluded.app_secret_encrypted,
      account_number_encrypted = excluded.account_number_encrypted,
      account_product_code_encrypted = excluded.account_product_code_encrypted,
      access_token_encrypted = NULL,
      token_expires_at = NULL,
      status = 'CONFIGURED',
      last_token_issued_at = NULL,
      last_token_error_message = NULL,
      updated_at = datetime('now')
  `).run(
    input.userId,
    input.appKeyMasked,
    input.appKeyEncrypted,
    input.appSecretEncrypted,
    input.accountNumberEncrypted || null,
    input.accountProductCodeEncrypted || null
  );
  return getByUserId(input.userId);
}

export function saveToken(userId, { accessTokenEncrypted, tokenExpiresAt }) {
  getDb().prepare(`
    UPDATE kis_credentials
    SET access_token_encrypted = ?, token_expires_at = ?, status = 'TOKEN_VALID',
        last_token_issued_at = datetime('now'), last_token_error_message = NULL,
        updated_at = datetime('now')
    WHERE user_id = ?
  `).run(accessTokenEncrypted, tokenExpiresAt, userId);
  return getByUserId(userId);
}

export function saveTokenError(userId, message) {
  getDb().prepare(`
    UPDATE kis_credentials
    SET access_token_encrypted = NULL, token_expires_at = NULL, status = 'TOKEN_ERROR',
        last_token_error_message = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(message, userId);
  return getByUserId(userId);
}

export function deleteByUserId(userId) {
  return getDb().prepare('DELETE FROM kis_credentials WHERE user_id = ?').run(userId).changes > 0;
}

function toCredential(row) {
  return {
    id: row.id,
    userId: row.user_id,
    appKeyMasked: row.app_key_masked,
    appKeyEncrypted: row.app_key_encrypted,
    appSecretEncrypted: row.app_secret_encrypted,
    accessTokenEncrypted: row.access_token_encrypted,
    tokenExpiresAt: row.token_expires_at,
    accountNumberEncrypted: row.account_number_encrypted,
    accountProductCodeEncrypted: row.account_product_code_encrypted,
    status: row.status,
    lastTokenIssuedAt: row.last_token_issued_at,
    lastTokenErrorMessage: row.last_token_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
