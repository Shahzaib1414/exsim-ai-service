import { jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { baseEntityColumns } from './base.schema';

export const AiAngelReportStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
]);
export type TAiAngelReportStatus = z.infer<typeof AiAngelReportStatusSchema>;
export const AiAngelReportStatus = AiAngelReportStatusSchema.enum;

export const AIAngelReports = pgTable('AiAngelReports', {
  ...baseEntityColumns,
  UserId: text('UserId').notNull(),
  SessionId: text('SessionId'),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .$type<TAiAngelReportStatus>()
    .default('PENDING'),
  ReportData: jsonb('ReportData'),
  ErrorMessage: text('ErrorMessage'),
});

export type TAIAngelReportInsert = typeof AIAngelReports.$inferInsert;
export type TAIAngelReportSelect = typeof AIAngelReports.$inferSelect;
