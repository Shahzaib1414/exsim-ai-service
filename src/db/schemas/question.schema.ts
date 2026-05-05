import { relations } from 'drizzle-orm';
import { pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';

export const QuestionTypeSchema = z.enum([
  'Short',
  'Mcqs',
  'Comprehensive',
  'Grouped',
  'Closed',
]);

export const QuestionDifficultySchema = z.enum(['High', 'Medium', 'Low']);

export const QuestionStatusSchema = z.enum([
  'Approved',
  'Draft',
  'Archived',
  'Duplicate',
]);

export const Questions = pgTable('Questions', {
  ...baseEntityColumns,
  Statement: text('Statement').notNull(),
  Solution: text('Solution').notNull(),
  ImageUrl: text('ImageUrl'),
  TopicId: uuid('TopicId').notNull(),
  ParentQuestionId: uuid('ParentQuestionId'),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .$type<(typeof QuestionStatusSchema.options)[number]>(),
  DuplicateQuestionIds: text('DuplicateQuestionIds'),
});

export const QuestionsRelations = relations(Questions, ({ one, many }) => ({
  ParentQuestion: one(Questions, {
    fields: [Questions.ParentQuestionId],
    references: [Questions.Id],
  }),
  ChildQuestions: many(Questions),
}));

export type TQuestionType = z.infer<typeof QuestionTypeSchema>;
export type TQuestionDifficulty = z.infer<typeof QuestionDifficultySchema>;
export type TQuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const QuestionStatus = QuestionStatusSchema.enum;
export const QuestionType = QuestionTypeSchema.enum;
export const QuestionDifficulty = QuestionDifficultySchema.enum;
