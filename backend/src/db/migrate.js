import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'schema.sql');
const migrationsDir = path.join(__dirname, 'migrations');

export function runMigrations() {
  const db = getDb();
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  if (!fs.existsSync(migrationsDir)) return;

  const migrations = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const name of migrations) {
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    })();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations();
  console.log('SQLite schema initialized');
}
