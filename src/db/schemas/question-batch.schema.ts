import { integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';
import type { TQuestionBatchMetadata } from '@/common/types/question-batch.types';

export const QuestionBatchStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'FAILED',
]);
export type TQuestionBatchStatus = z.infer<typeof QuestionBatchStatusSchema>;
export const QuestionBatchStatus = QuestionBatchStatusSchema.enum;

export const QuestionBatches = pgTable('QuestionBatches', {
  ...baseEntityColumns,
  MetaData: jsonb('MetaData').notNull().$type<TQuestionBatchMetadata>(),
  RequestedCount: integer('RequestedCount').notNull(),
  SampleCount: integer('SampleCount').notNull().default(0),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .default(QuestionBatchStatus.PENDING)
    .$type<TQuestionBatchStatus>(),
  TotalPromptTokens: integer('TotalPromptTokens').notNull().default(0),
  TotalCompletionTokens: integer('TotalCompletionTokens').notNull().default(0),
  TotalTokens: integer('TotalTokens').notNull().default(0),
  EstimatedCostUsd: text('EstimatedCostUsd').notNull().default('0.000000'),
});

export type TQuestionBatchInsert = typeof QuestionBatches.$inferInsert;
export type TQuestionBatchSelect = typeof QuestionBatches.$inferSelect;
