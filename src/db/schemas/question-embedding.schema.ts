import { index, pgTable, text, uuid, vector } from 'drizzle-orm/pg-core';

import { baseEntityColumns } from './base.schema';

export const QuestionEmbeddings = pgTable(
  'QuestionEmbeddings',
  {
    ...baseEntityColumns,
    QuestionId: uuid('QuestionId').notNull().unique(),
    Embedding: vector('Embedding', { dimensions: 1536 }).notNull(),
    ModelName: text('ModelName').notNull(),
  },
  (table) => [
    // IVFFlat index for cosine similarity search.
    // lists=100 is appropriate up to ~100k rows; re-tune or switch to HNSW at larger scale.
    index('idx_QuestionEmbeddings_Embedding')
      .using('ivfflat', table.Embedding.op('vector_cosine_ops'))
      .with({ lists: 100 }),
  ],
);

export type TQuestionEmbeddingInsert = typeof QuestionEmbeddings.$inferInsert;
export type TQuestionEmbeddingSelect = typeof QuestionEmbeddings.$inferSelect;
