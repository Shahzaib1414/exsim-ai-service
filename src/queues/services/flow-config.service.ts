import { Injectable } from '@nestjs/common';

import {
  DOCUMENT_INGESTION_QUEUE,
  PROCESS_DOCUMENT_INGESTION_JOB,
  PROCESS_QUESTION_BATCH_ITEM_JOB,
  QUESTION_BATCH_ITEM_QUEUE,
  QUESTION_BATCH_SAMPLE_COMPLETE_QUEUE,
  PROCESS_QUESTION_BATCH_SAMPLE_COMPLETE_JOB,
} from '../queue.constants';
import {
  createMediumFrequencyJobOptions,
  createLowFrequencyJobOptions,
} from '@/utils/queue-options.util';
import type { FlowJob } from '../types/flow.types';
import type { TAuthUserReq } from '@/common/types';
import type {
  TQuestionBatchMetadata,
  TQuestionBatchItemJobData,
  TQuestionBatchSampleCompleteJobData,
} from '@/common/types/question-batch.types';
import type { TDocumentIngestionJobData } from '@/common/types/grounding.types';
import type { TQuestionBatchItemSelect } from '@/db/schemas/question-batch-item.schema';

/**
 * Central service for building BullMQ FlowJob configs.
 *
 * Add a new method here whenever a new flow type is introduced — one place,
 * zero duplication. This service only constructs data structures; it never
 * enqueues anything. Hand the returned FlowJob to BatchFlowService.add().
 */
@Injectable()
export class FlowConfigService {
  /**
   * Builds the sample-phase flow for a question batch.
   *
   * Children:
   *  - (optional) document-ingestion job — runs concurrently with sample items
   *  - N sample question-batch-item jobs
   *
   * Parent runs after all children complete (BullMQ flow semantics).
   */
  buildSamplePhaseFlow(args: {
    batchId: string;
    user: TAuthUserReq;
    sampleItems: TQuestionBatchItemSelect[];
    metadata: TQuestionBatchMetadata;
    file?: Express.Multer.File;
  }): FlowJob {
    const { batchId, user, sampleItems, metadata, file } = args;
    const batchItemsChildren = sampleItems.map((item) =>
      this.batchItemChild(item, batchId, metadata, user),
    );

    return {
      name: PROCESS_QUESTION_BATCH_SAMPLE_COMPLETE_JOB,
      queueName: QUESTION_BATCH_SAMPLE_COMPLETE_QUEUE,
      data: { batchId, user } satisfies TQuestionBatchSampleCompleteJobData,
      children: [
        ...(file
          ? [this.docIngestionChild(file, metadata, user, batchItemsChildren)]
          : batchItemsChildren),
      ],
      opts: createLowFrequencyJobOptions(),
    };
  }

  private docIngestionChild(
    file: Express.Multer.File,
    metadata: TQuestionBatchMetadata,
    user: TAuthUserReq,
    children: FlowJob[],
  ): FlowJob {
    return {
      name: PROCESS_DOCUMENT_INGESTION_JOB,
      queueName: DOCUMENT_INGESTION_QUEUE,
      data: {
        user,
        fileBase64: file.buffer.toString('base64'),
        fileName: file.originalname,
        metadata: {
          examType: metadata.examType,
          subject: metadata.subject,
          grade: metadata.grade,
          questionType: metadata.questionType,
        },
      } satisfies TDocumentIngestionJobData,
      children,
      opts: {
        ...createMediumFrequencyJobOptions(),
        ignoreDependencyOnFailure: true,
      },
    };
  }

  private batchItemChild(
    item: TQuestionBatchItemSelect,
    batchId: string,
    metadata: TQuestionBatchMetadata,
    user: TAuthUserReq,
  ): FlowJob {
    return {
      name: PROCESS_QUESTION_BATCH_ITEM_JOB,
      queueName: QUESTION_BATCH_ITEM_QUEUE,
      data: {
        questionBatchItemId: item.Id,
        questionBatchId: batchId,
        examType: metadata.examType,
        subject: metadata.subject,
        topic: metadata.topic,
        difficulty: metadata.difficulty,
        grade: metadata.grade,
        questionType: metadata.questionType,
        user,
      } satisfies TQuestionBatchItemJobData,
      opts: {
        ...createMediumFrequencyJobOptions(item.Id),
        ignoreDependencyOnFailure: true,
      },
    };
  }
}
