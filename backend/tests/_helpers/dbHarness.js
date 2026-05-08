import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export function useTempDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-test-'));
  const dbPath = path.join(tmpDir, 'app.db');
  process.env.DB_PATH = dbPath;
  process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-test-session-secret';
  return {
    dbPath,
    cleanup() {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  };
}

export async function bootstrapDb() {
  const { runMigrations } = await import('../../src/db/migrate.js');
  const { getDb, closeDb } = await import('../../src/db/connection.js');
  closeDb();
  runMigrations();
  return getDb();
}

export function createUser(db, email = `u${Math.random().toString(36).slice(2)}@example.com`) {
  const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(
    email,
    'test-hash'
  );
  return { id: result.lastInsertRowid, email };
}
