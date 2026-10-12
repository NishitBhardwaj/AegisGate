import Fastify from 'fastify';
import httpProxy from '@fastify/http-proxy';

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  app.get('/health/live', async () => ({
    status: 'ok',
    service: 'aegisgate'
  }));

  const catalogUpstream =
    process.env.CATALOG_UPSTREAM ??
    'http://127.0.0.1:3001';

  const ordersUpstream =
    process.env.ORDERS_UPSTREAM ??
    'http://127.0.0.1:8000';

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
