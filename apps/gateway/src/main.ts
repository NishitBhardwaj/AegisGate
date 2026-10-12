import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp();
const port = env.PORT;
const host = env.HOST;

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
