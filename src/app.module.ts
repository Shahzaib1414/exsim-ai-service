import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';

import { UserHeaderGuard } from '@/common/guards';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  validate,
  appConfig,
  databaseConfig,
  redisConfig,
  azureConfig,
  langfuseConfig,
  emailConfig,
  dotnetConfig,
  swaggerConfig,
} from './config';
import type { Config } from './config';
import { DatabaseModule } from './database/database.module';
import { GeneratorModule } from './modules/generator';
import { HealthModule } from './modules/health';
import { EmbeddingModule } from './modules/embedding';
import { DeduplicatorModule } from './modules/deduplicator';
import { ValidatorModule } from './modules/validator';
import { TaggerModule } from './modules/tagger';
import { ObservabilityModule } from './common/modules';
import { QuestionBatchModule } from './modules/question-batch';
import { GroundingModule } from './modules/grounding';
import { AnalyticsModule } from './modules/analytics';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        azureConfig,
        langfuseConfig,
        emailConfig,
        dotnetConfig,
        swaggerConfig,
      ],
      envFilePath: ['.env'],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Config, true>) => {
        const app = config.get('app', { infer: true });
        return {
          pinoHttp: {
            level: app.logLevel,
            genReqId: () => randomUUID(),
            transport:
              app.nodeEnv !== 'production'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        };
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Config, true>) => ({
        connection: { url: config.get('redis', { infer: true }).url },
      }),
    }),
    BullBoardModule.forRootAsync({
      useFactory: () => ({
        route: '/admin/queues',
        adapter: ExpressAdapter,
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 10 }],
    }),
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    DatabaseModule,
    EmbeddingModule,
    DeduplicatorModule,
    ValidatorModule,
    TaggerModule,
    HealthModule,
    GeneratorModule,
    QuestionBatchModule,
    GroundingModule,
    AnalyticsModule,
    ObservabilityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: UserHeaderGuard },
  ],
})
export class AppModule {}
