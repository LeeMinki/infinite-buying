import { getDb } from '../db/connection.js';

export function createUser({ email, passwordHash }) {
  const normalizedEmail = normalizeEmail(email);
  const result = getDb().prepare(`
    INSERT INTO users (email, password_hash)
    VALUES (?, ?)
  `).run(normalizedEmail, passwordHash);
  return getUserById(result.lastInsertRowid);
}

export function getUserByEmail(email) {
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
  return row ? toUser(row) : null;
}

export function getUserById(id) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? toUser(row) : null;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
