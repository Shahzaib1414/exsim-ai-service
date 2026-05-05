import { registerAs } from '@nestjs/config';

export interface ILangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export const langfuseConfig = registerAs<ILangfuseConfig>('langfuse', () => ({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL!,
}));
