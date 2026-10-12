$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$testEnvFile = ".env.test.local"

if (-not (Test-Path $psql)) {
    throw "PostgreSQL 18 psql.exe not found."
}

if (Test-Path $testEnvFile) {
    throw "Test credentials already exist. Stop to avoid overwriting them."
}

$adminLine = Get-Content ".env.postgres" |
    Where-Object { $_ -match '^POSTGRES_PASSWORD=' } |
    Select-Object -First 1

if (-not $adminLine) {
    throw "PostgreSQL administrator credentials missing."
}

$adminPassword = $adminLine.Substring(
    "POSTGRES_PASSWORD=".Length
)

$env:PGPASSWORD = $adminPassword

try {
    # Refuse to overwrite an existing role or database.
    $roleExists = (
        & $psql -h 127.0.0.1 -p 55432 `
            -U aegisgate -d postgres -w -X -At `
            -v ON_ERROR_STOP=1 `
            -c "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegisgate_test_runtime');"
    ).Trim()

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to inspect PostgreSQL roles."
    }

    $dbExists = (
        & $psql -h 127.0.0.1 -p 55432 `
            -U aegisgate -d postgres -w -X -At `
            -v ON_ERROR_STOP=1 `
            -c "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'aegisgate_test');"
    ).Trim()

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to inspect PostgreSQL databases."
    }

    if ($roleExists -ne "f" -or $dbExists -ne "f") {
        throw "Test database or role already exists. Inspect before rerunning."
    }

    $testPassword = (
        & node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
    ).Trim()

    # Send SQL over stdin to avoid putting the password
    # in the psql command-line arguments.
    $createRole = @"
CREATE ROLE aegisgate_test_runtime
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT PASSWORD '$testPassword';
"@

    $createRole | & $psql `
        -h 127.0.0.1 -p 55432 `
        -U aegisgate -d postgres -w -X `
        -v ON_ERROR_STOP=1 -f -

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create test runtime role."
    }

    Write-Host "PASS: Test runtime role created." -ForegroundColor Green

    # Database creation must run outside a transaction.
    & $psql -h 127.0.0.1 -p 55432 `
        -U aegisgate -d postgres -w -X `
        -v ON_ERROR_STOP=1 `
        -c "CREATE DATABASE aegisgate_test OWNER aegisgate TEMPLATE template0;"

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create test database."
    }

    Write-Host "PASS: Isolated test database created." -ForegroundColor Green

    # Reuse the same migration as development.
    Get-Content "database\migrations\001_initial.sql" -Raw | & $psql -h 127.0.0.1 -p 55432 `
        -U aegisgate -d aegisgate_test -w -X `
        -v ON_ERROR_STOP=1 -f -

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply test schema."
    }

    Write-Host "PASS: Database schema migrated." -ForegroundColor Green

    # All the following grants apply ONLY to aegisgate_test.
    $grants = @'
BEGIN;

REVOKE ALL ON DATABASE aegisgate_test FROM PUBLIC;

GRANT CONNECT ON DATABASE aegisgate_test
  TO aegisgate_test_runtime;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public
  TO aegisgate_test_runtime;

GRANT SELECT, INSERT, UPDATE
  ON public.clients, public.api_keys
  TO aegisgate_test_runtime;

GRANT SELECT, INSERT
  ON public.audit_logs
  TO aegisgate_test_runtime;

GRANT USAGE ON SEQUENCE public.audit_logs_id_seq
  TO aegisgate_test_runtime;

COMMIT;
'@

    $grants | & $psql `
        -h 127.0.0.1 -p 55432 `
        -U aegisgate -d aegisgate_test -w -X `
        -v ON_ERROR_STOP=1 -f -

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to apply least-privilege grants."
    }

    Write-Host "PASS: Least-privilege grants applied." -ForegroundColor Green

    # Verify the actual test identity before saving config.
    $env:PGPASSWORD = $testPassword

    $identity = (
        & $psql -h 127.0.0.1 -p 55432 `
            -U aegisgate_test_runtime -d aegisgate_test `
            -w -X -At -v ON_ERROR_STOP=1 `
            -c "SELECT current_user || ':' || current_database();"
    ).Trim()

    if (
        $LASTEXITCODE -ne 0 -or
        $identity -ne "aegisgate_test_runtime:aegisgate_test"
    ) {
        throw "Test runtime credential verification failed."
    }

    $testUrl = "postgresql://aegisgate_test_runtime:$testPassword@127.0.0.1:55432/aegisgate_test"

    "DATABASE_URL=$testUrl" |
        Set-Content $testEnvFile -Encoding ascii

    Write-Host "PASS: Test credentials verified and saved locally." -ForegroundColor Green
    Write-Host "PASS: Isolated database setup completed." -ForegroundColor Green
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

    Remove-Variable adminPassword, testPassword, testUrl, createRole, grants `
        -ErrorAction SilentlyContinue
}
