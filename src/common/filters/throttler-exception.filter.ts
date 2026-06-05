import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(HttpStatus.TOO_MANY_REQUESTS).json({
      status: HttpStatus.TOO_MANY_REQUESTS,
      message: HttpStatus[HttpStatus.TOO_MANY_REQUESTS],
      errors: ['Too many requests. Please slow down and try again later.'],
    });
  }
}
