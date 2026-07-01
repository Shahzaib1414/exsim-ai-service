import {
  Controller,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { ServerInferRequest } from '@ts-rest/core';

import { groundingContract } from '@/contracts';
import { GroundingService } from '../services/grounding.service';
import { fileExtensionValidator } from '@/common/validators/file-extension.validator';
import { fileSizeValidator } from '@/common/validators/file-size.validator';
import { AuthUserReq, type TAuthUserReq } from '@/common';
import { toErrorResponse } from '@/utils';

type IngestDocument = ServerInferRequest<
  typeof groundingContract.ingestDocument
>;

@Controller()
export class GroundingController {
  constructor(private readonly groundingService: GroundingService) {}

  @TsRestHandler(groundingContract.ingestDocument)
  @UseInterceptors(FileInterceptor('file'))
  ingestDocument(
    @UploadedFile(fileExtensionValidator(), fileSizeValidator())
    file: Express.Multer.File,
    @AuthUserReq() user: TAuthUserReq,
  ) {
    return tsRestHandler(
      groundingContract.ingestDocument,
      async ({ query }: IngestDocument) => {
        if (!file) {
          return {
            status: HttpStatus.BAD_REQUEST,
            body: {
              status: HttpStatus.BAD_REQUEST,
              message: HttpStatus[HttpStatus.BAD_REQUEST],
              errors: ['File is required'],
            },
          };
        }

        const result = await this.groundingService.enqueueIngestionJob(
          file.buffer,
          file.originalname,
          {
            examType: query.examType,
            subject: query.subject,
            grade: query.grade,
            questionType: query.questionType,
          },
          user,
        );

        if (result.isErr()) return toErrorResponse(result.error);

        return {
          status: HttpStatus.ACCEPTED,
          body: {
            jobId: result.value.jobId,
            fileName: file.originalname,
          },
        };
      },
    );
  }
}
