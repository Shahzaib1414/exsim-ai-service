import { integer, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';
import type { TBatchMetadata } from '@/common/types/batch.types';

export const BatchStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
]);
export type TBatchStatus = z.infer<typeof BatchStatusSchema>;
export const BatchStatus = BatchStatusSchema.enum;

export const Batches = pgTable('Batches', {
  ...baseEntityColumns,
  Metadata: jsonb('Metadata').notNull().$type<TBatchMetadata>(),
  RequestedCount: integer('RequestedCount').notNull(),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .default(BatchStatus.PENDING)
    .$type<TBatchStatus>(),
  TotalPromptTokens: integer('TotalPromptTokens').notNull().default(0),
  TotalCompletionTokens: integer('TotalCompletionTokens').notNull().default(0),
  TotalTokens: integer('TotalTokens').notNull().default(0),
  EstimatedCostUsd: text('EstimatedCostUsd').notNull().default('0.000000'),
});

export type TBatchInsert = typeof Batches.$inferInsert;
export type TBatchSelect = typeof Batches.$inferSelect;
