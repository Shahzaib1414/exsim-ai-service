import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';

import { DRIZZLE_CLIENT } from '@/database/database.module';
import { BaseService } from '@/common/services';
import type { DrizzleClient } from '@/db';
import { TErrorResult } from '@/common/types';
import { GroundingEmbeddings } from '@/db/schemas/grounding-embedding.schema';
import { EmbeddingService } from '@/modules/embedding/services/embedding.service';
import { serializeError } from '@/utils';
import { PdfChunkerService } from './pdf-chunker.service';

@Injectable()
export class GroundingService extends BaseService {
  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(GroundingService.name)
    private readonly logger: PinoLogger,
    private readonly pdfChunker: PdfChunkerService,
    private readonly embeddingService: EmbeddingService,
  ) {
    super(db);
  }

  async ingestDocument(
    buffer: Buffer,
    fileName: string,
    subject: string,
    topic: string,
  ): Promise<Result<{ chunksStored: number }, TErrorResult>> {
    // Step 1: Parse and chunk the PDF
    const chunksResult = await this.pdfChunker.parseAndChunk(buffer, fileName);
    if (chunksResult.isErr()) return err(chunksResult.error);
    const chunks = chunksResult.value;

    if (chunks.length === 0) {
      return err({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: 'PDF produced no text content',
      });
    }

    // Step 2: Embed each chunk and collect rows for bulk insert
    const rows: (typeof GroundingEmbeddings.$inferInsert)[] = [];

    for (const chunk of chunks) {
      const embedResult = await this.embeddingService.embedText(chunk.text);
      if (embedResult.isErr()) return err(embedResult.error);

      rows.push({
        Id: randomUUID(),
        ChunkText: chunk.text,
        Embedding: embedResult.value.embedding,
        ModelName: this.embeddingService.modelName,
        SourceDoc: chunk.sourceDoc,
        PageNumber: chunk.pageNumber,
        Subject: subject,
        Topic: topic,
        Created: new Date(),
      });
    }

    // Step 3: Bulk insert all rows in a single query
    try {
      await this.db.insert(GroundingEmbeddings).values(rows);
    } catch (error) {
      this.logger.error({
        message: 'Failed to bulk insert grounding embeddings',
        data: {
          fileName,
          chunksCount: rows.length,
          error: serializeError(error),
        },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to store grounding embeddings',
      });
    }

    return ok({ chunksStored: rows.length });
  }

  async retrieveRelevantChunks(
    queryEmbedding: number[],
    subject: string,
    topic: string,
    topK = 5,
  ): Promise<Result<string[], TErrorResult>> {
    try {
      const vectorLiteral = `[${queryEmbedding.join(',')}]`;

      const result = await this.db.execute(sql`
        SELECT "ChunkText"
        FROM "GroundingEmbeddings"
        WHERE "Subject" = ${subject}
          AND "Topic" = ${topic}
        ORDER BY "Embedding" <=> ${sql.raw(vectorLiteral)}::vector
        LIMIT ${topK}
      `);

      return ok(result.rows.map((r) => r.ChunkText as string));
    } catch (error) {
      this.logger.error({
        message: 'Failed to retrieve grounding chunks',
        data: { subject, topic, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to retrieve grounding chunks',
      });
    }
  }
}
