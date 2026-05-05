import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { DRIZZLE_CLIENT } from '@/database/database.module';
import { BaseService } from '@/common/services';
import type { DrizzleClient } from '@/db';
import {
  TErrorResult,
  TGroundingMetadata,
  TDocumentIngestionJobData,
  TAuthUserReq,
} from '@/common/types';
import { GroundingEmbeddings } from '@/db/schemas/grounding-embedding.schema';
import { EmbeddingService } from '@/modules/embedding/services/embedding.service';
import { serializeError, buildSafeVectorLiteral } from '@/utils';
import {
  PROCESS_DOCUMENT_INGESTION_JOB,
  InjectDocumentIngestionQueue,
  createMediumFrequencyJobOptions,
} from '@/queues';
import { PdfChunkerService } from './pdf-chunker.service';

@Injectable()
export class GroundingService extends BaseService {
  constructor(
    @Inject(DRIZZLE_CLIENT) db: DrizzleClient,
    @InjectPinoLogger(GroundingService.name)
    private readonly logger: PinoLogger,
    private readonly pdfChunker: PdfChunkerService,
    private readonly embeddingService: EmbeddingService,
    @InjectDocumentIngestionQueue()
    private readonly documentIngestionQueue: Queue,
  ) {
    super(db);
  }

  async enqueueIngestionJob(
    buffer: Buffer,
    fileName: string,
    metadata: TGroundingMetadata,
    user: TAuthUserReq,
  ): Promise<Result<{ jobId: string }, TErrorResult>> {
    try {
      const job = await this.documentIngestionQueue.add(
        PROCESS_DOCUMENT_INGESTION_JOB,
        {
          user,
          fileBase64: buffer.toString('base64'),
          fileName,
          metadata,
        } satisfies TDocumentIngestionJobData,
        createMediumFrequencyJobOptions(),
      );

      return ok({ jobId: job.id! });
    } catch (error) {
      this.logger.error({
        message: 'Failed to enqueue document ingestion job',
        data: { fileName, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Failed to enqueue document ingestion job',
      });
    }
  }

  async ingestDocument(
    buffer: Buffer,
    fileName: string,
    metadata: TGroundingMetadata,
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
        ChunkText: chunk.text,
        Embedding: embedResult.value.embedding,
        ModelName: this.embeddingService.modelName,
        SourceDoc: chunk.sourceDoc,
        PageNumber: chunk.pageNumber,
        Metadata: metadata,
      });
    }

    // Step 3: Bulk insert all rows in a single query
    try {
      await this.insertManyInto(GroundingEmbeddings, rows);
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
    metadata: TGroundingMetadata,
    topK = 5,
  ): Promise<Result<string[], TErrorResult>> {
    const { examType, subject, grade } = metadata;

    const vectorResult = buildSafeVectorLiteral(queryEmbedding);
    if (vectorResult.isErr()) {
      return err({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        message: vectorResult.error,
      });
    }
    const vectorLiteral = vectorResult.value;

    try {
      const result = await this.db.execute(sql`
        SELECT "ChunkText"
        FROM "GroundingEmbeddings"
        WHERE "Metadata"->>'examType' = ${examType}
          AND "Metadata"->>'subject' = ${subject}
          AND ("Metadata"->>'grade')::int = ${grade}
        ORDER BY "Embedding" <=> ${vectorLiteral}::vector
        LIMIT ${topK}
      `);

      return ok(result.rows.map((r) => r.ChunkText as string));
    } catch (error) {
      this.logger.error({
        message: 'Failed to retrieve grounding chunks',
        data: { subject, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to retrieve grounding chunks',
      });
    }
  }
}
