import type { PoolClient } from 'pg';
import { dbPool } from './pool.js';

/**
 * Execute work atomically on one PostgreSQL connection.
 * All operations either commit together or roll back.
 */
export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');

    const result = await operation(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original operation error.
    }

    throw error;
  } finally {
    client.release();
  }
}
