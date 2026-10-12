import { Pool } from 'pg';
import { env } from '../config/env.js';

export const dbPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 10000
});

dbPool.on('error', (error) => {
  console.error(
    'Unexpected PostgreSQL pool error:',
    error.message
  );
});
