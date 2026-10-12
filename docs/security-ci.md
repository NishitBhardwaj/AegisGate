# AegisGate Security CI

## Purpose

The security CI workflow validates AegisGate's authentication, authorization, transaction handling, database isolation, and application builds on GitHub-hosted runners.

## Workflow

File: `.github/workflows/security-ci.yml`

Triggers:
- Push to main
- Pull requests targeting main
- Manual workflow dispatch

## Runtime

- Ubuntu 24.04
- Node.js 22
- Python 3.11
- PostgreSQL 17 (ephemeral service container)

## Database Provisioning

The workflow executes `scripts/setup-ci-test-db.sh`. It creates:
- Database: aegisgate_test
- Runtime role: aegisgate_test_runtime

It applies:
- The committed initial SQL migration
- Explicit least-privilege permissions

Integration tests verify database identity before running.

## Automated Checks

Gateway:
- API-key cryptographic tests
- API-key authentication tests
- Administrator JWT authorization tests
- Authorization boundary tests
- Audit history and rollback tests
- Administrative concurrency tests

Orders Service:
- Python pytest suite

Build and security:
- TypeScript typecheck
- TypeScript build
- npm production dependency audit

## Credential Handling

The workflow generates temporary credentials for the test database and administrator JWT signing.

No local development credentials are used.

Generated values are masked in GitHub Actions logs.

## Expected Tests

- 52 Gateway tests
- 4 Orders Service tests
- 56 total tests

These are acceptance targets. Actual CI results must be recorded after the workflow has executed on GitHub.

## Limitations

- PostgreSQL testing currently uses one pinned major version.
- This workflow is not a penetration test.
- Upstream services are not deployed as production containers.
- Multi-instance Redis rate limiting is not yet tested.
- Dependency auditing does not establish complete supply-chain security.
- CI action references should be pinned to reviewed commit SHAs before production use.
