import { spawnSync } from 'node:child_process';
import type { PoolClient } from 'pg';

import { dbPool } from '../db/pool.js';
import { generateApiKey, UUID_PATTERN } from '../security/apiKeys.js';

function copySecretToClipboard(secret: string) {
  const result = spawnSync('clip.exe', [], {
    input: secret,
    encoding: 'utf8',
    windowsHide: true
  });

  if (result.status !== 0) {
    console.error(
      'Clipboard unavailable. Issue a replacement key.'
    );
    return;
  }

  console.log('API key copied to Windows clipboard.');
  console.log('Do not paste it into chat, logs, or Git.');
}

async function insertKey(
  connection: PoolClient,
  clientId: string
) {
  const key = generateApiKey();

  await connection.query(
    `INSERT INTO api_keys
        (id, client_id, key_prefix, key_hash)
      VALUES ($1, $2, $3, $4)`,
    [key.id, clientId, key.prefix, key.hash]
  );

  return key;
}

async function createClient(name: string) {
  if (name.length < 3 || name.length > 150) {
    throw new Error(
      'Client name must contain 3-150 characters.'
    );
  }

  const connection = await dbPool.connect();

  try {
    await connection.query('BEGIN');

    const result = await connection.query<{ id: string }>(
      `INSERT INTO clients (name)
        VALUES ($1) RETURNING id`,
      [name]
    );

    const clientId = result.rows[0].id;
    const key = await insertKey(connection, clientId);

    await connection.query('COMMIT');

    console.log('Client created:', clientId);
    console.log('Key ID:', key.id);

    copySecretToClipboard(key.token);
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

async function issueKey(clientId: string) {
  if (!UUID_PATTERN.test(clientId)) {
    throw new Error('Invalid client UUID.');
  }

  const connection = await dbPool.connect();

  try {
    await connection.query('BEGIN');

    const result = await connection.query<{ status: string }>(
      `SELECT status FROM clients
        WHERE id = $1 FOR UPDATE`,
      [clientId]
    );

    if (
      result.rows.length !== 1 ||
      result.rows[0].status !== 'active'
    ) {
      throw new Error('Active client was not found.');
    }

    const key = await insertKey(connection, clientId);

    await connection.query('COMMIT');

    console.log('Key ID:', key.id);
    copySecretToClipboard(key.token);
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

async function revokeKey(keyId: string) {
  if (!UUID_PATTERN.test(keyId)) {
    throw new Error('Invalid key UUID.');
  }

  const result = await dbPool.query(
    `UPDATE api_keys
      SET revoked_at = NOW()
      WHERE id = $1
        AND revoked_at IS NULL
      RETURNING id`,
    [keyId]
  );

  if (result.rowCount !== 1) {
    throw new Error('Key not found or already revoked.');
  }

  console.log('Key revoked:', keyId);
}

async function listClients() {
  const result = await dbPool.query(
    `SELECT
        c.id,
        c.name,
        c.status,
        COUNT(ak.id) FILTER (
          WHERE ak.revoked_at IS NULL
        )::integer AS active_keys
      FROM clients c
      LEFT JOIN api_keys ak
        ON ak.client_id = c.id
      GROUP BY c.id, c.name, c.status
      ORDER BY c.name`
  );

  console.table(result.rows);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'create':
      await createClient(args.join(' ').trim());
      break;

    case 'issue':
      await issueKey(args[0] ?? '');
      break;

    case 'revoke':
      await revokeKey(args[0] ?? '');
      break;

    case 'list':
      await listClients();
      break;

    default:
      throw new Error(
        'Usage: keys <create NAME | issue CLIENT_ID | revoke KEY_ID | list>'
      );
  }
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Unexpected error'
    );
    process.exitCode = 1;
  } finally {
    await dbPool.end();
  }
}

void run();
