import { z } from 'zod';

import {
  QuestionDifficultySchema,
  QuestionType,
  QuestionTypeSchema,
} from '@/db/schemas/question.schema';

export const GenerateOneSchema = z.object({
  examType: z.string().min(1),
  subject: z.string().min(1),
  topic: z.string().min(1),
  difficulty: QuestionDifficultySchema,
  grade: z
    .number()
    .min(1, { message: 'Grade should not be lower than 1' })
    .max(12, { message: 'Grade cannot be greater than 12' }),
  questionType: QuestionTypeSchema.default(QuestionType.Mcqs),
});

export type TGenerateOneInput = z.infer<typeof GenerateOneSchema>;
