import type {
  FastifyReply,
  FastifyRequest
} from 'fastify';

import { jwtVerify } from 'jose';

import {
  ADMIN_JWT_AUDIENCE,
  ADMIN_JWT_ISSUER,
  ADMIN_JWT_SUBJECT,
  getAdminJwtKey
} from './adminJwt.js';

export interface AdminIdentity {
  subject: string;
  role: 'admin';
}

declare module 'fastify' {
  interface FastifyRequest {
    adminIdentity: AdminIdentity | null;
  }
}

export function createAdminAuth() {
  return async function authenticateAdmin(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const pathname = request.url.split('?')[0];

    const isAdminRoute =
      pathname === '/admin/v1' ||
      pathname.startsWith('/admin/v1/');

    if (!isAdminRoute) {
      return;
    }

    const authorization =
      request.headers.authorization ?? '';

    const match =
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
        authorization
      );

    if (!match) {
      return reply.code(401).send({
        error: 'ADMIN_AUTH_REQUIRED',
        message: 'Administrator authentication required'
      });
    }

    let payload;

    try {
      const verified = await jwtVerify(
        match[1],
        getAdminJwtKey(),
        {
          algorithms: ['HS256'],
          issuer: ADMIN_JWT_ISSUER,
          audience: ADMIN_JWT_AUDIENCE,
          maxTokenAge: '15m'
        }
      );

      payload = verified.payload;
    } catch {
      return reply.code(401).send({
        error: 'INVALID_ADMIN_TOKEN',
        message: 'Invalid or expired administrator token'
      });
    }

    if (
      payload.sub !== ADMIN_JWT_SUBJECT ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number'
    ) {
      return reply.code(401).send({
        error: 'INVALID_ADMIN_TOKEN',
        message: 'Invalid administrator claims'
      });
    }

    if (payload.role !== 'admin') {
      return reply.code(403).send({
        error: 'ADMIN_ACCESS_DENIED',
        message: 'Administrator privileges required'
      });
    }

    request.adminIdentity = {
      subject: payload.sub,
      role: 'admin'
    };
  };
}
