import { Module } from '@nestjs/common';

import { QuestionModule } from '@/modules/question/question.module';
import { DeduplicatorModule } from '@/modules/deduplicator';
import { ValidatorModule } from '@/modules/validator';
import { TaggerModule } from '@/modules/tagger';
import { GeneratorController } from './controllers/generator.controller';
import { GeneratorService } from './services/generator.service';

@Module({
  imports: [QuestionModule, DeduplicatorModule, ValidatorModule, TaggerModule],
  controllers: [GeneratorController],
  providers: [GeneratorService],
})
export class GeneratorModule {}
