import { z } from 'zod';

import { QuestionDifficultySchema } from '@/db/schemas/question.schema';

// ─── LLM / Domain ─────────────────────────────────────────────────────────────

export const QuestionSchema = z.object({
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
  // TODO: add maxTokens budget guard when cost controls are introduced (Phase 9)
});

export type TQuestion = z.infer<typeof QuestionSchema>;
export type TQuestionDifficulty = z.infer<typeof QuestionDifficultySchema>;

// ─── .NET API payload ─────────────────────────────────────────────────────────

export const CreateQuestionOptionSchema = z.object({
  option: z.string(),
  isCorrect: z.boolean(),
});

export const CreateQuestionTagSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const CreateQuestionPayloadSchema = z.object({
  statement: z.string(),
  solution: z.string(),
  imageUrl: z.string().nullable(),
  options: z.array(CreateQuestionOptionSchema),
  childQuestions: z.array(z.unknown()),
  tags: z.array(CreateQuestionTagSchema),
});

export type TCreateQuestionPayload = z.infer<
  typeof CreateQuestionPayloadSchema
>;

// .NET returns the created question's UUID as a plain string
export type TSaveQuestionResponse = { id: string };

export const TOPIC_TAG_NAME = 'test' as const;
export const DIFFICULTY_TAG_NAME = 'difficulty' as const;
export const TYPE_TAG_NAME = 'type' as const;
export const QUESTION_TYPE = 'Mcqs' as const;
