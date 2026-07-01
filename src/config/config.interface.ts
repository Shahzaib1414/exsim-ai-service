import type { IAppConfig } from './app.config';
import type { IDatabaseConfig } from './database.config';
import type { IRedisConfig } from './redis.config';
import type { IAzureConfig } from './azure.config';
import type { ILangfuseConfig } from './langfuse.config';
import type { IEmailConfig } from './email.config';
import type { IDotnetConfig } from './dotnet.config';
import type { ISwaggerConfig } from './swagger.config';

export interface Config {
  app: IAppConfig;
  database: IDatabaseConfig;
  redis: IRedisConfig;
  azure: IAzureConfig;
  langfuse: ILangfuseConfig;
  email: IEmailConfig;
  dotnet: IDotnetConfig;
  swagger: ISwaggerConfig;
}
