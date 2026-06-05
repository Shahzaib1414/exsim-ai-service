import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { auditColumns } from './base.schema';

/**
 * Read-only Drizzle mapping for the StudentExams table managed by .NET.
 * Do NOT insert/update via this service — use raw SQL for analytics reads only.
 *
 * Source entity: ExsimApi.Domain.Entities.StudentExam
 *
 * Answer logic (from domain):
 *  - MCQ question answered  → AnswerId is set, TextAnswer is null, IsCorrect is true/false
 *  - Open-ended answered    → TextAnswer is set, AnswerId is null, IsCorrect is null (not auto-graded)
 *  - Skipped                → IsSkipped = true, AnswerId null, TextAnswer null, IsCorrect null
 */
export const StudentExams = pgTable('StudentExams', {
  Id: uuid('Id').primaryKey(),
  ...auditColumns,

  ExamId: uuid('ExamId').notNull(),
  UserId: text('UserId').notNull(),
  QuestionId: uuid('QuestionId').notNull(),
  SessionId: uuid('SessionId').notNull(),

  /** Seconds spent on this question (includes time before skipping) */
  TimeTakenInSeconds: integer('TimeTakenInSeconds').notNull().default(0),

  /**
   * null when IsSkipped=true or when TextAnswer is provided (open-ended).
   * true/false only for MCQ answers.
   */
  IsCorrect: boolean('IsCorrect'),

  /** true when the student explicitly skipped without answering */
  IsSkipped: boolean('IsSkipped').notNull().default(false),

  /**
   * Set for MCQ questions — references the selected QuestionOption Id.
   * Mutually exclusive with TextAnswer.
   */
  AnswerId: uuid('AnswerId'),

  /**
   * Set for open-ended/short-answer questions.
   * Mutually exclusive with AnswerId.
   * IsCorrect is always null when this is set.
   */
  TextAnswer: text('TextAnswer'),
});

export type TStudentExamSelect = typeof StudentExams.$inferSelect;
