import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

import { DatabaseModule } from '@/database/database.module';
import { GeneratorModule } from '@/modules/generator';
import { QueueModule, BATCH_ITEM_QUEUE } from '@/queues';
import { BatchWorker } from '@/workers/batch.worker';
import { BatchController } from './controllers/batch.controller';
import { BatchService } from './services/batch.service';

@Module({
  imports: [
    QueueModule.register({ queues: [BATCH_ITEM_QUEUE] }),
    BullBoardModule.forFeature({
      name: BATCH_ITEM_QUEUE,
      adapter: BullMQAdapter,
    }),
    DatabaseModule,
    GeneratorModule,
  ],
  controllers: [BatchController],
  providers: [BatchService, BatchWorker],
})
export class BatchModule {}
