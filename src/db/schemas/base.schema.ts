import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Shared audit columns matching BaseAuditableEntity<Guid>
export const auditColumns = {
  Created: timestamp('Created').notNull(),
  CreatedBy: text('CreatedBy'),
  LastModified: timestamp('LastModified'),
  LastModifiedBy: text('LastModifiedBy'),
};

export const baseEntityColumns = {
  Id: uuid('Id').primaryKey(),
  ...auditColumns,
};
