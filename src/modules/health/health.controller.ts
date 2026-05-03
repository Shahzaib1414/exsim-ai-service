import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { version } from '../../../package.json';

import { Public } from '@/common/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      version,
      environment: this.config.get<string>('NODE_ENV'),
    };
  }
}
