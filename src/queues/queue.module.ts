import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

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
}
