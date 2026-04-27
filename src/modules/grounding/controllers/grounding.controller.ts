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

        const result = await this.groundingService.ingestDocument(
          file.buffer,
          file.originalname,
          query.subject,
          query.topic,
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

        return {
          status: HttpStatus.CREATED,
          body: {
            chunksStored: result.value.chunksStored,
            fileName: file.originalname,
          },
        };
      },
    );
  }
}
