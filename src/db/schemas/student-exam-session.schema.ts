import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { auditColumns } from './base.schema';

/**
 * Read-only Drizzle mapping for the StudentExamSessions table managed by .NET.
 * Do NOT insert/update via this service — use raw SQL for analytics reads only.
 *
 * Source entity: ExsimApi.Domain.Entities.StudentExamSession
 */
export const StudentExamSessions = pgTable('StudentExamSessions', {
  Id: uuid('Id').primaryKey(),
  ...auditColumns,

  ExamId: uuid('ExamId').notNull(),
  /** Nullable — student may filter session to a specific topic */
  TopicId: text('TopicId'),
  /** Nullable — student may filter session to a specific section */
  SectionId: uuid('SectionId'),
  /** How many questions the student requested (QuestionCount value object → int) */
  Count: integer('Count').notNull(),
  /** Difficulty level chosen by the student for this session */
  Difficulty: varchar('Difficulty', { length: 20 }).$type<
    'High' | 'Medium' | 'Low'
  >(),
  /** AspNetUsers Id stored as text */
  UserId: text('UserId').notNull(),
  IsCompleted: boolean('IsCompleted').notNull().default(false),
  /** E.g. Practice, Mock, Timed */
  ExamType: varchar('ExamType', { length: 50 }).notNull(),
  /** TypeOfQuestion: e.g. Mcqs, Short, Comprehensive, Grouped, Closed */
  Type: varchar('Type', { length: 50 }).notNull(),
  /** Spaced-repetition recall interval (string enum) */
  RecallInterval: varchar('RecallInterval', { length: 50 }),
  /** Timestamp when the session was started */
  TimeTakenAt: timestamp('TimeTakenAt').notNull(),

  // Pre-computed totals written by the .NET domain when the session completes
  TotalQuestions: integer('TotalQuestions').notNull().default(0),
  CorrectAnswers: integer('CorrectAnswers').notNull().default(0),
  IncorrectAnswers: integer('IncorrectAnswers').notNull().default(0),
  SkippedQuestions: integer('SkippedQuestions').notNull().default(0),
  OverallPercentage: numeric('OverallPercentage', {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default('0'),
});

export type TStudentExamSessionSelect = typeof StudentExamSessions.$inferSelect;
