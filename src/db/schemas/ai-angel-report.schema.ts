import { jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { baseEntityColumns } from './base.schema';

export const AIAngelReports = pgTable(
  'AIAngelReports',
  {
    ...baseEntityColumns,
    UserId: text('UserId').notNull(),
    SessionId: text('SessionId').notNull(),
    Subject: text('Subject').notNull(),
    Topic: text('Topic').notNull(),
    Progress: jsonb('Progress').notNull(),
    Strengths: jsonb('Strengths').notNull(),
    Weaknesses: jsonb('Weaknesses').notNull(),
    CohortComparison: jsonb('CohortComparison').notNull(),
  },
  (t) => [unique('uq_AIAngelReports_SessionId').on(t.SessionId)],
);

export type TAIAngelReportInsert = typeof AIAngelReports.$inferInsert;
export type TAIAngelReportSelect = typeof AIAngelReports.$inferSelect;
