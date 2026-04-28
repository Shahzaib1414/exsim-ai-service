import { initContract } from '@ts-rest/core';

import {
  AiAngelReportSchema,
  GenerateAngelReportBodySchema,
  GetAngelReportParamsSchema,
} from '@/common/types';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/common/types/error-responses.type';

const c = initContract();

export const analyticsContract = c.router(
  {
    generateAngelReport: {
      summary: 'Generate an AI Angel analytics report for a student session',
      method: 'POST',
      path: '/angel',
      body: GenerateAngelReportBodySchema,
      responses: {
        201: AiAngelReportSchema,
        400: BadRequestError,
        500: InternalError,
      },
    },
    getAngelReport: {
      summary: 'Retrieve a cached AI Angel report by session ID',
      method: 'GET',
      path: '/angel/:sessionId',
      pathParams: GetAngelReportParamsSchema,
      responses: {
        200: AiAngelReportSchema,
        404: NotFoundError,
        500: InternalError,
      },
    },
  },
  {
    pathPrefix: '/analytics',
  },
);
