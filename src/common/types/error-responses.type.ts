import { z } from 'zod';
import { extendZodWithOpenApi } from '@anatine/zod-openapi';
extendZodWithOpenApi(z);

export const BadRequestError = z.object({
  status: z.number().openapi({
    example: '400',
  }),
  message: z.string().openapi({
    example: 'BAD_REQUEST',
  }),
  errors: z.array(z.string()).openapi({
    example: ['invalid email'],
  }),
});

export const UnauthorizedError = z.object({
  status: z.number().openapi({
    example: '401',
  }),
  message: z.string().openapi({
    example: 'UNAUTHORIZED',
  }),
  errors: z.array(z.string()).openapi({
    example: ['unauthorized'],
  }),
});

export const ForbiddenError = z.object({
  status: z.number().openapi({
    example: '403',
  }),
  message: z.string().openapi({
    example: 'FORBIDDEN',
  }),
  errors: z.array(z.string()).openapi({
    example: ['forbidden resource'],
  }),
});

export const NotFoundError = z.object({
  status: z.number().openapi({
    example: '404',
  }),
  message: z.string().openapi({
    example: 'NOT_FOUND',
  }),
  errors: z.array(z.string()).openapi({
    example: ['User not found'],
  }),
});

export const ConflictError = z.object({
  status: z.number().openapi({
    example: '409',
  }),
  message: z.string().openapi({
    example: 'CONFLICT',
  }),
  errors: z.array(z.string()).openapi({
    example: ['resource conflicted'],
  }),
});

export const PreconditionFailedError = z.object({
  status: z.number().openapi({
    example: '412',
  }),
  message: z.string().openapi({
    example: 'PRECONDITION_FAILED',
  }),
  errors: z.array(z.string()).openapi({
    example: ['precondition failed'],
  }),
});

export const UnprocessableError = z.object({
  status: z.number().openapi({
    example: '422',
  }),
  message: z.string().openapi({
    example: 'UNPROCESSABLE_ENTITY',
  }),
  errors: z.array(z.string()).openapi({
    example: ['file is required'],
  }),
});

export const InternalError = z.object({
  status: z.number().openapi({
    example: '500',
  }),
  message: z.string().openapi({
    example: 'INTERNAL_SERVER_ERROR',
  }),
  errors: z.array(z.string()).openapi({
    example: ['error occurred'],
  }),
});

export const NotImplementedError = z.object({
  status: z.number().openapi({
    example: '501',
  }),
  message: z.string().openapi({
    example: 'NOT_IMPLEMENTED',
  }),
  errors: z.array(z.string()).openapi({
    example: ['not implemented'],
  }),
});

export const BadGateWayError = z.object({
  status: z.number().openapi({
    example: '502',
  }),
  message: z.string().openapi({
    example: 'BAD_GATEWAY',
  }),
  errors: z.array(z.string()).openapi({
    example: ['bad gateway'],
  }),
});

export const ServiceUnavailableError = z.object({
  status: z.number().openapi({
    example: '503',
  }),
  message: z.string().openapi({
    example: 'SERVICE_UNAVAILABLE',
  }),
  errors: z.array(z.string()).openapi({
    example: ['service unavailable'],
  }),
});
