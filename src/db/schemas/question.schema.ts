import { pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';

export const questionTypeSchema = z.enum([
  'Short',
  'Mcqs',
  'Comprehensive',
  'Grouped',
  'Closed',
]);

export const questionDifficultySchema = z.enum(['High', 'Medium', 'Low']);

export const questionStatusSchema = z.enum(['Approved', 'Draft', 'Archived']);

export const questions = pgTable('Questions', {
  ...baseEntityColumns,
  Statement: text('Statement').notNull(),
  Solution: text('Solution').notNull(),
  ImageUrl: text('ImageUrl'),
  TopicId: uuid('TopicId').notNull(),
  ParentQuestionId: uuid('ParentQuestionId'),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .$type<(typeof questionStatusSchema.options)[number]>(),
});

export type TQuestionType = z.infer<typeof questionTypeSchema>;
export type TQuestionDifficulty = z.infer<typeof questionDifficultySchema>;
export type TQuestionStatus = z.infer<typeof questionStatusSchema>;
