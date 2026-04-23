import { z } from 'zod';

export const questionTypeSchema = z.enum([
  'Short',
  'Mcqs',
  'Comprehensive',
  'Grouped',
  'Closed',
]);

export const questionDifficultySchema = z.enum(['High', 'Medium', 'Low']);

export const questionStatusSchema = z.enum(['Approved', 'Draft', 'Archived']);

export type TQuestionType = z.infer<typeof questionTypeSchema>;
export type TQuestionDifficulty = z.infer<typeof questionDifficultySchema>;
export type TQuestionStatus = z.infer<typeof questionStatusSchema>;
