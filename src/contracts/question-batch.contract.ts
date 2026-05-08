import { initContract } from '@ts-rest/core';
import { z } from 'zod';

import {
  questionBatchResponseSchema,
  questionBatchItemResponseSchema,
  questionBatchWithItemsResponseSchema,
  createQuestionBatchSchema,
  getQuestionBatchItemsQuerySchema,
  QuestionBatchesFilterZod,
  QuestionBatchPaginatedResponseSchema,
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
      summary:
        'Create a question batch — generates sample questions first, then awaits review',
      method: 'POST',
      path: '/',
      contentType: 'multipart/form-data',
      body: c.type<
        { file?: File } & z.infer<typeof createQuestionBatchSchema>
      >(),
      responses: {
        201: questionBatchResponseSchema,
        400: BadRequestError,
        409: ConflictError,
        500: InternalError,
      },
    },
    listQuestionBatches: {
      summary: 'List all question batches',
      method: 'GET',
      path: '/',
      query: QuestionBatchesFilterZod,
      responses: {
        200: QuestionBatchPaginatedResponseSchema,
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
    approveQuestionBatch: {
      summary:
        'Approve a PENDING_REVIEW batch — enqueues remainder question generation',
      method: 'POST',
      path: '/:id/approve',
      body: z.object({}),
      responses: {
        200: questionBatchResponseSchema,
        404: NotFoundError,
        409: ConflictError,
        500: InternalError,
      },
    },
    rejectQuestionBatch: {
      summary:
        'Reject a PENDING_REVIEW batch — deletes sample questions, marks batch REJECTED',
      method: 'POST',
      path: '/:id/reject',
      body: z.object({}),
      responses: {
        204: z.object({}),
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
