const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

let dbMode = 'postgres';
let pool;
let db;
let query;
let currentDb;

async function setupPostgres() {
  pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'pwadmin',
    password: process.env.PGPASSWORD || 'pwpass',
    database: process.env.PGDATABASE || 'pwoffice',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  await pool.query('SELECT 1');

  function translatePlaceholders(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }

  query = {
    async run(sql, params = []) {
      let pgSql = translatePlaceholders(sql);
      const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT INTO');
      const isExcludedTable = pgSql.toUpperCase().includes('USER_WORKSPACES') || pgSql.toUpperCase().includes('TOKEN_BLACKLIST');
      if (isInsert && !isExcludedTable && !pgSql.toUpperCase().includes('RETURNING')) {
        pgSql += ' RETURNING id';
      }
      const res = await pool.query(pgSql, params);
      let lastID = null;
      if (isInsert && !isExcludedTable && res.rows && res.rows[0]) {
        lastID = res.rows[0].id;
      }
      return { lastID, changes: res.rowCount };
    },
    async get(sql, params = []) {
      const pgSql = translatePlaceholders(sql);
      const res = await pool.query(pgSql, params);
      return res.rows[0] || null;
    },
    async all(sql, params = []) {
      const pgSql = translatePlaceholders(sql);
      const res = await pool.query(pgSql, params);
      return res.rows;
    }
  };
  currentDb = pool;
  dbMode = 'postgres';
  console.log('Using PostgreSQL database');
}

async function setupSqlite() {
  const dbPath = process.env.DATABASE_FILE || path.join(__dirname, 'database.db');
  
  db = await new Promise((resolve, reject) => {
    const database = new sqlite3.Database(dbPath, (err) => {
      if (err) reject(err);
      else resolve(database);
    });
  });

  await new Promise((resolve, reject) => {
    db.run('PRAGMA foreign_keys = ON', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  query = {
    async run(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    async get(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        });
      });
    },
    async all(sql, params = []) {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    }
  };
  currentDb = db;
  dbMode = 'sqlite';
  console.log('Using SQLite database at', dbPath);
}

async function initDb() {
  try {
    await setupPostgres();
  } catch (err) {
    console.warn('PostgreSQL connection failed, falling back to SQLite:', err.message);
    await setupSqlite();
  }

  try {
    if (dbMode === 'postgres') {
      await query.run(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          is_verified BOOLEAN DEFAULT FALSE,
          verification_token VARCHAR(255),
          reset_token VARCHAR(255),
          reset_token_expires TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      await query.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          is_verified INTEGER DEFAULT 0,
          verification_token TEXT,
          reset_token TEXT,
          reset_token_expires INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
    }

    if (dbMode === 'postgres') {
      try {
        await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE');
        await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255)');
        await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255)');
        await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP');
      } catch (e) {
        console.warn('Users table migration warning:', e.message);
      }
    }

    if (dbMode === 'postgres') {
      await query.run(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      await query.run(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
    }

    if (dbMode === 'postgres') {
      await query.run(`
        CREATE TABLE IF NOT EXISTS user_workspaces (
          user_id INTEGER,
          workspace_id INTEGER,
          PRIMARY KEY (user_id, workspace_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )
      `);
    } else {
      await query.run(`
        CREATE TABLE IF NOT EXISTS user_workspaces (
          user_id INTEGER,
          workspace_id INTEGER,
          PRIMARY KEY (user_id, workspace_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )
      `);
    }

    if (dbMode === 'postgres') {
      await query.run(`
        CREATE TABLE IF NOT EXISTS documents (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL,
          workspace_id INTEGER NOT NULL,
          owner_id INTEGER NOT NULL,
          file_type VARCHAR(50) NOT NULL,
          storage_path VARCHAR(500) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    } else {
      await query.run(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          workspace_id INTEGER NOT NULL,
          owner_id INTEGER NOT NULL,
          file_type TEXT NOT NULL,
          storage_path TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          last_modified INTEGER DEFAULT (strftime('%s', 'now')),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    }

    if (dbMode === 'postgres') {
      await query.run(`
        CREATE TABLE IF NOT EXISTS token_blacklist (
          token_hash VARCHAR(64) PRIMARY KEY,
          expires_at TIMESTAMP NOT NULL
        )
      `);
    } else {
      await query.run(`
        CREATE TABLE IF NOT EXISTS token_blacklist (
          token_hash TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        )
      `);
    }

    if (dbMode === 'postgres') {
      await query.run('DELETE FROM token_blacklist WHERE expires_at < CURRENT_TIMESTAMP');
    } else {
      await query.run('DELETE FROM token_blacklist WHERE expires_at < ?', [Math.floor(Date.now() / 1000)]);
    }

    await query.run(`CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id)`);
    await query.run(`CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON documents(owner_id)`);
    await query.run(`CREATE INDEX IF NOT EXISTS idx_user_workspaces_user_id ON user_workspaces(user_id)`);

    console.log('Database tables and indexes initialized successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
    process.exit(1);
  }
}

module.exports = {
  db: currentDb,
  pool,
  query,
  initDb,
  dbMode
};
