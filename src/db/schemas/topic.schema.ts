import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { baseEntityColumns } from './base.schema';
import { Categories } from './category.schema';

export const Topics = pgTable('Topics', {
  ...baseEntityColumns,
  Name: text('Name').notNull(),
  Description: text('Description'),
  CategoryId: uuid('CategoryId')
    .notNull()
    .references(() => Categories.Id),
});

export type TTopicInsert = typeof Topics.$inferInsert;
export type TTopicSelect = typeof Topics.$inferSelect;
