import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { QuestionController } from './controllers/question.controller';
import { QuestionService } from './services/question.service';

@Module({
  imports: [HttpModule],
  controllers: [QuestionController],
  providers: [QuestionService],
  exports: [QuestionService],
})
export class QuestionModule {}
