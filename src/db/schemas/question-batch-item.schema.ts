import {
  boolean,
  integer,
  pgTable,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';
import { QuestionBatches } from './question-batch.schema';
import { Questions } from './question.schema';

export const QuestionBatchItemStatusSchema = z.enum([
  'PENDING',
  'COMPLETED',
  'FAILED',
  'NEEDS_REVIEW',
]);
export type TQuestionBatchItemStatus = z.infer<
  typeof QuestionBatchItemStatusSchema
>;
export const QuestionBatchItemStatus = QuestionBatchItemStatusSchema.enum;

export const QuestionBatchItems = pgTable('QuestionBatchItems', {
  ...baseEntityColumns,
  QuestionBatchId: uuid('QuestionBatchId')
    .notNull()
    .references(() => QuestionBatches.Id),
  QuestionId: uuid('QuestionId'),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .default(QuestionBatchItemStatus.PENDING)
    .$type<TQuestionBatchItemStatus>(),
  IsSample: boolean('IsSample').notNull().default(false),
  AttemptCount: integer('AttemptCount').notNull().default(0),
  ErrorMessage: text('ErrorMessage'),
  PromptTokens: integer('PromptTokens').notNull().default(0),
  CompletionTokens: integer('CompletionTokens').notNull().default(0),
  TotalTokens: integer('TotalTokens').notNull().default(0),
});

export const questionBatchItemRelations = relations(
  QuestionBatchItems,
  ({ one }) => ({
    question: one(Questions, {
      fields: [QuestionBatchItems.QuestionId],
      references: [Questions.Id],
    }),
    batch: one(QuestionBatches, {
      fields: [QuestionBatchItems.QuestionBatchId],
      references: [QuestionBatches.Id],
    }),
  }),
);

export type TQuestionBatchItemInsert = typeof QuestionBatchItems.$inferInsert;
export type TQuestionBatchItemSelect = typeof QuestionBatchItems.$inferSelect;
