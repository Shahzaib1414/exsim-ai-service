import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/database/database.module';
import { QueueModule, DOCUMENT_INGESTION_QUEUE } from '@/queues';
import { DocumentIngestionWorker } from '@/workers/document-ingestion.worker';
import { GroundingController } from './controllers/grounding.controller';
import { GroundingService } from './services/grounding.service';
import { PdfChunkerService } from './services/pdf-chunker.service';

@Module({
  imports: [
    QueueModule.register({ queues: [DOCUMENT_INGESTION_QUEUE] }),
    DatabaseModule,
  ],
  controllers: [GroundingController],
  providers: [GroundingService, PdfChunkerService, DocumentIngestionWorker],
  exports: [GroundingService],
})
export class GroundingModule {}
