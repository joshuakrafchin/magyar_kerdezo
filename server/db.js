const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_URL || 'file:data/magyar.db',
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

const SEED_EMAIL = 'joshua.krafchin@gmail.com';

async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      role TEXT DEFAULT 'user',
      invited_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (invited_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      invited_by TEXT NOT NULL DEFAULT 'SYSTEM',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Seed admin invitation
  const seedExists = await db.execute({
    sql: 'SELECT 1 FROM invitations WHERE email = ?',
    args: [SEED_EMAIL],
  });
  if (seedExists.rows.length === 0) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO invitations (email, invited_by) VALUES (?, ?)',
      args: [SEED_EMAIL, 'SYSTEM'],
    });
  }
}

// Helper: run a query returning first row (or null)
async function queryOne(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

// Helper: run a query returning all rows
async function queryAll(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}

// Helper: run an execute (INSERT/UPDATE/DELETE)
async function run(sql, args = []) {
  return db.execute({ sql, args });
}

module.exports = { db, initDb, queryOne, queryAll, run, SEED_EMAIL };
