import { Global, Module } from '@nestjs/common';

import { LangfuseService } from '@/common/services/langfuse.service';

@Global()
@Module({
  providers: [LangfuseService],
  exports: [LangfuseService],
})
export class ObservabilityModule {}
