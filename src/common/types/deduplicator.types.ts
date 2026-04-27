import { z } from 'zod';

export const DuplicateCheckResultSchema = z.object({
  isUnique: z.boolean(),
  similarQuestionIds: z.array(z.string()),
});

export type TDuplicateCheckResult = z.infer<typeof DuplicateCheckResultSchema>;

export const DEDUP_SIMILARITY_THRESHOLD = 0.9;
