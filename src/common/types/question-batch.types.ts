import { z } from 'zod';

import { QuestionBatchStatusSchema } from '@/db/schemas/question-batch.schema';
import { QuestionBatchItemStatusSchema } from '@/db/schemas/question-batch-item.schema';
import { LlmUsageSchema } from './cost.types';
import {
  QuestionDifficultySchema,
  QuestionType,
  QuestionTypeSchema,
} from '@/db/schemas/question.schema';
import { TAuthUserReq } from './common.types';

export const QuestionBatchMetadataSchema = z.object({
  examType: z.string(),
  subject: z.string(),
  topic: z.string(),
  difficulty: QuestionDifficultySchema,
  grade: z.number().min(1).max(12),
  questionType: QuestionTypeSchema,
});
export type TQuestionBatchMetadata = z.infer<
  typeof QuestionBatchMetadataSchema
>;

export const createQuestionBatchSchema = z.object({
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

export type TCreateQuestionBatch = z.infer<typeof createQuestionBatchSchema>;

export const questionBatchItemResponseSchema = z.object({
  id: z.string().uuid(),
  status: QuestionBatchItemStatusSchema,
  questionId: z.string().uuid().nullable(),
  attemptCount: z.number(),
  errorMessage: z.string().nullable(),
  promptTokens: z.number().int().default(0),
  completionTokens: z.number().int().default(0),
  totalTokens: z.number().int().default(0),
});

export const questionBatchResponseSchema = z.object({
  id: z.string().uuid(),
  metadata: QuestionBatchMetadataSchema,
  requestedCount: z.number(),
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

export const listQuestionBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const getQuestionBatchItemsQuerySchema = z.object({
  status: QuestionBatchItemStatusSchema.optional(),
});

export const sampleQuestionBatchSchema = z.object({
  sampleSize: z.number().int().min(1).max(10).default(3),
});

export type TQuestionSampleBatch = z.infer<typeof sampleQuestionBatchSchema>;

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
  negativeExampleIds?: string[];
};

export const GenerateOneResultSchema = z.object({
  questionId: z.string().uuid(),
  usage: LlmUsageSchema,
});

export type TGenerateOneResult = z.infer<typeof GenerateOneResultSchema>;
