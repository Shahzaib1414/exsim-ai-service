import { InjectFlowProducer } from '@nestjs/bullmq';

import { BATCH_FLOW_PRODUCER_NAME } from '../queue.constants';

export const InjectBatchFlowProducer = (): ParameterDecorator =>
  InjectFlowProducer(BATCH_FLOW_PRODUCER_NAME);
