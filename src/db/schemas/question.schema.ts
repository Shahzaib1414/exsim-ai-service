import { pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { baseEntityColumns } from './base.schema';
import { questionStatusSchema } from '../../shared/schemas';

export const questions = pgTable('Questions', {
  ...baseEntityColumns,
  Statement: text('Statement').notNull(),
  Solution: text('Solution').notNull(),
  ImageUrl: text('ImageUrl'),
  TopicId: uuid('TopicId').notNull(),
  ParentQuestionId: uuid('ParentQuestionId'),
  Status: varchar('Status', { length: 20 })
    .notNull()
    .$type<(typeof questionStatusSchema.options)[number]>(),
});
