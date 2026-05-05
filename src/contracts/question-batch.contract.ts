import { initContract } from '@ts-rest/core';
import { z } from 'zod';

import {
  questionBatchResponseSchema,
  questionBatchItemResponseSchema,
  questionBatchWithItemsResponseSchema,
  createQuestionBatchSchema,
  getQuestionBatchItemsQuerySchema,
  listQuestionBatchesQuerySchema,
  sampleQuestionBatchSchema,
} from '@/common/types';
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from '@/common/types/error-responses.type';

const c = initContract();

export const questionBatchContract = c.router(
  {
    createQuestionBatch: {
      summary: 'Create a question batch and enqueue generation jobs',
      method: 'POST',
      path: '/',
      body: createQuestionBatchSchema,
      responses: {
        201: questionBatchResponseSchema,
        400: BadRequestError,
        500: InternalError,
      },
    },
    listQuestionBatches: {
      summary: 'List all question batches',
      method: 'GET',
      path: '/',
      query: listQuestionBatchesQuerySchema,
      responses: {
        200: z.array(questionBatchResponseSchema),
        500: InternalError,
      },
    },
    getQuestionBatch: {
      summary: 'Get batch progress by ID',
      method: 'GET',
      path: '/:id',
      responses: {
        200: questionBatchResponseSchema,
        404: NotFoundError,
        500: InternalError,
      },
    },
    getQuestionBatchItems: {
      summary: 'Get items in a question batch, optionally filtered by status',
      method: 'GET',
      path: '/:id/items',
      query: getQuestionBatchItemsQuerySchema,
      responses: {
        200: questionBatchWithItemsResponseSchema,
        404: NotFoundError,
        500: InternalError,
      },
    },
    sampleQuestionBatch: {
      summary:
        'Enqueue a sample subset of items before committing the full question batch',
      method: 'POST',
      path: '/:id/sample',
      body: sampleQuestionBatchSchema,
      responses: {
        200: questionBatchResponseSchema,
        404: NotFoundError,
        409: ConflictError,
        500: InternalError,
      },
    },
    retryDuplicateItem: {
      summary:
        'Re-enqueue a duplicate item with its similar question IDs as negative examples',
      method: 'POST',
      path: '/items/:itemId/retry',
      body: z.object({}),
      responses: {
        200: questionBatchItemResponseSchema,
        404: NotFoundError,
        409: ConflictError,
        500: InternalError,
      },
    },
    discardDuplicateItem: {
      summary: 'Delete the duplicate question and its batch item',
      method: 'DELETE',
      path: '/items/:itemId',
      body: z.object({}),
      responses: {
        204: z.object({}),
        404: NotFoundError,
        409: ConflictError,
        500: InternalError,
      },
    },
  },
  {
    pathPrefix: '/question-batches',
  },
);
