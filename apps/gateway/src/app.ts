import Fastify from 'fastify';
import httpProxy from '@fastify/http-proxy';

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  // Existing gateway health endpoint
  app.get('/health/live', async () => {
    return {
      status: 'ok',
      service: 'aegisgate'
    };
  });

  // Catalog Service connection
  const catalogUpstream =
    process.env.CATALOG_UPSTREAM ??
    'http://127.0.0.1:3001';

  // Reverse proxy for catalog requests
  app.register(httpProxy, {
    upstream: catalogUpstream,
    prefix: '/api/catalog',
    rewritePrefix: '',
    httpMethods: ['GET', 'HEAD'],
    websocket: false
  });

  return app;
}
