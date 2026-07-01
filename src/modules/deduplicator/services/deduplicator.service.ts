import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { DRIZZLE_CLIENT } from '@/database/database.module';
import { BaseService } from '@/common/services';
import type { DrizzleClient } from '@/db';
import {
  TErrorResult,
  DEDUP_SIMILARITY_THRESHOLD,
  TDuplicateCheckResult,
} from '@/common/types';
import { serializeError, buildSafeVectorLiteral } from '@/utils';

@Injectable()
export class DeduplicatorService extends BaseService {
  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(DeduplicatorService.name)
    private readonly logger: PinoLogger,
  ) {
    super(db);
  }

  async checkUniqueness(
    embedding: number[],
    threshold = DEDUP_SIMILARITY_THRESHOLD,
  ): Promise<Result<TDuplicateCheckResult, TErrorResult>> {
    const vectorResult = buildSafeVectorLiteral(embedding);
    if (vectorResult.isErr()) {
      return err({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: vectorResult.error,
      });
    }
    const vectorLiteral = vectorResult.value;

    try {
      const rows = await this.db.execute(sql`
        SELECT "QuestionId"
        FROM "QuestionEmbeddings"
        WHERE (1 - ("Embedding" <=> ${vectorLiteral}::vector)) >= ${threshold}
        ORDER BY "Embedding" <=> ${vectorLiteral}::vector ASC
        LIMIT 5
      `);

      const similarQuestionIds = rows.rows.map((r) => r.QuestionId as string);

      return ok({
        isUnique: similarQuestionIds.length === 0,
        similarQuestionIds,
      });
    } catch (error) {
      this.logger.error({
        message: 'Failed to check question uniqueness',
        data: { error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to check question uniqueness',
      });
    }
  }
}
