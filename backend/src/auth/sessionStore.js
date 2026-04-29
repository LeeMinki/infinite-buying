import session from 'express-session';
import createSqliteStore from 'better-sqlite3-session-store';
import { env } from '../config/env.js';
import { getDb } from '../db/connection.js';

const SqliteStore = createSqliteStore(session);

export function createSessionMiddleware() {
  return session({
    name: 'ib.sid',
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore({
      client: getDb(),
      expired: { clear: true, intervalMs: 15 * 60 * 1000 }
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.sessionCookieSecure,
      maxAge: 14 * 24 * 60 * 60 * 1000
    }
  });
}
