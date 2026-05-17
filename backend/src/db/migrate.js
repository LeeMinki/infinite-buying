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

  // 마이그레이션 중에는 FK 강제를 끈다. 테이블 재생성(create new → drop old → rename)
  // 시 부모 테이블을 DROP 하면 자식 행이 CASCADE 로 삭제될 수 있어 데이터가 유실된다.
  // FK 정의 자체는 그대로 보존되며, 마이그레이션이 끝나면 다시 켠다.
  db.pragma('foreign_keys = OFF');
  try {
    for (const name of migrations) {
      const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name);
      if (applied) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      })();
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations();
  console.log('SQLite schema initialized');
}
