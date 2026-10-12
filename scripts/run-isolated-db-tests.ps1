$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

$testEnv = ".env.test.local"

if (-not (Test-Path $testEnv)) {
    throw "Test configuration missing. Run setup-test-database.ps1 first."
}

$line = Get-Content $testEnv |
    Where-Object { $_ -match '^DATABASE_URL=' } |
    Select-Object -First 1

if (-not $line) {
    throw "Test DATABASE_URL missing."
}

$testUrl = $line.Substring(
    "DATABASE_URL=".Length
)

# Avoid accidental use of the development database.
$uri = [System.Uri]::new($testUrl)

if (
    $uri.AbsolutePath -ne "/aegisgate_test" -or
    $uri.UserInfo.Split(':')[0] -ne "aegisgate_test_runtime"
) {
    throw "Unsafe test database configuration."
}

# Preserve the caller's environment.
$previousDatabase = $env:DATABASE_URL
$previousAllowTest = $env:AEGIS_ALLOW_TEST_DB
$previousAllowConcurrency = $env:AEGIS_ALLOW_DB_CONCURRENCY_TESTS

try {
    $env:DATABASE_URL = $testUrl
    $env:AEGIS_ALLOW_TEST_DB = "1"
    $env:AEGIS_ALLOW_DB_CONCURRENCY_TESTS = "1"

    Write-Host "Running audit integration tests..."

    npm.cmd run test:audit -w @aegisgate/gateway

    if ($LASTEXITCODE -ne 0) {
        throw "Audit integration tests failed."
    }

    Write-Host "Running concurrency integration tests..."

    npm.cmd run test:concurrency -w @aegisgate/gateway

    if ($LASTEXITCODE -ne 0) {
        throw "Concurrency integration tests failed."
    }

    Write-Host "PASS: All isolated database integration tests passed." -ForegroundColor Green
}
finally {
    if ($null -eq $previousDatabase) {
        Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:DATABASE_URL = $previousDatabase
    }

    if ($null -eq $previousAllowTest) {
        Remove-Item Env:\AEGIS_ALLOW_TEST_DB -ErrorAction SilentlyContinue
    } else {
        $env:AEGIS_ALLOW_TEST_DB = $previousAllowTest
    }

    if ($null -eq $previousAllowConcurrency) {
        Remove-Item Env:\AEGIS_ALLOW_DB_CONCURRENCY_TESTS -ErrorAction SilentlyContinue
    } else {
        $env:AEGIS_ALLOW_DB_CONCURRENCY_TESTS = $previousAllowConcurrency
    }
}
