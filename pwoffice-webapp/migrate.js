const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { pool } = require('./db');

const sqliteDbPath = path.resolve(__dirname, './database.db');

async function runMigration() {
  if (!fs.existsSync(sqliteDbPath)) {
    console.log('No local SQLite database.db found. Skipping data migration.');
    process.exit(0);
  }

  console.log('Starting migration from SQLite to PostgreSQL...');

  const db = new sqlite3.Database(sqliteDbPath);

  const getSQLiteData = (query, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  };

  try {
    // 1. Fetch data from SQLite
    const users = await getSQLiteData('SELECT * FROM users');
    const workspaces = await getSQLiteData('SELECT * FROM workspaces');
    const userWorkspaces = await getSQLiteData('SELECT * FROM user_workspaces');
    const documents = await getSQLiteData('SELECT * FROM documents');

    console.log(`Retrieved from SQLite: ${users.length} users, ${workspaces.length} workspaces, ${userWorkspaces.length} membership links, ${documents.length} documents.`);

    // 2. Insert into PostgreSQL
    // We clear Postgres tables first to ensure clean execution on multiple runs
    console.log('Clearing existing tables in PostgreSQL...');
    await pool.query('TRUNCATE TABLE user_workspaces, documents, workspaces, users CASCADE');

    console.log('Migrating Users...');
    for (const u of users) {
      await pool.query(
        'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
        [u.id, u.name, u.email, u.password_hash, u.created_at]
      );
    }

    console.log('Migrating Workspaces...');
    for (const w of workspaces) {
      await pool.query(
        'INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3)',
        [w.id, w.name, w.created_at]
      );
    }

    console.log('Migrating User Workspaces...');
    for (const uw of userWorkspaces) {
      await pool.query(
        'INSERT INTO user_workspaces (user_id, workspace_id) VALUES ($1, $2)',
        [uw.user_id, uw.workspace_id]
      );
    }

    console.log('Migrating Documents...');
    for (const d of documents) {
      await pool.query(
        'INSERT INTO documents (id, filename, workspace_id, owner_id, file_type, storage_path, created_at, last_modified) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [d.id, d.filename, d.workspace_id, d.owner_id, d.file_type, d.storage_path, d.created_at, d.last_modified]
      );
    }

    // 3. Reset Sequences in PostgreSQL
    console.log('Resetting serial sequences...');
    await pool.query("SELECT setval(pg_get_serial_sequence('users', 'id'), coalesce(max(id), 1)) FROM users");
    await pool.query("SELECT setval(pg_get_serial_sequence('workspaces', 'id'), coalesce(max(id), 1)) FROM workspaces");
    await pool.query("SELECT setval(pg_get_serial_sequence('documents', 'id'), coalesce(max(id), 1)) FROM documents");

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    db.close();
    await pool.end();
  }
}

runMigration();
