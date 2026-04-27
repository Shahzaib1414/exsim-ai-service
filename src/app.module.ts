import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
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
    DatabaseModule,
    EmbeddingModule,
    DeduplicatorModule,
    ValidatorModule,
    TaggerModule,
    HealthModule,
    GeneratorModule,
    ObservabilityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
