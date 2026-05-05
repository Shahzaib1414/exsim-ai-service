import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import basicAuth from 'express-basic-auth';

import type { TEnv } from '@/config/env.schema';
import * as QueueConstants from './queue.constants';

@Module({
  imports: [
    BullBoardModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<TEnv, true>) => ({
        route: '/admin/queues',
        adapter: ExpressAdapter,
        middleware: basicAuth({
          users: {
            [configService.get('QUEUE_DASHBOARD_USERNAME', { infer: true })]:
              configService.get('QUEUE_DASHBOARD_PASSWORD', { infer: true }),
          },
          challenge: true,
          realm: 'Bull Board',
        }),
      }),
    }),
    ...Object.keys(QueueConstants)
      .filter((key) => key.endsWith('_QUEUE'))
      .map((key) =>
        BullBoardModule.forFeature({
          name: QueueConstants[key as keyof typeof QueueConstants],
          adapter: BullMQAdapter,
        }),
      ),
  ],
})
export class QueueDashboardModule {}
