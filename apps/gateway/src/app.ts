import Fastify from 'fastify';
import httpProxy from '@fastify/http-proxy';
import { dbPool } from './db/pool.js';
import { env } from './config/env.js';

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  app.get('/health/live', async () => ({
    status: 'ok',
    service: 'aegisgate'
  }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await dbPool.query('SELECT 1');

      return {
        status: 'ready',
        service: 'aegisgate',
        database: 'up'
      };
    } catch (error) {
      app.log.error(
        { err: error },
        'PostgreSQL readiness check failed'
      );

      return reply.code(503).send({
        status: 'not_ready',
        service: 'aegisgate',
        database: 'down'
      });
    }
  });

  const catalogUpstream = env.CATALOG_UPSTREAM;
  const ordersUpstream = env.ORDERS_UPSTREAM;

  const timeoutMs = 1500;

  // Shared proxy transport failure handler.
  const proxyReplyOptions = {
    timeout: timeoutMs,
    retryMethods: [] as string[],
    maxRetriesOn503: 0,

    rewriteRequestHeaders(request: any, headers: any) {
      const cleanHeaders = { ...headers };
      delete cleanHeaders.expect;
      return cleanHeaders;
    },

    onError(
      reply: any,
      rawError: any
    ) {
      const err = rawError?.error ?? rawError ?? {};
      const timedOut =
        err?.statusCode === 504 ||
        /TIMEOUT|TIMEDOUT/i.test(err?.code ?? '');

      const statusCode = timedOut ? 504 : 502;

      return reply.code(statusCode).send({
        error: timedOut
          ? 'UPSTREAM_TIMEOUT'
          : 'UPSTREAM_UNAVAILABLE',
        message: timedOut
          ? 'The upstream service exceeded its timeout'
          : 'The upstream service could not be reached'
      });
    }
  };

  // Existing Catalog Service
  app.register(httpProxy, {
    upstream: catalogUpstream,
    prefix: '/api/catalog',
    rewritePrefix: '',
    httpMethods: ['GET', 'HEAD'],
    websocket: false,
    replyOptions: proxyReplyOptions
  });

  // New Orders Service
  app.register(httpProxy, {
    upstream: ordersUpstream,
    prefix: '/api/orders',
    rewritePrefix: '',
    httpMethods: ['GET', 'HEAD', 'POST'],
    websocket: false,
    replyOptions: proxyReplyOptions
  });

  return app;
}
