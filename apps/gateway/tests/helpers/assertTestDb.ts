import assert from 'node:assert/strict';

import { dbPool } from '../../src/db/pool.js';

export async function assertIsolatedTestDatabase() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Database integration tests are disabled in production.'
    );
  }

  if (process.env.AEGIS_ALLOW_TEST_DB !== '1') {
    throw new Error(
      'Explicit test database opt-in is required.'
    );
  }

  const result = await dbPool.query<{
    database_name: string;
    database_user: string;
  }>(
    `SELECT
       current_database() AS database_name,
       current_user AS database_user`
  );

  const identity = result.rows[0];

  assert.equal(
    identity.database_name,
    'aegisgate_test',
    'Refusing to run against a non-test database'
  );

  assert.equal(
    identity.database_user,
    'aegisgate_test_runtime',
    'Refusing to use an unexpected PostgreSQL role'
  );

  console.log(
    'PASS: Isolated test database identity verified.'
  );
}
