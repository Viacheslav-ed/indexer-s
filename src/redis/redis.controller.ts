import { Controller, Get, Post } from '@nestjs/common';
import { RedisService } from './redis.service';

@Controller('redis')
export class RedisController {
  constructor(private readonly redisService: RedisService) {}

  @Post('connect')
  connect() {
    return this.redisService.connect();
  }

  @Post('disconnect')
  disconnect() {
    return this.redisService.disconnect();
  }

  @Get('status')
  status() {
    return this.redisService.getStatus();
  }
}
