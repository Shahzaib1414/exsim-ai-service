import { z } from 'zod';

export enum EmailTemplate {
  QUESTION_BATCH_SUCCESS = 'question-batch-success',
  QUESTION_BATCH_FAILURE = 'question-batch-failure',
}

export const sendEmailOptionsSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1),
  template: z.nativeEnum(EmailTemplate),
  context: z.record(z.unknown()),
});

export type TSendEmailOptions = z.infer<typeof sendEmailOptionsSchema>;
