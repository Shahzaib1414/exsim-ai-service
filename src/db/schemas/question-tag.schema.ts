import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseEntityColumns } from './base.schema';
import {
  questionDifficultySchema,
  questionTypeSchema,
} from '../../shared/schemas';

// Tag names used by the domain (QuestionTagTypes constants)
export const QUESTION_TAG_NAMES = {
  type: 'type',
  difficulty: 'difficulty',
} as const;

export type TTagName = keyof typeof QUESTION_TAG_NAMES;

// Tag value is either a QuestionType or QuestionDifficulty string
export type TTagValue =
  | (typeof questionTypeSchema.options)[number]
  | (typeof questionDifficultySchema.options)[number];

export const questionTags = pgTable('QuestionTags', {
  ...baseEntityColumns,
  Name: text('Name').notNull().$type<TTagName>(),
  Value: text('Value').notNull().$type<TTagValue>(),
  QuestionId: uuid('QuestionId').notNull(),
});
