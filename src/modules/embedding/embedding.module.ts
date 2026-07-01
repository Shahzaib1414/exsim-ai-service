import { Global, Module } from '@nestjs/common';

import { EmbeddingService } from './services/embedding.service';
import { AzureEmbeddingService } from './services/azure-embedding.service';

@Global()
@Module({
  providers: [{ provide: EmbeddingService, useClass: AzureEmbeddingService }],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
