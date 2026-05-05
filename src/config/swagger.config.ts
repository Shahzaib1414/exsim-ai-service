import { registerAs } from '@nestjs/config';
import { ISwaggerConfig } from '@/common';

export type { ISwaggerConfig };

export const swaggerConfig = registerAs<ISwaggerConfig>('swagger', () => ({
  enabled: process.env['SWAGGER_ENABLED'] === 'true',
}));
