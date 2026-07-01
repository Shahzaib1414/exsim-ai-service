import { registerAs } from '@nestjs/config';

export interface IAppConfig {
  nodeEnv: string;
  port: number;
  logLevel: string;
  frontendBaseUrl: string;
}

export const appConfig = registerAs<IAppConfig>('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? '',
}));
