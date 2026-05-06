import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';

import { Public } from '@/common/decorators';
import type { Config } from '@/config';
import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';

const version = process.env.npm_package_version ?? 'unknown';

@Controller('health')
export class HealthController implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly config: ConfigService<Config, true>,
    @Inject(DRIZZLE_CLIENT) private readonly db: DrizzleClient,
  ) {
    this.redis = new Redis(config.get('redis', { infer: true }).url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
    });
  }

  onModuleDestroy(): void {
    void this.redis.quit();
  }

  @Public()
  @Get()
  async check() {
    const environment = this.config.get('app', { infer: true }).nodeEnv;
    let healthy = true;
    const checks: Record<string, 'ok' | 'error'> = {};

    try {
      await this.db.execute(sql`SELECT 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
      healthy = false;
    }

    try {
      await this.redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      healthy = false;
    }

    if (!healthy) {
      throw new HttpException(
        { status: 'error', version, environment, checks },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok', version, environment, checks };
  }
}
