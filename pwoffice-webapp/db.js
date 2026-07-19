const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL Connection Pool Setup
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'pwadmin',
  password: process.env.PGPASSWORD || 'pwpass',
  database: process.env.PGDATABASE || 'pwoffice',
  max: 20, // Connection pool limit
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Helper to translate SQLite style '?' placeholders to PostgreSQL '$1', '$2', ...
function translatePlaceholders(sql) {
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// Wrapper to mirror SQLite query runner interface (run, get, all)
const query = {
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

// Initialize PostgreSQL database schema & indexes
async function initDb() {
  try {
    // Create Users Table
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

    // Schema migration: Alter users table to add new columns if they do not exist
    try {
      await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE');
      await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255)');
      await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255)');
      await query.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP');
    } catch (e) {
      console.warn('Users table migration warning:', e.message);
    }

    // Create Workspaces Table
    await query.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create User-Workspace Link Table
    await query.run(`
      CREATE TABLE IF NOT EXISTS user_workspaces (
        user_id INTEGER,
        workspace_id INTEGER,
        PRIMARY KEY (user_id, workspace_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `);

    // Create Documents Table
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

    // Create token_blacklist Table
    await query.run(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        token_hash VARCHAR(64) PRIMARY KEY,
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Clean up expired tokens on startup
    await query.run('DELETE FROM token_blacklist WHERE expires_at < CURRENT_TIMESTAMP');

    // Create Performance Indexes
    await query.run(`CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id)`);
    await query.run(`CREATE INDEX IF NOT EXISTS idx_documents_owner_id ON documents(owner_id)`);
    await query.run(`CREATE INDEX IF NOT EXISTS idx_user_workspaces_user_id ON user_workspaces(user_id)`);

    console.log('PostgreSQL database tables and indexes initialized successfully.');
  } catch (err) {
    console.error('Error initializing PostgreSQL tables:', err);
    process.exit(1);
  }
}

module.exports = {
  db: null, // Mocked direct DB handle
  pool,
  query,
  initDb
};
