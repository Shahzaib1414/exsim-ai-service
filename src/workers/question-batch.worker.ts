import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { QUESTION_BATCH_ITEM_QUEUE } from '@/queues';
import { TQuestionBatchItemJobData } from '@/common/types';
import { AppInsightsMetricsService } from '@/common/services/app-insights-metrics.service';
import { LangfuseService } from '@/common/services/langfuse.service';
import { EmailTemplate, TSendEmailOptions } from '@/modules/email';
import { GeneratorService } from '@/modules/generator/services/generator.service';
import { QuestionBatchService } from '@/modules/question-batch/services/question-batch.service';
import { QuestionService } from '@/modules/question/services/question.service';
import { serializeError } from '@/utils';
import { QuestionBatchItemStatus, QuestionBatchStatus } from '@/db';
import { BaseWorker } from './base.worker';

@Processor(QUESTION_BATCH_ITEM_QUEUE, { concurrency: 5 })
@Injectable()
export class QuestionBatchWorker extends BaseWorker {
  @Inject(QuestionBatchService)
  private readonly questionBatchService: QuestionBatchService;
  @Inject(GeneratorService)
  private readonly generatorService: GeneratorService;
  @Inject(QuestionService)
  private readonly questionService: QuestionService;
  @Inject(AppInsightsMetricsService)
  private readonly metricsService: AppInsightsMetricsService;
  @Inject(LangfuseService)
  private readonly langfuseService: LangfuseService;

  override async process(job: Job<TQuestionBatchItemJobData>): Promise<void> {
    const {
      questionBatchItemId,
      questionBatchId,
      examType,
      subject,
      topic,
      difficulty,
      grade,
      questionType,
      negativeExampleIds = [],
    } = job.data;
    const logContext = {
      queueName: job.queueName,
      jobId: job.id,
      jobName: job.name,
      data: job.data,
    };

    try {
      const itemResult =
        await this.questionBatchService.getItem(questionBatchItemId);
      if (itemResult.isErr()) {
        this.logger.error({
          message: 'Batch item not found; skipping job',
          data: { questionBatchItemId, error: itemResult.error.message },
        });
        return;
      }

      const { Status: itemStatus } = itemResult.value;
      if (
        itemStatus === QuestionBatchItemStatus.COMPLETED ||
        itemStatus === QuestionBatchItemStatus.FAILED
      ) {
        this.logger.info({
          message: 'Skipping already-processed item',
          data: { questionBatchItemId, status: itemStatus },
        });
        return;
      }

      void job.log(
        `Processing batch item ${questionBatchItemId} (attempt ${job.attemptsMade + 1})`,
      );
      this.logger.info({
        message: 'Processing question batch item',
        data: {
          ...logContext,
          questionBatchItemId,
          questionBatchId,
          examType,
          subject,
          topic,
          difficulty,
        },
      });

      const trace = this.langfuseService.client.trace({
        id: questionBatchItemId,
        name: 'question-batch-item',
        metadata: {
          questionBatchId,
          examType,
          subject,
          topic,
          difficulty,
          grade,
          questionType,
        },
      });

      const negativeExamples =
        await this.questionService.getQuestionTexts(negativeExampleIds);

      const result = await this.generatorService.generateOne({
        examType,
        subject,
        topic,
        difficulty,
        grade,
        questionType,
        negativeExamples,
        trace,
      });

      if (result.isOk()) {
        const value = result.value;
        trace.update({ output: { questionId: value.questionId } });
        await this.questionBatchService.markItemCompleted(
          questionBatchItemId,
          value.questionId,
          value.usage,
        );
        this.metricsService.trackBatchItemSuccess(questionBatchId);
        this.metricsService.trackLlmTokenUsage('generator', value.usage);
      } else {
        trace.update({ output: { error: result.error.message } });
        await this.questionBatchService.markItemFailed(
          questionBatchItemId,
          result.error.message,
        );
        this.metricsService.trackBatchItemFailure(
          questionBatchId,
          result.error.message,
        );
        throw new Error(result.error.message);
      }

      await this.questionBatchService.updateQuestionBatchStatus(
        questionBatchId,
      );

      void job.log(
        `Successfully processed question batch item ${questionBatchItemId}`,
      );
      this.logger.info({
        message: 'Question Batch item processed successfully',
        data: logContext,
      });
    } catch (error) {
      this.logger.error({
        message: 'Error processing question batch item',
        data: logContext,
        error: serializeError(error),
      });
      throw error;
    }
  }

  protected override async onSuccess(
    job: Job<TQuestionBatchItemJobData>,
  ): Promise<TSendEmailOptions | null> {
    const { questionBatchId } = job.data;

    const batchResult =
      await this.questionBatchService.getQuestionBatch(questionBatchId);
    if (batchResult.isErr()) return null;

    const batch = batchResult.value;
    const isTerminal =
      batch.status === QuestionBatchStatus.COMPLETED ||
      batch.status === QuestionBatchStatus.FAILED;
    if (!isTerminal) return null;

    const isSuccess = batch.status === QuestionBatchStatus.COMPLETED;

    return {
      to: job.data.user.email,
      subject: isSuccess
        ? `✓ Question Batch Completed — ${batch.metadata.subject} / ${batch.metadata.topic}`
        : `✗ Question Batch Failed — ${batch.metadata.subject} / ${batch.metadata.topic}`,
      template: isSuccess
        ? EmailTemplate.QUESTION_BATCH_SUCCESS
        : EmailTemplate.QUESTION_BATCH_FAILURE,
      context: {
        batchId: questionBatchId,
        examType: batch.metadata.examType,
        subject: batch.metadata.subject,
        topic: batch.metadata.topic,
        difficulty: batch.metadata.difficulty,
        questionType: batch.metadata.questionType,
        requestedCount: batch.requestedCount,
        completedCount: batch.completedCount,
        failedCount: batch.failedCount,
        estimatedCostUsd: batch.estimatedCostUsd,
        completedAt: new Date().toUTCString(),
        year: new Date().getFullYear(),
      },
    };
  }
}
