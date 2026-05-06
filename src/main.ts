import * as appInsights from 'applicationinsights';
import { NestFactory } from '@nestjs/core';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setupSwagger } from '@/swagger';

import { AppModule } from './app.module';
import {
  HeaderErrorInterceptor,
  PathValidationInterceptor,
  QueryErrorInterceptor,
  ValidationErrorInterceptor,
} from '@/common/interceptors';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
  appInsights.setup(connectionString).start();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.useGlobalInterceptors(new QueryErrorInterceptor());
  app.useGlobalInterceptors(new PathValidationInterceptor());
  app.useGlobalInterceptors(new HeaderErrorInterceptor());
  app.useGlobalInterceptors(new ValidationErrorInterceptor());

  const configService = app.get<ConfigService>(ConfigService);
  const port = configService.get('app', { infer: true }).port;
  const config = configService['internalConfig'];

  if (config.swagger.enabled) {
    setupSwagger(app, `http://localhost:${port}`);
  }

  await app.listen(port);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
