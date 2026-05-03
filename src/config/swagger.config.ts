import { ISwaggerConfig } from '@/common';
import { registerAs } from '@nestjs/config';

export default registerAs<ISwaggerConfig>('swagger', () => ({
  enabled: process.env['SWAGGER_ENABLED'] === 'true',
}));
