import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { randomUUID } from 'crypto';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { databaseConfig, validate } from './config';
import { DatabaseModule } from './database/database.module';
import { GeneratorModule } from './modules/generator';
import { HealthModule } from './modules/health';
import { EmbeddingModule } from './modules/embedding';
import { DeduplicatorModule } from './modules/deduplicator';
import { ValidatorModule } from './modules/validator';
import { TaggerModule } from './modules/tagger';
import { ObservabilityModule } from './common/modules';
import { BatchModule } from './modules/batch';
import { GroundingModule } from './modules/grounding';
import { AnalyticsModule } from './modules/analytics';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      load: [databaseConfig],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') !== 'production';
        return {
          pinoHttp: {
            level: config.get<string>('LOG_LEVEL') ?? 'info',
            genReqId: () => randomUUID(),
            transport: isDev
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          },
        };
      },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    BullBoardModule.forRootAsync({
      useFactory: () => ({
        route: '/admin/queues',
        adapter: ExpressAdapter,
      }),
    }),
    DatabaseModule,
    EmbeddingModule,
    DeduplicatorModule,
    ValidatorModule,
    TaggerModule,
    HealthModule,
    GeneratorModule,
    BatchModule,
    GroundingModule,
    AnalyticsModule,
    ObservabilityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
