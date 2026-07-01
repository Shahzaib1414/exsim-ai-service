import {
  BadRequestException,
  HttpStatus,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { maxFileSize } from '../types';

export function fileSizeValidator(optional: boolean = false): PipeTransform {
  return new ParseFileSize(optional);
}

@Injectable()
export class ParseFileSize implements PipeTransform {
  private readonly maxFileSize = maxFileSize;
  private readonly optional: boolean;

  constructor(optional: boolean = false) {
    this.optional = optional;
  }

  transform(value: Express.Multer.File): Express.Multer.File | null {
    if (this.optional && !value) {
      return null;
    }
    if (!value) {
      const errorResponse = {
        status: HttpStatus.BAD_REQUEST,
        message: HttpStatus[HttpStatus.BAD_REQUEST],
        errors: ['File is required'],
      };
      throw new BadRequestException(errorResponse);
    }
    if (this.maxFileSize < value.size) {
      const errorResponse = {
        status: HttpStatus.BAD_REQUEST,
        message: HttpStatus[HttpStatus.BAD_REQUEST],
        errors: [
          `File size ${value.size} exceeds the limit of ${this.maxFileSize} bytes`,
        ],
      };
      throw new BadRequestException(errorResponse);
    }
    return value;
  }
}
