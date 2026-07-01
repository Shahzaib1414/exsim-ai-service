import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/database/database.module';
import { GeneratorModule } from '@/modules/generator';
import { QuestionModule } from '@/modules/question/question.module';
import {
  QueueModule,
  QUESTION_BATCH_ITEM_QUEUE,
  QUESTION_BATCH_SAMPLE_COMPLETE_QUEUE,
} from '@/queues';
import { QuestionBatchWorker } from '@/workers/question-batch.worker';
import { QuestionBatchSampleWorker } from '@/workers/question-batch-sample.worker';
import { QuestionBatchController } from './controllers/question-batch.controller';
import { QuestionBatchService } from './services/question-batch.service';

@Module({
  imports: [
    QueueModule.register({
      queues: [QUESTION_BATCH_ITEM_QUEUE, QUESTION_BATCH_SAMPLE_COMPLETE_QUEUE],
    }),
    DatabaseModule,
    GeneratorModule,
    QuestionModule,
  ],
  controllers: [QuestionBatchController],
  providers: [
    QuestionBatchService,
    QuestionBatchWorker,
    QuestionBatchSampleWorker,
  ],
  exports: [QuestionBatchService],
})
export class QuestionBatchModule {}
