import type {
  FastifyInstance,
  FastifyRequest
} from 'fastify';

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { dbPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { generateApiKey } from '../security/apiKeys.js';

const createClientSchema = z.object({
  name: z.string().trim().min(3).max(150)
}).strict();

const statusSchema = z.object({
  status: z.enum(['active', 'suspended'])
}).strict();

const idSchema = z.object({
  id: z.uuid()
});

const paginationSchema = z.object({
  limit: z.coerce.number().int()
    .min(1).max(100).default(25),
  offset: z.coerce.number().int()
    .min(0).default(0)
}).strict();

interface ClientRow {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  created_at: Date;
}

class AdminOperationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
  }
}

function adminActor(request: FastifyRequest): string {
  const identity = request.adminIdentity;

  if (!identity || identity.role !== 'admin') {
    throw new AdminOperationError(
      401,
      'ADMIN_AUTH_REQUIRED',
      'Administrator authentication required'
    );
  }

  return identity.subject;
}

async function recordAudit(
  client: PoolClient,
  actor: string,
  action: string,
  resourceType: string,
  details: Record<string, unknown>
) {
  await client.query(
    `INSERT INTO audit_logs
       (actor, action, resource_type, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      actor,
      action,
      resourceType,
      JSON.stringify(details)
    ]
  );
}

export async function adminManagementRoutes(
  app: FastifyInstance
) {
  app.addContentTypeParser(
    ['application/x-www-form-urlencoded', 'text/plain'],
    { parseAs: 'string' },
    (_req, _body, done) => done(null, {})
  );

  // Error handling is scoped to this route plugin.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request parameters'
      });
    }

    if (error instanceof AdminOperationError) {
      return reply.code(error.statusCode).send({
        error: error.errorCode,
        message: error.message
      });
    }

    request.log.error(
      { err: error },
      'Admin management operation failed'
    );

    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Unable to complete admin operation'
    });
  });

  // GET /admin/v1/clients
  app.get('/clients', async (request) => {
    adminActor(request);

    const { limit, offset } =
      paginationSchema.parse(request.query);

    const result = await dbPool.query(
      `SELECT
         c.id,
         c.name,
         c.status,
         c.created_at,
         COUNT(ak.id) FILTER (
           WHERE ak.revoked_at IS NULL
         )::integer AS active_keys
       FROM clients c
       LEFT JOIN api_keys ak
         ON ak.client_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      items: result.rows,
      limit,
      offset
    };
  });

  // POST /admin/v1/clients
  app.post('/clients', async (request, reply) => {
    const actor = adminActor(request);
    const { name } =
      createClientSchema.parse(request.body);

    const created = await withTransaction(
      async (tx) => {
        const result = await tx.query<ClientRow>(
          `INSERT INTO clients (name)
           VALUES ($1)
           RETURNING id, name, status, created_at`,
          [name]
        );

        const client = result.rows[0];

        await recordAudit(
          tx,
          actor,
          'client.created',
          'client',
          {
            clientId: client.id,
            name: client.name
          }
        );

        return client;
      }
    );

    return reply.code(201).send({
      client: created
    });
  });

  // PATCH /admin/v1/clients/:id/status
  app.patch('/clients/:id/status',
    async (request, reply) => {
      const actor = adminActor(request);
      const { id } = idSchema.parse(request.params);
      const { status } = statusSchema.parse(
        request.body
      );

      const result = await withTransaction(
        async (tx) => {
          const existing = await tx.query<ClientRow>(
            `SELECT id, name, status, created_at
             FROM clients
             WHERE id = $1
             FOR UPDATE`,
            [id]
          );

          const client = existing.rows[0];

          if (!client) {
            throw new AdminOperationError(
              404,
              'CLIENT_NOT_FOUND',
              'Client was not found'
            );
          }

          if (client.status === status) {
            return {
              client,
              changed: false
            };
          }

          const updated = await tx.query<ClientRow>(
            `UPDATE clients
             SET status = $2
             WHERE id = $1
             RETURNING id, name, status, created_at`,
            [id, status]
          );

          await recordAudit(
            tx,
            actor,
            'client.status_changed',
            'client',
            {
              clientId: id,
              oldStatus: client.status,
              newStatus: status
            }
          );

          return {
            client: updated.rows[0],
            changed: true
          };
        }
      );

      return reply.code(200).send(result);
    }
  );

  // POST /admin/v1/clients/:id/keys
  app.post('/clients/:id/keys',
    async (request, reply) => {
      const actor = adminActor(request);
      const { id } = idSchema.parse(request.params);

      const issued = await withTransaction(
        async (tx) => {
          const clientResult = await tx.query<{
            status: string;
          }>(
            `SELECT status
             FROM clients
             WHERE id = $1
             FOR UPDATE`,
            [id]
          );

          if (
            clientResult.rows.length === 0 ||
            clientResult.rows[0].status !== 'active'
          ) {
            throw new AdminOperationError(
              403,
              'CLIENT_NOT_ACTIVE',
              'Active client required'
            );
          }

          const key = generateApiKey();

          await tx.query(
            `INSERT INTO api_keys
               (id, client_id, key_prefix, key_hash)
             VALUES ($1, $2, $3, $4)`,
            [
              key.id,
              id,
              key.prefix,
              key.hash
            ]
          );

          await recordAudit(
            tx,
            actor,
            'api_key.issued',
            'api_key',
            {
              clientId: id,
              keyId: key.id
            }
          );

          return key;
        }
      );

      reply.header('Cache-Control', 'no-store');

      return reply.code(201).send({
        id: issued.id,
        prefix: issued.prefix,
        apiKey: issued.token,
        message: 'Save this key securely. It will not be shown again.'
      });
    }
  );

  // DELETE /admin/v1/keys/:id
  app.delete('/keys/:id',
    async (request, reply) => {
      const actor = adminActor(request);
      const { id } = idSchema.parse(request.params);

      const revoked = await withTransaction(
        async (tx) => {
          const result = await tx.query<{
            id: string;
            client_id: string;
          }>(
            `UPDATE api_keys
             SET revoked_at = NOW()
             WHERE id = $1
               AND revoked_at IS NULL
             RETURNING id, client_id`,
            [id]
          );

          const key = result.rows[0];

          if (!key) {
            throw new AdminOperationError(
              404,
              'ACTIVE_KEY_NOT_FOUND',
              'Active API key was not found'
            );
          }

          await recordAudit(
            tx,
            actor,
            'api_key.revoked',
            'api_key',
            {
              keyId: key.id,
              clientId: key.client_id
            }
          );

          return key;
        }
      );

      return reply.code(200).send({
        revoked: true,
        keyId: revoked.id
      });
    }
  );
}
