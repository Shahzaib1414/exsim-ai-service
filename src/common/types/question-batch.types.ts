import { z } from 'zod';

import {
  BatchType,
  BatchTypeSchema,
  QuestionBatchStatusSchema,
} from '@/db/schemas/question-batch.schema';
import { QuestionBatchItemStatusSchema } from '@/db/schemas/question-batch-item.schema';
import { LlmUsageSchema } from './cost.types';
import {
  QuestionDifficultySchema,
  QuestionType,
  QuestionTypeSchema,
} from '@/db/schemas/question.schema';
import {
  PaginationMetaSchema,
  PaginationOptionsSchema,
  TAuthUserReq,
} from './common.types';

export const QuestionBatchMetadataSchema = z.object({
  examType: z.string(),
  subject: z.string(),
  topic: z.string(),
  difficulty: QuestionDifficultySchema,
  grade: z.number().min(1).max(12),
  questionType: QuestionTypeSchema,
  batchType: BatchTypeSchema.default(BatchType.TEXT),
});
export type TQuestionBatchMetadata = z.infer<
  typeof QuestionBatchMetadataSchema
>;

export const createQuestionBatchSchema = z.object({
  examType: z.string().min(1),
  subject: z.string().min(1),
  topic: z.string().min(1),
  difficulty: QuestionDifficultySchema,
  count: z.coerce
    .number({ invalid_type_error: 'Count must be a number' })
    .int({ message: 'Count must be an integer' })
    .min(1, { message: 'Count must be at least 1' })
    .max(100, { message: 'Count cannot exceed 100' }),
  grade: z.coerce
    .number({ invalid_type_error: 'Grade must be a number' })
    .min(1, { message: 'Grade should not be lower than 1' })
    .max(12, { message: 'Grade cannot be greater than 12' }),
  questionType: QuestionTypeSchema.default(QuestionType.Mcqs),
  batchType: BatchTypeSchema.default(BatchType.TEXT),
});

export type TCreateQuestionBatch = z.infer<typeof createQuestionBatchSchema>;

export const questionBatchItemResponseSchema = z.object({
  id: z.string().uuid(),
  status: QuestionBatchItemStatusSchema,
  questionId: z.string().uuid().nullable(),
  isSample: z.boolean().default(false),
  attemptCount: z.number(),
  errorMessage: z.string().nullable(),
  promptTokens: z.number().int().default(0),
  completionTokens: z.number().int().default(0),
  totalTokens: z.number().int().default(0),
});

export const batchItemQuestionOptionSchema = z.object({
  id: z.string().uuid(),
  option: z.string(),
  isCorrect: z.boolean(),
  position: z.number().int(),
});

export const batchItemQuestionTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  value: z.string(),
});

export const batchItemQuestionSchema = z
  .object({
    id: z.string().uuid(),
    statement: z.string(),
    solution: z.string(),
    imageUrl: z.string().nullable(),
    options: z.array(batchItemQuestionOptionSchema),
    tags: z.array(batchItemQuestionTagSchema),
    childQuestions: z.array(
      z.object({
        id: z.string().uuid(),
        statement: z.string(),
        solution: z.string(),
        imageUrl: z.string().nullable(),
        options: z.array(batchItemQuestionOptionSchema),
        tags: z.array(batchItemQuestionTagSchema),
      }),
    ),
  })
  .nullable();

export const questionBatchItemWithQuestionResponseSchema =
  questionBatchItemResponseSchema.extend({
    question: batchItemQuestionSchema,
  });

export const questionBatchResponseSchema = z.object({
  id: z.string().uuid(),
  metadata: QuestionBatchMetadataSchema,
  batchType: BatchTypeSchema.default(BatchType.TEXT),
  requestedCount: z.number(),
  sampleCount: z.number().int().default(0),
  completedCount: z.number(),
  failedCount: z.number(),
  status: QuestionBatchStatusSchema,
  totalPromptTokens: z.number().int().default(0),
  totalCompletionTokens: z.number().int().default(0),
  totalTokens: z.number().int().default(0),
  estimatedCostUsd: z.string().default('0.00'),
});

export const questionBatchWithItemsResponseSchema =
  questionBatchResponseSchema.extend({
    items: z.array(questionBatchItemResponseSchema),
  });

export type TQuestionBatchResponse = z.infer<
  typeof questionBatchResponseSchema
>;
export type TQuestionBatchWithItemsResponse = z.infer<
  typeof questionBatchWithItemsResponseSchema
>;
export type TQuestionBatchItemResponse = z.infer<
  typeof questionBatchItemResponseSchema
>;

export const QuestionBatchesFilterZod = PaginationOptionsSchema.extend({
  subject: z.string().optional(),
  topic: z.string().optional(),
  examType: z.string().optional(),
  search: z.string().optional(),
  status: QuestionBatchStatusSchema.optional(),
});
export type TQuestionBatchesFilter = z.infer<typeof QuestionBatchesFilterZod>;

export const QuestionBatchPaginatedResponseSchema = z.object({
  items: z.array(questionBatchResponseSchema),
  meta: PaginationMetaSchema,
});
export type TQuestionBatchPaginatedResponse = z.infer<
  typeof QuestionBatchPaginatedResponseSchema
>;

export const getQuestionBatchItemsQuerySchema = PaginationOptionsSchema.extend({
  status: QuestionBatchItemStatusSchema.optional(),
});

export const QuestionBatchItemsPaginatedResponseSchema = z.object({
  items: z.array(questionBatchItemWithQuestionResponseSchema),
  meta: PaginationMetaSchema,
});

export type TQuestionBatchItemWithQuestionResponse = z.infer<
  typeof questionBatchItemWithQuestionResponseSchema
>;
export type TQuestionBatchItemsPaginatedResponse = z.infer<
  typeof QuestionBatchItemsPaginatedResponseSchema
>;

export type TQuestionBatchItemJobData = {
  user: TAuthUserReq;
  questionBatchItemId: string;
  questionBatchId: string;
  examType: string;
  subject: string;
  topic: string;
  difficulty: z.infer<typeof QuestionDifficultySchema>;
  grade: number;
  questionType: z.infer<typeof QuestionTypeSchema>;
  batchType: z.infer<typeof BatchTypeSchema>;
  negativeExampleIds?: string[];
};

export type TQuestionBatchSampleCompleteJobData = {
  batchId: string;
  user: TAuthUserReq;
};

export const GenerateOneResultSchema = z.object({
  questionId: z.string().uuid(),
  usage: LlmUsageSchema,
});

export type TGenerateOneResult = z.infer<typeof GenerateOneResultSchema>;
