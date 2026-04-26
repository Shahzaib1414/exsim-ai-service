import { Module } from '@nestjs/common';

import { QuestionModule } from '@/modules/question/question.module';
import { GeneratorController } from './controllers/generator.controller';
import { GeneratorService } from './services/generator.service';

@Module({
  imports: [QuestionModule],
  controllers: [GeneratorController],
  providers: [GeneratorService],
})
export class GeneratorModule {}
