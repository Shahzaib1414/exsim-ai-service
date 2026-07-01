import { z } from 'zod';

export const ValidationResultSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(z.string()),
});

export type TValidationResult = z.infer<typeof ValidationResultSchema>;
