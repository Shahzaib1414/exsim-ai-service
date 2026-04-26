import { Inject } from '@nestjs/common';
import { eq, SQL } from 'drizzle-orm';
import type {
  PgColumn,
  PgTableWithColumns,
  TableConfig,
} from 'drizzle-orm/pg-core';

import { DRIZZLE_CLIENT } from '@/database/database.module';
import type { DrizzleClient } from '@/db';

/**
 * Public generic constraint: any table that spreads `baseEntityColumns`
 * satisfies this (it guarantees an `Id` column exists).
 *
 * Using `PgTableWithColumns<TableConfig>` (not the narrower `PgTable<TableConfig>`)
 * so TypeScript can fully evaluate Drizzle's internal `TableLikeHasEmptySelection`
 * conditional in every query-builder overload. With only `PgTable` the conditional
 * stays unresolved on generic `TTable` and produces a type error at every call site.
 */
type TableWithId = PgTableWithColumns<TableConfig> & { Id: PgColumn };

/**
 * Abstract base for all services that require direct database access.
 *
 * Pass the Drizzle table in `super(db, table)` to unlock the common single-table
 * helpers (`insertOne`, `findById`, `findOne`, `findMany`, `updateWhere`,
 * `updateById`). Multi-table orchestration services can call `super(db)` without
 * a table and use `this.db` directly for custom queries.
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

  /**
   * Returns the table widened to the concrete `TableWithId` type so Drizzle's
   * query builders can fully evaluate `TableLikeHasEmptySelection`. This is a
   * safe widening — `TTable extends TableWithId` — so no type assertion is needed.
   */
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
   */
  protected async insertOne(
    values: TTable['$inferInsert'],
  ): Promise<TTable['$inferSelect']> {
    const table = this.requireTable();
    const [row] = await this.db.insert(table).values(values).returning();
    return row as TTable['$inferSelect'];
  }

  /**
   * Fetch a single row by primary key `Id` column, or `null` if not found.
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
}
