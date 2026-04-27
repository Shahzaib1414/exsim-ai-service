import { Global, Module } from '@nestjs/common';

import { DeduplicatorService } from './services/deduplicator.service';

@Global()
@Module({
  providers: [DeduplicatorService],
  exports: [DeduplicatorService],
})
export class DeduplicatorModule {}
