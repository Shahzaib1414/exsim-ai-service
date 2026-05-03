import { z } from 'zod';

import { QuestionTypeSchema, QuestionType } from '@/db/schemas/question.schema';

export const PdfChunkSchema = z.object({
  text: z.string(),
  pageNumber: z.number().nullable(),
  sourceDoc: z.string(),
});
export type TPdfChunk = z.infer<typeof PdfChunkSchema>;

export const GroundingMetadataSchema = z.object({
  examType: z.string(),
  subject: z.string(),
  topic: z.string(),
  grade: z.number().min(1).max(12),
  questionType: QuestionTypeSchema,
});
export type TGroundingMetadata = z.infer<typeof GroundingMetadataSchema>;

export const IngestDocumentQueryParamsSchema = z.object({
  examType: z.string().min(1),
  subject: z.string().min(1),
  topic: z.string().min(1),
  grade: z.coerce.number().min(1).max(12),
  questionType: QuestionTypeSchema.default(QuestionType.Mcqs),
});
export type TIngestDocumentQueryParams = z.infer<
  typeof IngestDocumentQueryParamsSchema
>;

export const IngestDocumentResponseSchema = z.object({
  chunksStored: z.number(),
  fileName: z.string(),
});
export type TIngestDocumentResponse = z.infer<
  typeof IngestDocumentResponseSchema
>;
