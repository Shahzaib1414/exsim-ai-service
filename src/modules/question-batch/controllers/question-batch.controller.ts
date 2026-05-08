import {
  Controller,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { questionBatchContract } from '@/contracts/question-batch.contract';
import { QuestionBatchService } from '../services/question-batch.service';
import { AuthUserReq, type TAuthUserReq } from '@/common';
import { toErrorResponse } from '@/utils';
import { fileExtensionValidator } from '@/common/validators/file-extension.validator';
import { fileSizeValidator } from '@/common/validators/file-size.validator';
import { createQuestionBatchSchema } from '@/common/types';

@Controller()
export class QuestionBatchController {
  constructor(private readonly questionBatchService: QuestionBatchService) {}

  @TsRestHandler(questionBatchContract.createQuestionBatch)
  @UseInterceptors(FileInterceptor('file'))
  createQuestionBatch(
    @UploadedFile(fileExtensionValidator(true), fileSizeValidator(true))
    file: Express.Multer.File | null,
    @AuthUserReq() user: TAuthUserReq,
  ) {
    return tsRestHandler(
      questionBatchContract.createQuestionBatch,
      async ({ body }) => {
        const parsed = createQuestionBatchSchema.safeParse(body);
        if (!parsed.success) {
          return {
            status: HttpStatus.BAD_REQUEST,
            body: {
              status: HttpStatus.BAD_REQUEST,
              message: HttpStatus[HttpStatus.BAD_REQUEST],
              errors: parsed.error.errors.map((e) => e.message),
            },
          };
        }

        const result = await this.questionBatchService.createQuestionBatch(
          parsed.data,
          user,
          file ?? undefined,
        );
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.CREATED, body: result.value };
      },
    );
  }

  @TsRestHandler(questionBatchContract.listQuestionBatches)
  listQuestionBatches() {
    return tsRestHandler(
      questionBatchContract.listQuestionBatches,
      async ({ query }) => {
        const result =
          await this.questionBatchService.listQuestionBatches(query);
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.OK, body: result.value };
      },
    );
  }

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

  @TsRestHandler(questionBatchContract.approveQuestionBatch)
  approveQuestionBatch(@AuthUserReq() user: TAuthUserReq) {
    return tsRestHandler(
      questionBatchContract.approveQuestionBatch,
      async ({ params }) => {
        const result = await this.questionBatchService.approveQuestionBatch(
          params.id,
          user,
        );
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.OK, body: result.value };
      },
    );
  }

  @TsRestHandler(questionBatchContract.rejectQuestionBatch)
  rejectQuestionBatch() {
    return tsRestHandler(
      questionBatchContract.rejectQuestionBatch,
      async ({ params }) => {
        const result = await this.questionBatchService.rejectQuestionBatch(
          params.id,
        );
        if (result.isErr()) return toErrorResponse(result.error);
        return { status: HttpStatus.NO_CONTENT, body: {} };
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
