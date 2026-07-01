import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseEntityColumns } from './base.schema';
import {
  QuestionDifficultySchema,
  QuestionTypeSchema,
} from './question.schema';

// Tag names used by the domain (QuestionTagTypes constants)
export const QUESTION_TAG_NAMES = {
  type: 'type',
  difficulty: 'difficulty',
} as const;

export type TTagName = keyof typeof QUESTION_TAG_NAMES;

// Tag value is either a QuestionType or QuestionDifficulty string
export type TTagValue =
  | (typeof QuestionTypeSchema.options)[number]
  | (typeof QuestionDifficultySchema.options)[number];

export const questionTags = pgTable('QuestionTags', {
  ...baseEntityColumns,
  Name: text('Name').notNull().$type<TTagName>(),
  Value: text('Value').notNull().$type<TTagValue>(),
  QuestionId: uuid('QuestionId').notNull(),
});
