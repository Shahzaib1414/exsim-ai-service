import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { version } from '../../../package.json';

import { Public } from '@/common/decorators';
import type { Config } from '@/config';

@Controller('health')
export class HealthController {
  constructor(private readonly config: ConfigService<Config, true>) {}

  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      version,
      environment: this.config.get('app', { infer: true }).nodeEnv,
    };
  }
}
