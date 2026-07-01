import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface ZodIssue {
  path: (string | number)[];
  message: string;
}

interface ZodValidationError {
  response?: {
    headersResult?: {
      name?: string;
      issues?: ZodIssue[];
    };
  };
}

@Injectable()
export class HeaderErrorInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: ZodValidationError) => {
        // Check if this is a ZodError
        if (error?.response?.headersResult?.name === 'ZodError') {
          // Transform the ZodError issues to a string array
          const errors =
            error?.response?.headersResult?.issues?.map(
              (issue) =>
                `${issue?.path?.join('.') ?? ''} ${issue?.message ?? ''}`,
            ) ?? [];

          // Construct the error response according to BadRequestErrorSchema
          const errorResponse = {
            status: HttpStatus.BAD_REQUEST,
            message: HttpStatus[HttpStatus.BAD_REQUEST],
            errors,
          };

          // Throw a new BadRequestException with the formatted errors
          return throwError(() => new BadRequestException(errorResponse));
        }
        // If not a Zod validation error, rethrow the original error
        return throwError(() => error as Error);
      }),
    );
  }
}
