import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  vector,
} from 'drizzle-orm/pg-core';

import { baseEntityColumns } from './base.schema';

export const GroundingEmbeddings = pgTable(
  'GroundingEmbeddings',
  {
    ...baseEntityColumns,
    ChunkText: text('ChunkText').notNull(),
    Embedding: vector('Embedding', { dimensions: 1536 }).notNull(),
    ModelName: text('ModelName').notNull(),
    SourceDoc: text('SourceDoc').notNull(),
    PageNumber: integer('PageNumber'),
    Subject: text('Subject'),
    Topic: text('Topic'),
    Metadata: jsonb('Metadata'),
  },
  (table) => [
    index('idx_GroundingEmbeddings_Embedding')
      .using('ivfflat', table.Embedding.op('vector_cosine_ops'))
      .with({ lists: 100 }),
  ],
);

export type TGroundingEmbeddingInsert = typeof GroundingEmbeddings.$inferInsert;
export type TGroundingEmbeddingSelect = typeof GroundingEmbeddings.$inferSelect;
