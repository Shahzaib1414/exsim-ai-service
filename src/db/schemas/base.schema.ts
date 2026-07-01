import { randomUUID } from 'crypto';

import { sql } from 'drizzle-orm';
import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { ClsServiceManager } from 'nestjs-cls';

// $defaultFn / $onUpdateFn require () => string | SQL<unknown> — never null.
// sql`null` is the SQL NULL literal, accepted by Drizzle for nullable columns.
function currentUserIdOrNull(): string | ReturnType<typeof sql> {
  return (
    ClsServiceManager.getClsService()?.get<{ id: string }>('user')?.id ??
    sql`null`
  );
}

// Shared audit columns matching BaseAuditableEntity<Guid>.
// $defaultFn fires automatically on every ORM INSERT (including tx.insert()).
// $onUpdateFn fires automatically on every ORM UPDATE (including tx.update()).
// No manual spreading needed anywhere in the codebase.
export const auditColumns = {
  Created: timestamp('Created')
    .notNull()
    .$defaultFn(() => new Date()),
  CreatedBy: text('CreatedBy').$defaultFn(currentUserIdOrNull),
  LastModified: timestamp('LastModified')
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  LastModifiedBy: text('LastModifiedBy')
    .$defaultFn(currentUserIdOrNull)
    .$onUpdateFn(currentUserIdOrNull),
};

export const baseEntityColumns = {
  Id: uuid('Id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  ...auditColumns,
};
