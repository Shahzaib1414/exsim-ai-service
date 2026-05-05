import { registerAs } from '@nestjs/config';

export interface IRedisConfig {
  url: string;
}

export const redisConfig = registerAs<IRedisConfig>('redis', () => ({
  url: process.env.REDIS_URL!,
}));
