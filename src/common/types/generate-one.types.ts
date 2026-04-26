import { z } from 'zod';

import { QuestionDifficultySchema } from '@/db/schemas/question.schema';

export const GenerateOneSchema = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
  difficulty: QuestionDifficultySchema,
});

export type TGenerateOneInput = z.infer<typeof GenerateOneSchema>;
