import { pgTable, text } from 'drizzle-orm/pg-core';

import { baseEntityColumns } from './base.schema';

export const Categories = pgTable('Categories', {
  ...baseEntityColumns,
  Name: text('Name').notNull(),
  Description: text('Description'),
});

export type TCategoryInsert = typeof Categories.$inferInsert;
export type TCategorySelect = typeof Categories.$inferSelect;
