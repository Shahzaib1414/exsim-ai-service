import { registerAs } from '@nestjs/config';

export interface IDatabaseConfig {
  url: string;
}

export const databaseConfig = registerAs<IDatabaseConfig>('database', () => ({
  url: process.env.DATABASE_URL!,
}));
