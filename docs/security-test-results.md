# AegisGate Security Test Results

## Scope

Authorization boundaries, API credential handling, concurrent administrative operations, and database transaction safety.

## Components Tested

- API-key authentication
- Administrator JWT authentication
- Key revocation
- Client suspension
- Credential namespace separation
- Proxy request-header sanitization
- Default-deny API routing
- Concurrent key issuance and client suspension
- Idempotent concurrent client status transitions
- Atomic concurrent API-key revocations

## Method

Automated tests implemented using Node.js test runner, Fastify injection, real PostgreSQL transactions via the restricted `aegisgate_runtime` role, and a temporary upstream HTTP service.

## Results

Actual automated test suite execution results across all 6 test suites:

- `test:concurrency`: 4 / 4 passed (3 concurrency scenarios + suite runner)
  - Key issuance racing with client suspension: client status committed as `suspended`, all successfully issued keys have matching committed rows and `api_key.issued` audit events, exactly 1 `client.status_changed` audit event, all issued keys return HTTP 403 upon access, and subsequent issuance fails with HTTP 403.
  - Simultaneous suspension requests: 8 concurrent requests all return HTTP 200; exactly 1 transition reported (`changed: true`), exactly 1 audit event recorded.
  - Simultaneous key revocation requests: 8 concurrent requests result in exactly one HTTP 200 and seven HTTP 404s; key marked revoked in DB, exactly 1 `api_key.revoked` audit event recorded, and subsequent API access returns HTTP 401.
- `test:boundary`: 14 / 14 passed (13 scenarios + suite runner)
  - Missing API key rejected (HTTP 401)
  - Malformed API key rejected (HTTP 401)
  - Unknown client credential rejected (HTTP 401)
  - Mixed-secret cross-client attack rejected (HTTP 401)
  - Valid client credentials accepted (HTTP 200)
  - Revoked key rejected (HTTP 401)
  - Suspended client rejected (HTTP 403)
  - API key rejected on admin route (HTTP 401)
  - Admin JWT rejected as client API key (HTTP 401)
  - Non-admin JWT rejected on admin route (HTTP 403)
  - Internal identity spoofing headers stripped (`x-aegis-client-id`, `x-api-key`, `authorization`, `cookie`, `proxy-authorization` not leaked)
  - Unregistered `/api` route denied by default (HTTP 401)
  - Public liveness route accessible without credentials (HTTP 200)
- `test:admin`: 11 / 11 passed (token validation, expiry, issuer, audience, and role enforcement)
- `test:auth`: 10 / 10 passed (API key extraction, DB lookup fallback, stripping, 503 handling)
- `test:keys`: 4 / 4 passed (entropy, SHA-256 hash validation, secret exclusion)
- `test:audit`: 9 / 9 passed (paginated history, query validation, and transactional rollback)
- `typecheck` & `build`: 0 errors across all workspaces
- `npm audit --omit=dev`: 0 vulnerabilities found

## Security Properties

The tests evaluate whether:

1. Unauthenticated requests are denied.
2. Credentials from one API client cannot authenticate as another client.
3. Administrator JWTs and client API keys remain separate.
4. Revoked credentials are rejected.
5. Suspended client credentials are rejected.
6. Untrusted client identity headers are removed before proxy forwarding.
7. Concurrent operations maintain consistent database state without orphaned keys or duplicate state transitions.
8. Database operations execute under least-privilege runtime role (`aegisgate_runtime`).

## Concurrency and Transaction Safety

| Property | What the test demonstrates |
|---|---|
| Concurrent issuance/suspension | Post-suspension credentials are denied; every successful issuance has corresponding committed database records and audit logs |
| Repeated suspension | Exactly one actual state transition is recorded and exactly one audit log event generated |
| Repeated revocation | Exactly one revocation succeeds (HTTP 200), subsequent attempts return HTTP 404, and exactly one audit log event generated |
| Transaction correctness | Observed atomic state changes under concurrent requests using PostgreSQL row locking |
| Remaining limitation | No full high-load or multi-process distributed concurrency benchmark yet |

> [!NOTE]
> PostgreSQL's row locks protect the specific operations tested. We do not claim serializability for every possible transaction; comprehensive concurrency correctness requires examining every operation and isolation-level interaction.

## Known Limitations

- These tests do not establish full tenant data isolation.
- The application does not yet use a production identity provider.
- The upstream services are local development applications.
- Full high-load and distributed multi-process concurrency benchmarks remain to be evaluated.
- Distributed rate limiting has not yet been implemented.

## Conclusion

All 52 automated security, concurrency, boundary, and cryptographic tests passed without failure. The gateway enforces strict credential boundary separation between client API keys and administrator JWTs, preserves atomic state transitions and audit logging under concurrent administration, sanitizes upstream request headers against spoofing attacks, and prevents access to unauthenticated namespaces by default.
