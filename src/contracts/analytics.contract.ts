import { initContract } from '@ts-rest/core';

import {
  AiAngelReportResponseSchema,
  GetAngelReportParamsSchema,
  RequestAngelReportResponseSchema,
} from '@/common/types';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '@/common/types/error-responses.type';

const c = initContract();

export const analyticsContract = c.router(
  {
    requestAngelReport: {
      summary:
        'Request an async AI Angel analytics report for the latest completed session',
      method: 'POST',
      path: '/reports',
      body: c.noBody(),
      responses: {
        201: RequestAngelReportResponseSchema,
        409: ConflictError,
        404: NotFoundError,
        500: InternalError,
      },
    },
    getAngelReport: {
      summary: 'Get an AI Angel analytics report by ID',
      method: 'GET',
      path: '/reports/:sessionId',
      pathParams: GetAngelReportParamsSchema,
      responses: {
        200: AiAngelReportResponseSchema,
        404: NotFoundError,
        403: ForbiddenError,
        500: InternalError,
      },
    },
  },
  {
    pathPrefix: '/analytics',
  },
);
