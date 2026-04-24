import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createClient } from 'redis';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private client: ReturnType<typeof createClient> | null = null;

  private get redisUrl(): string {
    const host = process.env.REDIS_HOST ?? '127.0.0.1';
    const port = process.env.REDIS_PORT ?? '6379';
    const db = process.env.REDIS_DB ?? '0';
    const pass = process.env.REDIS_PASSWORD ?? '';
    const tls = (process.env.REDIS_TLS ?? 'false').toLowerCase() === 'true';
    return `${tls ? 'rediss' : 'redis'}://${pass ? `:${encodeURIComponent(pass)}@` : ''}${host}:${port}/${db}`;
  }

  async connect() {
    if (this.client?.isOpen) {
      return {
        status: 'already_connected',
        connected: true,
        url: this.redisUrl,
      };
    }

    const client = createClient({ url: this.redisUrl });
    client.on('error', (error) => {
      this.logger.error(
        `Redis error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    });

    try {
      await client.connect();
      this.client = client;

      return {
        status: 'connected',
        connected: true,
        url: this.redisUrl,
      };
    } catch (error) {
      await client.disconnect();

      throw new InternalServerErrorException({
        status: 'connection_failed',
        connected: false,
        message: error instanceof Error ? error.message : 'Unknown Redis error',
      });
    }
  }

  async disconnect() {
    if (!this.client) {
      return {
        status: 'already_disconnected',
        connected: false,
      };
    }

    if (this.client.isOpen) {
      await this.client.quit();
    } else {
      await this.client.disconnect();
    }

    this.client = null;

    return {
      status: 'disconnected',
      connected: false,
    };
  }

  async getStatus() {
    const connected = this.client?.isOpen ?? false;

    if (!connected || !this.client) {
      return {
        connected: false,
        status: 'disconnected',
      };
    }

    try {
      await this.client.ping();
      return {
        connected: true,
        status: 'connected',
      };
    } catch {
      return {
        connected: false,
        status: 'not_ready',
      };
    }
  }
}
