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
    bodyResult?: {
      name?: string;
      issues?: ZodIssue[];
    };
  };
}

@Injectable()
export class ValidationErrorInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: ZodValidationError) => {
        // Check if this is a ZodError
        if (error?.response?.bodyResult?.name === 'ZodError') {
          // Transform the ZodError issues to a string array
          const errors =
            error?.response?.bodyResult?.issues?.map(
              (issue: ZodIssue) =>
                `${issue.path.join('.') ?? ''} ${issue.message ?? ''}`,
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
