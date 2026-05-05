import { initContract } from '@ts-rest/core';

import { GenerateOneSchema, GenerateOneResultSchema } from '@/common/types';
import {
  BadRequestError,
  UnprocessableError,
  InternalError,
} from '@/common/types/error-responses.type';

const c = initContract();

export const generatorContract = c.router(
  {
    generateOne: {
      summary: 'Generate a single exam question',
      method: 'POST',
      path: '/one',
      body: GenerateOneSchema,
      responses: {
        201: GenerateOneResultSchema,
        400: BadRequestError,
        422: UnprocessableError,
        500: InternalError,
      },
    },
  },
  {
    pathPrefix: '/generator',
  },
);
