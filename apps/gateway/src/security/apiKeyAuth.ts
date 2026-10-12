import type { FastifyReply, FastifyRequest } from 'fastify';
import { dbPool } from '../db/pool.js';
import { getApiKeyId, verifyApiKeyHash } from './apiKeys.js';

export interface ApiClientIdentity {
  clientId: string;
  keyId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    apiClient: ApiClientIdentity | null;
  }
}

export interface ApiKeyRecord {
  key_hash: string;
  revoked_at: Date | null;
  client_id: string;
  client_status: string;
}

export type ApiKeyLookup = (
  keyId: string
) => Promise<ApiKeyRecord | null>;

/**
 * Retrieve an API key and its associated client.
 * The raw API key is never used in the SQL query.
 */
export const lookupApiKey: ApiKeyLookup = async (keyId) => {
  const result = await dbPool.query<ApiKeyRecord>(
    `SELECT ak.key_hash, ak.revoked_at, ak.client_id, c.status AS client_status
     FROM api_keys ak
     INNER JOIN clients c ON c.id = ak.client_id
     WHERE ak.id = $1`,
    [keyId]
  );

  return result.rows[0] ?? null;
};

/**
 * Protect the Catalog and Orders API namespaces.
 *
 * A lookup dependency may be injected for testing.
 */
export function createApiKeyAuth(
  lookup: ApiKeyLookup = lookupApiKey
) {
  return async function authenticateApiKey(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const pathname = request.url.split('?')[0];
    const protectedRoute = /^\/api\/(?:catalog|orders)(?:\/|$)/.test(
      pathname
    );

    if (!protectedRoute) {
      return;
    }

    const token = request.headers['x-api-key'];

    if (
      typeof token !== 'string' ||
      token.length > 128
    ) {
      return reply.code(401).send({
        error: 'API_KEY_REQUIRED',
        message: 'A valid API key is required'
      });
    }

    const keyId = getApiKeyId(token);

    if (!keyId) {
      return reply.code(401).send({
        error: 'INVALID_API_KEY',
        message: 'Invalid API credentials'
      });
    }

    let record: ApiKeyRecord | null;

    try {
      record = await lookup(keyId);
    } catch (error) {
      request.log.error(
        { err: error },
        'API key database lookup failed'
      );

      return reply.code(503).send({
        error: 'AUTH_SERVICE_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable'
      });
    }

    if (
      !record ||
      !verifyApiKeyHash(token, record.key_hash) ||
      record.revoked_at !== null
    ) {
      return reply.code(401).send({
        error: 'INVALID_API_KEY',
        message: 'Invalid API credentials'
      });
    }

    if (record.client_status !== 'active') {
      return reply.code(403).send({
        error: 'CLIENT_INACTIVE',
        message: 'API client is not active'
      });
    }

    request.apiClient = {
      clientId: record.client_id,
      keyId
    };
  };
}
