CREATE TABLE IF NOT EXISTS kis_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  app_key_masked TEXT NOT NULL,
  app_key_encrypted TEXT NOT NULL,
  app_secret_encrypted TEXT NOT NULL,
  access_token_encrypted TEXT,
  token_expires_at TEXT,
  account_number_encrypted TEXT,
  account_product_code_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIGURED' CHECK (status IN ('NOT_CONFIGURED', 'CONFIGURED', 'TOKEN_VALID', 'TOKEN_ERROR')),
  last_token_issued_at TEXT,
  last_token_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kis_credentials_user ON kis_credentials(user_id);
