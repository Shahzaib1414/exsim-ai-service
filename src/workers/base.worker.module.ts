import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { BATCH_ITEM_QUEUE, QueueModule } from '@/queues';

@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule,
    QueueModule.register({ queues: [BATCH_ITEM_QUEUE] }),
  ],
  exports: [QueueModule],
})
export class BaseWorkerModule {}
