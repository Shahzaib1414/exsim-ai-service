import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseEntityColumns } from './base.schema';

export const questionOptions = pgTable('QuestionOptions', {
  ...baseEntityColumns,
  Option: text('Option').notNull(),
  IsCorrect: boolean('IsCorrect').notNull(),
  Position: integer('Position').notNull(),
  QuestionId: uuid('QuestionId').notNull(),
});
