import { Injectable } from '@nestjs/common';
import { InjectFlowProducer } from '@nestjs/bullmq';
import { FlowProducer } from 'bullmq';

import { BATCH_FLOW_PRODUCER_NAME } from '../queue.constants';
import type { FlowJob } from './../../queues/types/flow.types';

/**
 * Generic BullMQ flow executor.
 *
 * Registered globally via QueueModule.registerFlowProducer() so any module can
 * inject this service without explicitly importing QueueModule.
 *
 * Domain-specific flow config services (e.g. QuestionBatchFlowConfigService)
 * build the FlowJob and hand it here — this service knows nothing about domain logic.
 */
@Injectable()
export class BatchFlowService {
  constructor(
    @InjectFlowProducer(BATCH_FLOW_PRODUCER_NAME)
    private readonly flowProducer: FlowProducer,
  ) {}

  async add(flowJob: FlowJob): Promise<string> {
    const result = await this.flowProducer.add(flowJob);
    return result.job.id ?? '';
  }
}
