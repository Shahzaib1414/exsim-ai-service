import { Controller } from '@nestjs/common';

import { QuestionService } from '../services/question.service';

@Controller('questions')
export class QuestionController {
  constructor(private readonly questionService: QuestionService) {}
}
