import { z } from 'zod';

export enum EmailTemplate {
  QUESTION_BATCH_SUCCESS = 'question-batch-success',
  QUESTION_BATCH_FAILURE = 'question-batch-failure',
  QUESTION_BATCH_PENDING_REVIEW = 'question-batch-pending-review',
  DOCUMENT_INGESTION_SUCCESS = 'document-ingestion-success',
  DOCUMENT_INGESTION_FAILURE = 'document-ingestion-failure',
  AI_ANGEL_REPORT_SUCCESS = 'ai-angel-report-success',
  AI_ANGEL_REPORT_FAILURE = 'ai-angel-report-failure',
}

export const sendEmailOptionsSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1),
  template: z.nativeEnum(EmailTemplate),
  context: z.record(z.unknown()),
});

export type TSendEmailOptions = z.infer<typeof sendEmailOptionsSchema>;
