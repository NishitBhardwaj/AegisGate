import { buildCatalogApp } from './app.js';

const app = buildCatalogApp();

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Invalid PORT configuration');
}

try {
  await app.listen({
    port,
    host
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
