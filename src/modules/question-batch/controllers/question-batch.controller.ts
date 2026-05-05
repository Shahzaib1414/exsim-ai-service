import { Controller, HttpStatus } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SkipThrottle } from '@nestjs/throttler';

import { questionBatchContract } from '@/contracts/question-batch.contract';
import { QuestionBatchService } from '../services/question-batch.service';
import { AuthUserReq, type TAuthUserReq } from '@/common';

@Controller()
export class QuestionBatchController {
  constructor(private readonly questionBatchService: QuestionBatchService) {}

  @TsRestHandler(questionBatchContract.createQuestionBatch)
  createQuestionBatch(@AuthUserReq() user: TAuthUserReq) {
    return tsRestHandler(
      questionBatchContract.createQuestionBatch,
      async ({ body }) => {
        const result = await this.questionBatchService.createQuestionBatch(
          body,
          user,
        );
        if (result.isErr()) {
          return {
            status: result.error.status as any,
            body: {
              status: result.error.status,
              message: HttpStatus[result.error.status],
              errors: [result.error.message],
            },
          };
        }
        return { status: HttpStatus.CREATED, body: result.value };
      },
    );
  }

  @SkipThrottle()
  @TsRestHandler(questionBatchContract.listQuestionBatches)
  listQuestionBatches() {
    return tsRestHandler(
      questionBatchContract.listQuestionBatches,
      async () => {
        const result = await this.questionBatchService.listQuestionBatches();
        if (result.isErr()) {
          return {
            status: result.error.status as any,
            body: {
              status: result.error.status,
              message: HttpStatus[result.error.status],
              errors: [result.error.message],
            },
          };
        }
        return { status: HttpStatus.OK, body: result.value };
      },
    );
  }

  @SkipThrottle()
  @TsRestHandler(questionBatchContract.getQuestionBatch)
  getBatch() {
    return tsRestHandler(
      questionBatchContract.getQuestionBatch,
      async ({ params }) => {
        const result = await this.questionBatchService.getQuestionBatch(
          params.id,
        );
        if (result.isErr()) {
          return {
            status: result.error.status as any,
            body: {
              status: result.error.status,
              message: HttpStatus[result.error.status],
              errors: [result.error.message],
            },
          };
        }
        return { status: HttpStatus.OK, body: result.value };
      },
    );
  }

  @SkipThrottle()
  @TsRestHandler(questionBatchContract.getQuestionBatchItems)
  getQuestionBatchItems() {
    return tsRestHandler(
      questionBatchContract.getQuestionBatchItems,
      async ({ params, query }) => {
        const result = await this.questionBatchService.getQuestionBatchItems(
          params.id,
          query.status as string | undefined,
        );
        if (result.isErr()) {
          return {
            status: result.error.status as any,
            body: {
              status: result.error.status,
              message: HttpStatus[result.error.status],
              errors: [result.error.message],
            },
          };
        }
        return { status: HttpStatus.OK, body: result.value };
      },
    );
  }

  @TsRestHandler(questionBatchContract.retryDuplicateItem)
  retryDuplicateItem(@AuthUserReq() user: TAuthUserReq) {
    return tsRestHandler(
      questionBatchContract.retryDuplicateItem,
      async ({ params }) => {
        const result = await this.questionBatchService.retryDuplicateItem(
          params.itemId,
          user,
        );
        if (result.isErr()) {
          return {
            status: result.error.status as any,
            body: {
              status: result.error.status,
              message: HttpStatus[result.error.status],
              errors: [result.error.message],
            },
          };
        }
        return { status: HttpStatus.OK, body: result.value };
      },
    );
  }

  @TsRestHandler(questionBatchContract.discardDuplicateItem)
  discardDuplicateItem() {
    return tsRestHandler(
      questionBatchContract.discardDuplicateItem,
      async ({ params }) => {
        const result = await this.questionBatchService.discardDuplicateItem(
          params.itemId,
        );
        if (result.isErr()) {
          return {
            status: result.error.status as any,
            body: {
              status: result.error.status,
              message: HttpStatus[result.error.status],
              errors: [result.error.message],
            },
          };
        }
        return { status: HttpStatus.NO_CONTENT, body: {} };
      },
    );
  }
}
