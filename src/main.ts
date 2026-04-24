import * as appInsights from 'applicationinsights';
import { NestFactory } from '@nestjs/core';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from './app.module';
// import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { QueryErrorInterceptor } from './common/interceptors/query-validation.interceptor';
import { PathValidationInterceptor } from './common/interceptors/path-validation.interceptor';
import { ValidationErrorInterceptor } from './common';
import { HeaderErrorInterceptor } from './common/interceptors/header-validation.interceptor';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
if (connectionString) {
  appInsights.setup(connectionString).start();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // await app.listen(process.env.PORT ?? 3000);

  // const config = app.get<ConfigService>(ConfigService)['internalConfig'];
  app.useGlobalPipes(new ValidationPipe());
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.useGlobalInterceptors(new QueryErrorInterceptor());
  app.useGlobalInterceptors(new PathValidationInterceptor());
  app.useGlobalInterceptors(new HeaderErrorInterceptor());
  app.useGlobalInterceptors(new ValidationErrorInterceptor());

  const port = 3000;

  await app.listen(port);
}

void bootstrap();
