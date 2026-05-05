import { Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { QUESTION_BATCH_ITEM_QUEUE } from '@/queues';
import { TQuestionBatchItemJobData } from '@/common/types';
import { GeneratorService } from '@/modules/generator/services/generator.service';
import { QuestionBatchService } from '@/modules/question-batch/services/question-batch.service';
import { QuestionService } from '@/modules/question/services/question.service';
import { AppInsightsMetricsService } from '@/common/services';
import { LangfuseService } from '@/common/services/langfuse.service';
import { EmailTemplate } from '@/modules/email';
import { serializeError } from '@/utils';
import { BaseWorker } from './base.worker';
import { QuestionBatchItemStatus, QuestionBatchStatus } from '@/db';

@Processor(QUESTION_BATCH_ITEM_QUEUE, { concurrency: 5 })
@Injectable()
export class QuestionBatchWorker extends BaseWorker {
  override async process(job: Job<TQuestionBatchItemJobData>): Promise<void> {
    const generatorService = this.resolve(GeneratorService);
    const questionBatchService = this.resolve(QuestionBatchService);
    const metricsService = this.resolve(AppInsightsMetricsService);
    const langfuseService = this.resolve(LangfuseService);
    const questionService = this.resolve(QuestionService);

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
        await questionBatchService.getItem(questionBatchItemId);
      if (itemResult.isErr()) {
        throw new Error(itemResult.error.message);
      }

      if (itemResult.value.Status === QuestionBatchItemStatus.COMPLETED) {
        this.logger.info({
          message: 'Skipping already-generated item',
          data: { questionBatchItemId },
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

      const trace = langfuseService.client.trace({
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
        await questionService.getQuestionTexts(negativeExampleIds);

      const result = await generatorService.generateOne({
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
        await questionBatchService.markItemCompleted(
          questionBatchItemId,
          value.questionId,
          value.usage,
        );
        metricsService.trackBatchItemSuccess(questionBatchId);
        metricsService.trackLlmTokenUsage('generator', value.usage);
      } else {
        trace.update({ output: { error: result.error.message } });
        await questionBatchService.markItemFailed(
          questionBatchItemId,
          result.error.message,
        );
        metricsService.trackBatchItemFailure(
          questionBatchId,
          result.error.message,
        );
        throw new Error(result.error.message);
      }

      await questionBatchService.updateQuestionBatchStatus(questionBatchId);

      const batchResult =
        await questionBatchService.getQuestionBatch(questionBatchId);
      if (batchResult.isOk()) {
        const batch = batchResult.value;
        const isTerminal =
          batch.status === QuestionBatchStatus.COMPLETED ||
          batch.status === QuestionBatchStatus.FAILED;

        if (isTerminal) {
          const isSuccess = batch.status === QuestionBatchStatus.COMPLETED;
          const completedAt = new Date().toUTCString();

          void this.emailService.send({
            to: job.data.user.email, // LOGGED-IN user email
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
              completedAt,
              year: new Date().getFullYear(),
            },
          });
        }
      }

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
}
