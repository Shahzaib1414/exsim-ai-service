import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

import { DatabaseModule } from '@/database/database.module';
import { GeneratorModule } from '@/modules/generator';
import { EmailModule } from '@/modules/email';
import { QuestionModule } from '@/modules/question/question.module';
import { QueueModule, QUESTION_BATCH_ITEM_QUEUE } from '@/queues';
import { QuestionBatchWorker } from '@/workers/question-batch.worker';
import { QuestionBatchController } from './controllers/question-batch.controller';
import { QuestionBatchService } from './services/question-batch.service';

@Module({
  imports: [
    QueueModule.register({ queues: [QUESTION_BATCH_ITEM_QUEUE] }),
    BullBoardModule.forFeature({
      name: QUESTION_BATCH_ITEM_QUEUE,
      adapter: BullMQAdapter,
    }),
    DatabaseModule,
    GeneratorModule,
    EmailModule,
    QuestionModule,
  ],
  controllers: [QuestionBatchController],
  providers: [QuestionBatchService, QuestionBatchWorker],
})
export class QuestionBatchModule {}
