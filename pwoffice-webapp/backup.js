const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
// Load environment variables from .env file if it exists, to avoid external dotenv dependency
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let val = parts.slice(1).join('=').trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  });
}

const backupDir = path.resolve(__dirname, '../backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
const backupFile = path.join(backupDir, `pwoffice_backup_${timestamp}.sql`);

console.log(`Starting database backup using Docker container to: ${backupFile}...`);

const writeStream = fs.createWriteStream(backupFile);

// Spawn docker exec to run pg_dump inside the postgres container
const pgDb = process.env.PGDATABASE || 'pwoffice';
const pgUser = process.env.PGUSER || 'pwadmin';

const dockerDump = spawn('docker', [
  'exec',
  'pwoffice-postgres',
  'pg_dump',
  '-U', pgUser,
  '-d', pgDb,
  '-F', 'p'
]);

dockerDump.stdout.pipe(writeStream);

let stderrOutput = '';
dockerDump.stderr.on('data', (data) => {
  stderrOutput += data.toString();
});

dockerDump.on('close', (code) => {
  if (code !== 0) {
    console.error(`Backup failed with exit code ${code}`);
    console.error('Stderr:', stderrOutput);
    // Delete incomplete backup file
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
    process.exit(1);
  }
  
  console.log(`Backup completed successfully! Saved to ${backupFile}`);

  // Clean up backups older than 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  fs.readdir(backupDir, (err, files) => {
    if (err) {
      console.error('Error reading backup directory for cleanup:', err);
      return;
    }
    
    files.forEach(file => {
      const filePath = path.join(backupDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`Error checking stat for ${file}:`, err);
          return;
        }
        if (stats.isFile() && stats.mtimeMs < sevenDaysAgo && file.startsWith('pwoffice_backup_')) {
          fs.unlink(filePath, err => {
            if (err) console.error(`Failed to delete old backup ${file}:`, err);
            else console.log(`Deleted old backup file: ${file}`);
          });
        }
      });
    });
  });
});
