import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { BATCH_FLOW_PRODUCER_NAME } from './queue.constants';
import { BatchFlowService } from './services/batch-flow.service';
import { FlowConfigService } from './services/flow-config.service';

@Module({})
export class QueueModule {
  static register(options: { queues: string[] }): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.registerQueue(...options.queues.map((name) => ({ name }))),
      ],
      exports: [BullModule],
    };
  }

  /**
   * Register the generic BullMQ FlowProducer and BatchFlowService globally.
   * Call once in AppModule — any module can then inject BatchFlowService directly.
   */
  static registerFlowProducer(): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      imports: [
        BullModule.registerFlowProducer({ name: BATCH_FLOW_PRODUCER_NAME }),
      ],
      providers: [BatchFlowService, FlowConfigService],
      exports: [BatchFlowService, FlowConfigService, BullModule],
    };
  }
}
