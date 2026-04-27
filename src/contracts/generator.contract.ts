import { initContract } from '@ts-rest/core';

import { GenerateOneSchema, QuestionSchema } from '@/common/types';
import {
  BadRequestError,
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
        201: QuestionSchema,
        400: BadRequestError,
        500: InternalError,
      },
    },
  },
  {
    pathPrefix: '/generator',
  },
);
