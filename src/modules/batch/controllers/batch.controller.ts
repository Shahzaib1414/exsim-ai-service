import { Controller, HttpStatus } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Throttle, SkipThrottle } from '@nestjs/throttler';

import { batchContract } from '@/contracts/batch.contract';
import { BatchService } from '../services/batch.service';

@Controller()
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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

  @SkipThrottle()
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

  @SkipThrottle()
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

  @SkipThrottle()
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
