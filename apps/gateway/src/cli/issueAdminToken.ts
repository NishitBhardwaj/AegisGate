import { SignJWT } from 'jose';

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  ADMIN_JWT_SUBJECT,
  getAdminJwtKey
} from '../security/adminJwt.js';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Local admin token issuance is disabled in production'
    );
  }

  const token = await new SignJWT({
    role: 'admin'
  })
    .setProtectedHeader({
      alg: 'HS256',
      typ: 'JWT'
    })
    .setIssuer(ADMIN_JWT_ISSUER)
    .setAudience(ADMIN_JWT_AUDIENCE)
    .setSubject(ADMIN_JWT_SUBJECT)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(getAdminJwtKey());

  process.stdout.write(token);
}

main().catch(() => {
  console.error('Unable to issue local administrator token.');
  process.exitCode = 1;
});
