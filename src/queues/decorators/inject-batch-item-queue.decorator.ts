import { InjectQueue } from '@nestjs/bullmq';

import { BATCH_ITEM_QUEUE } from '../queue.constants';

export const InjectBatchItemQueue = (): ParameterDecorator =>
  InjectQueue(BATCH_ITEM_QUEUE);
