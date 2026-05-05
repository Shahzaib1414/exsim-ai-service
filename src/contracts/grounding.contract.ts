import { initContract } from '@ts-rest/core';

import {
  IngestDocumentQueryParamsSchema,
  IngestDocumentResponseSchema,
} from '@/common/types';
import {
  BadRequestError,
  InternalError,
  UnprocessableError,
} from '@/common/types/error-responses.type';

const c = initContract();

export const groundingContract = c.router(
  {
    ingestDocument: {
      summary: 'Upload a PDF and store its embedded chunks for grounding',
      method: 'POST',
      path: '/ingest',
      contentType: 'multipart/form-data',
      query: IngestDocumentQueryParamsSchema,
      body: c.type<{ file: File }>(),
      responses: {
        202: IngestDocumentResponseSchema,
        400: BadRequestError,
        422: UnprocessableError,
        500: InternalError,
      },
    },
  },
  {
    pathPrefix: '/grounding',
  },
);
