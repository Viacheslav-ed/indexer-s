import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import appConfig from './config/app.config';
import rpcConfig from './config/rpc.config';
import redisConfig from './config/redis.config';
import { RpcModule } from './rpc/rpc.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      load: [appConfig, redisConfig, rpcConfig],
    }),
    RedisModule,
    RpcModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
