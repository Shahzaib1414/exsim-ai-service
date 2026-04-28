import { integer, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';
import { Batches } from './batch.schema';

export const BatchItemStatusSchema = z.enum(['pending', 'generated', 'failed']);
export type TBatchItemStatus = z.infer<typeof BatchItemStatusSchema>;

export const BatchItems = pgTable('BatchItems', {
  ...baseEntityColumns,
  BatchId: uuid('BatchId')
    .notNull()
    .references(() => Batches.Id),
  QuestionId: uuid('QuestionId'),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .default('pending')
    .$type<TBatchItemStatus>(),
  AttemptCount: integer('AttemptCount').notNull().default(0),
  ErrorMessage: text('ErrorMessage'),
  PromptTokens: integer('PromptTokens').notNull().default(0),
  CompletionTokens: integer('CompletionTokens').notNull().default(0),
  TotalTokens: integer('TotalTokens').notNull().default(0),
});

export type TBatchItemInsert = typeof BatchItems.$inferInsert;
export type TBatchItemSelect = typeof BatchItems.$inferSelect;
