import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Config } from '@/config';
import { createDrizzleClient, DrizzleClient } from '../db';

export const DRIZZLE_CLIENT = 'DRIZZLE_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Config, true>): DrizzleClient => {
        return createDrizzleClient(config.get('database', { infer: true }).url);
      },
    },
  ],
  exports: [DRIZZLE_CLIENT],
})
export class DatabaseModule {}
