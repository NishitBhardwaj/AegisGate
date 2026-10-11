import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get('/health/live', async () => {
    return { status: 'ok', service: 'aegisgate' };
  });

  return app;
}
