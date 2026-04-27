import { z } from 'zod';

export const PdfChunkSchema = z.object({
  text: z.string(),
  pageNumber: z.number().nullable(),
  sourceDoc: z.string(),
});
export type TPdfChunk = z.infer<typeof PdfChunkSchema>;

export const IngestDocumentQueryParamsSchema = z.object({
  subject: z.string().min(1),
  topic: z.string().min(1),
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
