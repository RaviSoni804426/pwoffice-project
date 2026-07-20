@echo off
echo ============================================
echo   PW Office - PostgreSQL Setup Script
echo ============================================
echo.

:: Enable and start the PostgreSQL service
echo [1/4] Enabling PostgreSQL service...
sc config postgresql-x64-18 start=auto
echo.

echo [2/4] Starting PostgreSQL service...
net start postgresql-x64-18
echo.

:: Wait a moment for the server to fully initialize
timeout /t 3 /nobreak >nul

:: Create the user and database
echo [3/4] Creating database user 'pwadmin'...
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5433 -U postgres -c "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pwadmin') THEN CREATE USER pwadmin WITH PASSWORD 'pwpass'; END IF; END $$;"
echo.

echo [4/4] Creating database 'pwoffice'...
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5433 -U postgres -c "SELECT 1 FROM pg_database WHERE datname='pwoffice'" | findstr /c:"1" >nul 2>&1
if errorlevel 1 (
    "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5433 -U postgres -c "CREATE DATABASE pwoffice OWNER pwadmin;"
    echo Database 'pwoffice' created.
) else (
    echo Database 'pwoffice' already exists.
)
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5433 -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE pwoffice TO pwadmin;"

echo.
echo ============================================
echo   PostgreSQL setup complete!
echo   Now go back and restart npm run dev
echo ============================================
pause
