import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { DOCUMENT_INGESTION_QUEUE } from '@/queues';
import { TDocumentIngestionJobData } from '@/common/types';
import { EmailTemplate, TSendEmailOptions } from '@/modules/email';
import { GroundingService } from '@/modules/grounding/services/grounding.service';
import { BaseWorker } from './base.worker';

@Processor(DOCUMENT_INGESTION_QUEUE, { concurrency: 2 })
@Injectable()
export class DocumentIngestionWorker extends BaseWorker {
  @Inject(GroundingService)
  private readonly groundingService: GroundingService;

  override async process(job: Job<TDocumentIngestionJobData>): Promise<void> {
    const { fileName, fileBase64, metadata } = job.data;

    void job.log(
      `Processing document ingestion for "${fileName}" (attempt ${job.attemptsMade + 1})`,
    );
    this.logger.info({
      message: 'Processing document ingestion job',
      data: {
        jobId: job.id,
        fileName,
        examType: metadata.examType,
        subject: metadata.subject,
      },
    });

    const buffer = Buffer.from(fileBase64, 'base64');
    const result = await this.groundingService.ingestDocument(
      buffer,
      fileName,
      metadata,
    );

    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    void job.log(
      `Stored ${result.value.chunksStored} page(s) for "${fileName}"`,
    );
    this.logger.info({
      message: 'Document ingestion completed',
      data: {
        jobId: job.id,
        fileName,
        chunksStored: result.value.chunksStored,
      },
    });
  }

  protected override onSuccess(
    job: Job<TDocumentIngestionJobData>,
  ): Promise<TSendEmailOptions | null> {
    const { user, fileName, metadata } = job.data;

    return Promise.resolve({
      to: user.email,
      subject: `Document Ingested — ${fileName}`,
      template: EmailTemplate.DOCUMENT_INGESTION_SUCCESS,
      context: {
        jobId: job.id,
        fileName,
        examType: metadata.examType,
        subject: metadata.subject,
        grade: metadata.grade,
        questionType: metadata.questionType,
        completedAt: new Date().toUTCString(),
        year: new Date().getFullYear(),
      },
    });
  }

  protected override onTerminalFailure(
    job: Job<TDocumentIngestionJobData>,
  ): Promise<TSendEmailOptions | null> {
    const { user, fileName, metadata } = job.data;

    return Promise.resolve({
      to: user.email,
      subject: `Document Ingestion Failed — ${fileName}`,
      template: EmailTemplate.DOCUMENT_INGESTION_FAILURE,
      context: {
        jobId: job.id,
        fileName,
        examType: metadata.examType,
        subject: metadata.subject,
        grade: metadata.grade,
        questionType: metadata.questionType,
        failedAt: new Date().toUTCString(),
        year: new Date().getFullYear(),
      },
    });
  }
}
