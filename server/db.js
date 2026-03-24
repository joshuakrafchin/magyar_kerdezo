const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'magyar.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
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

// Seed the admin user invitation so they can sign up
const SEED_EMAIL = 'joshua.krafchin@gmail.com';

const seedExists = db.prepare('SELECT 1 FROM invitations WHERE email = ?').get(SEED_EMAIL);
if (!seedExists) {
  // Insert a self-invitation for the seed user
  db.prepare('INSERT OR IGNORE INTO invitations (email, invited_by) VALUES (?, ?)').run(SEED_EMAIL, 'SYSTEM');
}

// Prepared statements
const stmts = {
  findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (id, email, name, picture, role, invited_by) VALUES (?, ?, ?, ?, ?, ?)'),

  isInvited: db.prepare('SELECT 1 FROM invitations WHERE LOWER(email) = LOWER(?)'),

  getInvitations: db.prepare('SELECT i.email, i.created_at, u.name as invited_by_name FROM invitations i LEFT JOIN users u ON i.invited_by = u.id WHERE i.invited_by != ? ORDER BY i.created_at DESC'),
  getMyInvitations: db.prepare('SELECT email, created_at FROM invitations WHERE invited_by = ? ORDER BY created_at DESC'),
  addInvitation: db.prepare('INSERT INTO invitations (email, invited_by) VALUES (?, ?)'),
  invitationExists: db.prepare('SELECT 1 FROM invitations WHERE LOWER(email) = LOWER(?)'),

  getState: db.prepare('SELECT state_json FROM user_state WHERE user_id = ?'),
  upsertState: db.prepare(`
    INSERT INTO user_state (user_id, state_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = datetime('now')
  `),

  listUsers: db.prepare('SELECT id, email, name, picture, role, created_at FROM users ORDER BY created_at'),
};

module.exports = { db, stmts, SEED_EMAIL };
