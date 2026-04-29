CREATE TABLE IF NOT EXISTS kiwoom_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'mock')),
  app_key_masked TEXT NOT NULL,
  app_key_encrypted TEXT NOT NULL,
  secret_key_encrypted TEXT NOT NULL,
  access_token_encrypted TEXT,
  token_expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'NOT_TESTED' CHECK (status IN ('NOT_TESTED', 'TOKEN_VALID', 'TOKEN_ERROR')),
  last_token_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kiwoom_credentials_user_id ON kiwoom_credentials(user_id);
