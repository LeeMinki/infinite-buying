import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

let db;
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function getDb() {
  if (!db) {
    const dbPath = path.isAbsolute(env.dbPath) ? env.dbPath : path.resolve(backendRoot, env.dbPath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
