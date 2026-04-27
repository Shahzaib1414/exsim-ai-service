import { Controller, HttpStatus } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';

import { batchContract } from '@/contracts/batch.contract';
import { BatchService } from '../services/batch.service';

@Controller()
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  @TsRestHandler(batchContract.createBatch)
  createBatch() {
    return tsRestHandler(batchContract.createBatch, async ({ body }) => {
      const result = await this.batchService.createBatch(body);
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
    });
  }

  @TsRestHandler(batchContract.listBatches)
  listBatches() {
    return tsRestHandler(batchContract.listBatches, async () => {
      const result = await this.batchService.listBatches();
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
    });
  }

  @TsRestHandler(batchContract.getBatch)
  getBatch() {
    return tsRestHandler(batchContract.getBatch, async ({ params }) => {
      const result = await this.batchService.getBatch(params.id);
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
    });
  }

  @TsRestHandler(batchContract.getBatchItems)
  getBatchItems() {
    return tsRestHandler(
      batchContract.getBatchItems,
      async ({ params, query }) => {
        const result = await this.batchService.getBatchItems(
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
}
