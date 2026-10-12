import { env } from '../config/env.js';

export const ADMIN_JWT_ISSUER = 'aegisgate-admin';

export const ADMIN_JWT_AUDIENCE =
  'aegisgate-admin-api';

export const ADMIN_JWT_SUBJECT =
  'local-dev-admin';

export function getAdminJwtKey(): Uint8Array {
  return Buffer.from(
    env.ADMIN_JWT_SECRET,
    'base64url'
  );
}
