import { z } from 'zod';

import { QuestionDifficultySchema } from '@/db/schemas/question.schema';

export const QuestionSchema = z.object({
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  // TODO: add maxTokens budget guard when cost controls are introduced (Phase 9)
});

export type TQuestion = z.infer<typeof QuestionSchema>;
export type TQuestionDifficulty = z.infer<typeof QuestionDifficultySchema>;
