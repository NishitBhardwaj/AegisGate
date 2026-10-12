#!/usr/bin/env bash
set -euo pipefail

# This script is intended for ephemeral CI PostgreSQL only.
: "${CI_POSTGRES_ADMIN_PASSWORD:?Missing CI bootstrap password}"
: "${CI_TEST_DB_PASSWORD:?Missing generated test password}"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-55432}"
export PGUSER="postgres"
export PGPASSWORD="$CI_POSTGRES_ADMIN_PASSWORD"

echo "Checking PostgreSQL connectivity..."
psql -X -v ON_ERROR_STOP=1 \
  -d postgres \
  -c "SELECT current_database();" >/dev/null

# Fail rather than modifying a pre-existing test database.
db_exists="$(
  psql -X -At -v ON_ERROR_STOP=1 \
    -d postgres \
    -c "SELECT EXISTS (
          SELECT 1 FROM pg_database WHERE datname = 'aegisgate_test'
        );"
)"

role_exists="$(
  psql -X -At -v ON_ERROR_STOP=1 \
    -d postgres \
    -c "SELECT EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'aegisgate_test_runtime'
        );"
)"

if [[ "$db_exists" != "f" || "$role_exists" != "f" ]]; then
  echo "Refusing to overwrite an existing CI test database or role."
  exit 1
fi

echo "Creating isolated test database..."
psql -X -v ON_ERROR_STOP=1 \
  -d postgres \
  -c "CREATE DATABASE aegisgate_test OWNER postgres TEMPLATE template0;"

echo "Creating restricted runtime role..."
# psql quotes the password as a SQL literal safely.
psql -X -v ON_ERROR_STOP=1 \
  -v test_password="$CI_TEST_DB_PASSWORD" \
  -d postgres <<'SQL'
SELECT format(
  'CREATE ROLE aegisgate_test_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L',
  :'test_password'
) \gexec
SQL

echo "Applying committed SQL migration..."
psql -X -v ON_ERROR_STOP=1 \
  -d aegisgate_test \
  -f database/migrations/001_initial.sql

echo "Applying least-privilege database grants..."
psql -X -v ON_ERROR_STOP=1 \
  -d aegisgate_test <<'SQL'
BEGIN;

REVOKE ALL ON DATABASE aegisgate_test FROM PUBLIC;

GRANT CONNECT ON DATABASE aegisgate_test
  TO aegisgate_test_runtime;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public
  TO aegisgate_test_runtime;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.clients, public.api_keys
  TO aegisgate_test_runtime;

GRANT SELECT, INSERT
  ON TABLE public.audit_logs
  TO aegisgate_test_runtime;

GRANT USAGE ON SEQUENCE public.audit_logs_id_seq
  TO aegisgate_test_runtime;

COMMIT;
SQL

echo "Verifying runtime role and permission restrictions..."
export PGUSER="aegisgate_test_runtime"
export PGPASSWORD="$CI_TEST_DB_PASSWORD"

actual="$(
  psql -X -At -v ON_ERROR_STOP=1 \
    -d aegisgate_test \
    -c "SELECT current_database() || ':' || current_user || ':' ||
               has_schema_privilege(current_user, 'public', 'CREATE') || ':' ||
               has_table_privilege(current_user, 'public.clients', 'DELETE') || ':' ||
               has_table_privilege(current_user, 'public.audit_logs', 'UPDATE');"
)"

if [[ "$actual" != "aegisgate_test:aegisgate_test_runtime:false:false:false" ]]; then
  echo "ERROR: CI runtime identity or permissions are incorrect."
  exit 1
fi

unset PGPASSWORD
echo "PASS: CI test database provisioned with restricted permissions."
