import { initContract } from '@ts-rest/core';
import { z } from 'zod';

import {
  batchResponseSchema,
  batchWithItemsResponseSchema,
  createBatchSchema,
  getBatchItemsQuerySchema,
  listBatchesQuerySchema,
} from '@/modules/batch/schemas/batch.schema';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/common/types/error-responses.type';

const c = initContract();

export const batchContract = c.router(
  {
    createBatch: {
      summary: 'Create a batch and enqueue generation jobs',
      method: 'POST',
      path: '/',
      body: createBatchSchema,
      responses: {
        201: batchResponseSchema,
        400: BadRequestError,
        500: InternalError,
      },
    },
    listBatches: {
      summary: 'List all batches',
      method: 'GET',
      path: '/',
      query: listBatchesQuerySchema,
      responses: {
        200: z.array(batchResponseSchema),
        500: InternalError,
      },
    },
    getBatch: {
      summary: 'Get batch progress by ID',
      method: 'GET',
      path: '/:id',
      responses: {
        200: batchResponseSchema,
        404: NotFoundError,
        500: InternalError,
      },
    },
    getBatchItems: {
      summary: 'Get items in a batch, optionally filtered by status',
      method: 'GET',
      path: '/:id/items',
      query: getBatchItemsQuerySchema,
      responses: {
        200: batchWithItemsResponseSchema,
        404: NotFoundError,
        500: InternalError,
      },
    },
  },
  {
    pathPrefix: '/batches',
  },
);
