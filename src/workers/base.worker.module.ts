import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { QUESTION_BATCH_ITEM_QUEUE, QueueModule } from '@/queues';
import { EmailModule } from '@/modules/email';

@Module({
  imports: [
    ConfigModule.forRoot(),
    LoggerModule,
    QueueModule.register({ queues: [QUESTION_BATCH_ITEM_QUEUE] }),
    EmailModule,
  ],
  exports: [QueueModule, EmailModule],
})
export class BaseWorkerModule {}
