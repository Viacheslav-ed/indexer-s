import { registerAs } from '@nestjs/config';

function buildRedisUrl(): string {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const host = process.env.REDIS_HOST ?? '127.0.0.1';
  const port = process.env.REDIS_PORT ?? '6379';
  const db = process.env.REDIS_DB ?? '0';
  const password = process.env.REDIS_PASSWORD ?? '';
  const tls = (process.env.REDIS_TLS ?? 'false').toLowerCase() === 'true';

  return `${tls ? 'rediss' : 'redis'}://${password ? `:${encodeURIComponent(password)}@` : ''}${host}:${port}/${db}`;
}

export default registerAs('redis', () => ({
  url: buildRedisUrl(),
}));
