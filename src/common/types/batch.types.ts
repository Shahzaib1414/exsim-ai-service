import { z } from 'zod';

import { BatchStatusSchema } from '@/db/schemas/batch.schema';
import { BatchItemStatusSchema } from '@/db/schemas/batch-item.schema';
import type { TLlmUsage } from './cost.types';
import {
  QuestionDifficultySchema,
  QuestionType,
  QuestionTypeSchema,
} from '@/db/schemas/question.schema';

export const BatchMetadataSchema = z.object({
  examType: z.string(),
  subject: z.string(),
  topic: z.string(),
  difficulty: QuestionDifficultySchema,
  grade: z.number().min(1).max(12),
  questionType: QuestionTypeSchema,
});
export type TBatchMetadata = z.infer<typeof BatchMetadataSchema>;

export const createBatchSchema = z.object({
  examType: z.string().min(1),
  subject: z.string().min(1),
  topic: z.string().min(1),
  difficulty: QuestionDifficultySchema,
  count: z.number().int().min(1).max(100),
  grade: z
    .number()
    .min(1, { message: 'Grade should not be lower than 1' })
    .max(12, { message: 'Grade cannot be greater than 12' }),
  questionType: QuestionTypeSchema.default(QuestionType.Mcqs),
});

export type TCreateBatch = z.infer<typeof createBatchSchema>;

export const batchItemResponseSchema = z.object({
  id: z.string().uuid(),
  status: BatchItemStatusSchema,
  questionId: z.string().uuid().nullable(),
  attemptCount: z.number(),
  errorMessage: z.string().nullable(),
  duplicateQuestions: z.string().nullable(),
  promptTokens: z.number().int().default(0),
  completionTokens: z.number().int().default(0),
  totalTokens: z.number().int().default(0),
});

export const batchResponseSchema = z.object({
  id: z.string().uuid(),
  metadata: BatchMetadataSchema,
  requestedCount: z.number(),
  completedCount: z.number(),
  failedCount: z.number(),
  status: BatchStatusSchema,
  totalPromptTokens: z.number().int().default(0),
  totalCompletionTokens: z.number().int().default(0),
  totalTokens: z.number().int().default(0),
  estimatedCostUsd: z.string().default('0.00'),
});

export const batchWithItemsResponseSchema = batchResponseSchema.extend({
  items: z.array(batchItemResponseSchema),
});

export type TBatchResponse = z.infer<typeof batchResponseSchema>;
export type TBatchWithItemsResponse = z.infer<
  typeof batchWithItemsResponseSchema
>;
export type TBatchItemResponse = z.infer<typeof batchItemResponseSchema>;

export const listBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const getBatchItemsQuerySchema = z.object({
  status: BatchItemStatusSchema.optional(),
});

export const sampleBatchSchema = z.object({
  sampleSize: z.number().int().min(1).max(10).default(3),
});

export type TSampleBatch = z.infer<typeof sampleBatchSchema>;

export type TBatchItemJobData = {
  batchItemId: string;
  batchId: string;
  examType: string;
  subject: string;
  topic: string;
  difficulty: z.infer<typeof QuestionDifficultySchema>;
  grade: number;
  questionType: z.infer<typeof QuestionTypeSchema>;
  negativeExampleIds?: string[];
};

export type TGenerateOneResult =
  | { needsReview: false; questionId: string; usage: TLlmUsage }
  | { needsReview: true; duplicateQuestionIds: string[] };
