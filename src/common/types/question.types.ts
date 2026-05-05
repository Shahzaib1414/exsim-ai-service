import { z } from 'zod';

import {
  QuestionDifficultySchema,
  QuestionType,
} from '@/db/schemas/question.schema';

// ─── LLM output schemas (one per question type) ───────────────────────────────

export const McqsQuestionSchema = z.object({
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
});

export const ChildQuestionSchema = z.object({
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string(),
});

export const GroupedQuestionSchema = z.object({
  stem: z.string(),
  childQuestions: z.array(ChildQuestionSchema).min(1),
});

export const OpenEndedQuestionSchema = z.object({
  stem: z.string(),
  solution: z.string(),
});

export const QuestionSchema = z.union([
  OpenEndedQuestionSchema,
  GroupedQuestionSchema,
  ChildQuestionSchema,
  McqsQuestionSchema,
]);

// ─── Tagged union (questionType added at call site after generation) ───────────

export type TMcqsQuestion = z.infer<typeof McqsQuestionSchema> & {
  questionType: typeof QuestionType.Mcqs;
};
export type TGroupedQuestion = z.infer<typeof GroupedQuestionSchema> & {
  questionType: typeof QuestionType.Grouped;
};
export type TOpenEndedQuestion = z.infer<typeof OpenEndedQuestionSchema> & {
  questionType:
    | typeof QuestionType.Short
    | typeof QuestionType.Comprehensive
    | typeof QuestionType.Closed;
};

export type TQuestion = TMcqsQuestion | TGroupedQuestion | TOpenEndedQuestion;

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

export type TCreateQuestionPayload = {
  statement: string;
  solution: string;
  imageUrl: string | null;
  options: z.infer<typeof CreateQuestionOptionSchema>[];
  childQuestions: TCreateQuestionPayload[];
  tags: z.infer<typeof CreateQuestionTagSchema>[];
};

export const CreateQuestionPayloadSchema: z.ZodType<TCreateQuestionPayload> =
  z.lazy(() =>
    z.object({
      statement: z.string(),
      solution: z.string(),
      imageUrl: z.string().nullable(),
      options: z.array(CreateQuestionOptionSchema),
      childQuestions: z.array(CreateQuestionPayloadSchema),
      tags: z.array(CreateQuestionTagSchema),
    }),
  );

// .NET returns the created question's UUID as a plain string
export type TSaveQuestionResponse = { id: string };

export const TOPIC_TAG_NAME = 'test' as const;
export const DIFFICULTY_TAG_NAME = 'difficulty' as const;
export const TYPE_TAG_NAME = 'type' as const;
