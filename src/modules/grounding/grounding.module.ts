import { Module } from '@nestjs/common';

import { GroundingController } from './controllers/grounding.controller';
import { GroundingService } from './services/grounding.service';
import { PdfChunkerService } from './services/pdf-chunker.service';

@Module({
  controllers: [GroundingController],
  providers: [GroundingService, PdfChunkerService],
  exports: [GroundingService],
})
export class GroundingModule {}
