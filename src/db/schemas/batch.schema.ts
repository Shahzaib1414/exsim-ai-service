import { integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';
import { QuestionDifficultySchema } from './question.schema';

export const BatchStatusSchema = z.enum([
  'pending',
  'sampling',
  'running',
  'completed',
  'failed',
]);
export type TBatchStatus = z.infer<typeof BatchStatusSchema>;

export const Batches = pgTable('Batches', {
  ...baseEntityColumns,
  Subject: text('Subject').notNull(),
  Topic: text('Topic').notNull(),
  Difficulty: varchar('Difficulty', { length: 10 })
    .notNull()
    .$type<z.infer<typeof QuestionDifficultySchema>>(),
  RequestedCount: integer('RequestedCount').notNull(),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .default('pending')
    .$type<TBatchStatus>(),
});

export type TBatchInsert = typeof Batches.$inferInsert;
export type TBatchSelect = typeof Batches.$inferSelect;
