import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto';

const API_KEY_PATTERN =
  /^ag_dev_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_?([A-Za-z0-9_-]{43})$/;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hashApiKey(token: string): string {
  return createHash('sha256')
    .update(token, 'utf8')
    .digest('hex');
}

export function generateApiKey() {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const token = `ag_dev_${id}_${secret}`;

  return {
    id,
    token,
    prefix: token.slice(0, 24),
    hash: hashApiKey(token)
  };
}

export function getApiKeyId(token: string): string | null {
  const match = API_KEY_PATTERN.exec(token);
  return match?.[1] ?? null;
}

export function verifyApiKeyHash(
  suppliedToken: string,
  storedHash: string
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(storedHash)) {
    return false;
  }

  const suppliedDigest = Buffer.from(
    hashApiKey(suppliedToken),
    'hex'
  );

  const storedDigest = Buffer.from(storedHash, 'hex');

  return timingSafeEqual(suppliedDigest, storedDigest);
}
