# AegisGate Database Security

## Database identities

AegisGate uses two PostgreSQL identities.

### Administrator / migration identity

Role: `aegisgate`

Used for schema changes, database maintenance, migrations, and permission administration.

This identity must not be used by the normally running gateway.

### Runtime identity

Role: `aegisgate_runtime`

Used by the gateway for its normal database operations.

Granted privileges:
- SELECT, INSERT, UPDATE on clients
- SELECT, INSERT, UPDATE on api_keys
- SELECT, INSERT on audit_logs
- USAGE on audit_logs_id_seq
- CONNECT on the application database
- USAGE on the public schema

Not granted:
- Superuser privileges
- Database or role creation
- Application schema creation
- Table deletion or truncation

## Authentication

Local PostgreSQL connections require SCRAM-SHA-256.

Secrets are stored in ignored local environment files.

## Migration policy

Schema migrations must run using a privileged migration identity.

Every new table or sequence must receive explicit runtime permissions as required.

## Known limitations

- The database is a local development instance.
- AegisGate uses a shared application role for admin and proxy database operations.
- The audit log is transactionally consistent but not tamper-proof.
- Database backups, independent audit storage, and production secret management are not yet implemented.
