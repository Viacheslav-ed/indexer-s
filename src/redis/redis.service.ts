import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { createClient } from 'redis';
import redisConfig from '../config/redis.config';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);
  private client: ReturnType<typeof createClient> | null = null;

  constructor(
    @Inject(redisConfig.KEY)
    private readonly redisConfiguration: ConfigType<typeof redisConfig>,
  ) {}

  private get redisUrl(): string {
    return this.redisConfiguration.url;
  }

  private getRedisEndpoint(): string {
    try {
      const parsed = new URL(this.redisUrl);
      return `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
    } catch {
      return 'invalid_redis_endpoint';
    }
  }

  async connect() {
    if (this.client?.isOpen) {
      return {
        status: 'already_connected',
        connected: true,
        url: this.getRedisEndpoint(),
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
        url: this.getRedisEndpoint(),
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
