import { Inject } from '@nestjs/common';
import { eq, SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, TableConfig } from 'drizzle-orm/pg-core';

import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';

/**
 * Public generic constraint: any table that spreads `baseEntityColumns`
 * satisfies this (it guarantees an `Id` column exists).
 *
 * `PgTable<TableConfig>` is used instead of `PgTableWithColumns<TableConfig>`.
 * The latter carries an index signature `[x: string]: PgColumn` (derived from
 * `TableConfig.columns: Record<string, PgColumn>`) that concrete Drizzle table
 * types never satisfy — they expose specific named properties, not a generic
 * index signature. Using `PgTable<TableConfig>` removes that requirement while
 * all results are cast via `as TTable['$inferSelect']` so the return types at
 * every call site remain fully typed.
 */
type TableWithId = PgTable<TableConfig> & { Id: PgColumn };

/**
 * Abstract base for all services that require direct database access.
 *
 * Pass the Drizzle table in `super(db, table)` to unlock the common single-table
 * helpers (`insertOne`, `findById`, `findOne`, `findMany`, `updateWhere`,
 * `updateById`). Multi-table orchestration services can call `super(db)` without
 * a table and use `this.db` directly for custom queries.
 *
 * Audit columns (`Created`, `CreatedBy`, `LastModified`, `LastModifiedBy`) and
 * `Id` are handled automatically by `$defaultFn` / `$onUpdateFn` in the schema
 * definition — no manual spreading required in any service.
 *
 * @example — single-table service
 * ```ts
 * @Injectable()
 * export class OrderService extends BaseService<typeof Orders> {
 *   constructor(@Inject(DRIZZLE_CLIENT) db: DrizzleClient) {
 *     super(db, Orders);
 *   }
 * }
 * ```
 *
 * @example — multi-table orchestration service
 * ```ts
 * @Injectable()
 * export class GeneratorService extends BaseService {
 *   constructor(@Inject(DRIZZLE_CLIENT) db: DrizzleClient, ...) {
 *     super(db);
 *   }
 * }
 * ```
 */
export abstract class BaseService<TTable extends TableWithId = TableWithId> {
  constructor(
    @Inject(DRIZZLE_CLIENT) protected readonly db: DrizzleClient,
    protected readonly table?: TTable,
  ) {}

  private requireTable(): TableWithId {
    if (!this.table) {
      throw new Error(
        `${this.constructor.name} must pass a table to super() to use base helpers`,
      );
    }
    return this.table;
  }

  /**
   * Insert a single row and return the persisted record via `.returning()`.
   * Audit columns and `Id` are set automatically by schema-level `$defaultFn`.
   */
  protected async insertOne(
    values: TTable['$inferInsert'],
  ): Promise<TTable['$inferSelect']> {
    const table = this.requireTable();
    const [row] = await this.db.insert(table).values(values).returning();
    return row as TTable['$inferSelect'];
  }

  /**
   * Fetch a single row by primary key `Id`, or `null` if not found.
   */
  protected async findById(id: string): Promise<TTable['$inferSelect'] | null> {
    const table = this.requireTable();
    const rows = await this.db.select().from(table).where(eq(table.Id, id));
    return (rows[0] as TTable['$inferSelect']) ?? null;
  }

  /**
   * Fetch a single row matching a WHERE condition, or `null` if not found.
   */
  protected async findOne(where: SQL): Promise<TTable['$inferSelect'] | null> {
    const table = this.requireTable();
    const rows = await this.db.select().from(table).where(where).limit(1);
    return (rows[0] as TTable['$inferSelect']) ?? null;
  }

  /**
   * Fetch all rows, optionally filtered by a WHERE condition.
   */
  protected async findMany(where?: SQL): Promise<TTable['$inferSelect'][]> {
    const table = this.requireTable();
    const query = this.db.select().from(table);
    const rows = where ? await query.where(where) : await query;
    return rows as TTable['$inferSelect'][];
  }

  /**
   * Update rows matching a WHERE condition and return the updated records.
   * `LastModified` and `LastModifiedBy` are set automatically by `$onUpdateFn`.
   */
  protected async updateWhere(
    where: SQL,
    values: Partial<TTable['$inferInsert']>,
  ): Promise<TTable['$inferSelect'][]> {
    const table = this.requireTable();
    const rows = await this.db
      .update(table)
      .set(values)
      .where(where)
      .returning();
    return rows as TTable['$inferSelect'][];
  }

  /**
   * Update a single row by `Id` and return the updated record, or `null` if
   * no matching row was found.
   */
  protected async updateById(
    id: string,
    values: Partial<TTable['$inferInsert']>,
  ): Promise<TTable['$inferSelect'] | null> {
    const table = this.requireTable();
    const rows = await this.updateWhere(eq(table.Id, id), values);
    return rows[0] ?? null;
  }

  // ── Multi-table helpers ────────────────────────────────────────────────────
  // For orchestration services that call super(db) without a bound table these
  // methods accept the target table explicitly so audit $defaultFn/$onUpdateFn
  // still fire on every write.

  /**
   * Insert a single row into any table and return the persisted record.
   */
  protected async insertInto<T extends TableWithId>(
    table: T,
    values: T['$inferInsert'],
  ): Promise<T['$inferSelect']> {
    const [row] = await this.db.insert(table).values(values).returning();
    return row as T['$inferSelect'];
  }

  /**
   * Bulk-insert rows into any table and return all persisted records.
   */
  protected async insertManyInto<T extends TableWithId>(
    table: T,
    values: T['$inferInsert'][],
  ): Promise<T['$inferSelect'][]> {
    const rows = await this.db
      .insert(table)
      .values(values as T['$inferInsert'])
      .returning();
    return rows as T['$inferSelect'][];
  }

  /**
   * Update rows in any table matching a WHERE condition and return updated records.
   * `LastModified` and `LastModifiedBy` are set automatically by `$onUpdateFn`.
   */
  protected async updateIn<T extends TableWithId>(
    table: T,
    where: SQL,
    values: Partial<T['$inferInsert']>,
  ): Promise<T['$inferSelect'][]> {
    const rows = await this.db
      .update(table)
      .set(values)
      .where(where)
      .returning();
    return rows as T['$inferSelect'][];
  }
}
