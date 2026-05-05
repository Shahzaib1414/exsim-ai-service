import { Controller, HttpStatus } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { SkipThrottle } from '@nestjs/throttler';

import { questionBatchContract } from '@/contracts/question-batch.contract';
import { QuestionBatchService } from '../services/question-batch.service';
import { AuthUserReq, type TAuthUserReq } from '@/common';
import { toErrorResponse } from '@/utils';

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
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.CREATED, body: result.value };
      },
    );
  }

  @SkipThrottle()
  @TsRestHandler(questionBatchContract.listQuestionBatches)
  listQuestionBatches() {
    return tsRestHandler(
      questionBatchContract.listQuestionBatches,
      async ({ query }) => {
        const result = await this.questionBatchService.listQuestionBatches(
          query.page,
          query.limit,
        );
        if (result.isErr()) return toErrorResponse(result.error);
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
        if (result.isErr()) return toErrorResponse(result.error);
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
          query.status,
        );
        if (result.isErr()) return toErrorResponse(result.error);
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
        if (result.isErr()) return toErrorResponse(result.error);
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
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.NO_CONTENT, body: {} };
      },
    );
  }
}
