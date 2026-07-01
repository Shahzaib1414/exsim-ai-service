import { InjectQueue } from '@nestjs/bullmq';

import { QUESTION_BATCH_ITEM_QUEUE } from '../queue.constants';

export const InjectQuestionBatchItemQueue = (): ParameterDecorator =>
  InjectQueue(QUESTION_BATCH_ITEM_QUEUE);
